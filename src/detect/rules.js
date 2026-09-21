// Third detection layer: custom chrono-node parsers/refiners that close
// specific gaps in real email phrasing that chrono-node's built-in English
// grammar doesn't cover on its own (tomorrow/next-Monday/ranges/ISO dates
// etc. already work without any of this).
//
// Every rule here was written against a concrete failing phrase plus a guard
// case proving it doesn't corrupt an already-unambiguous time -- see
// tests/find_dates.test.js and tests/corpus.test.js for the regression
// contract these encode.

const DURATION_CUE_RE = /(\d+)\s*[-\s]?\s*(min(?:ute)?s?|hours?|hrs?)\b/i
const DURATION_SEARCH_WINDOW = 40 // characters of context around a match to scan for a duration cue

const CLOCK_FRACTION_MINUTES = {quarter: 15, half: 30}
const NUMBER_WORD_VALUES = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

/**
 * A bare hour 1-7 with no am/pm stated, in running prose, is read as PM in
 * business contexts ("meeting at 4", "call at 2"); chrono's own default is
 * AM. Only applies when the meridiem wasn't already certain.
 */
export const assumeBusinessHoursPm = {
    refine(_context, results) {
        for (const result of results) {
            bumpToAfternoonIfBare(result.start)
            if (result.end) bumpToAfternoonIfBare(result.end)
        }
        return results
    },
}

function bumpToAfternoonIfBare(component) {
    if (component.isCertain('meridiem')) return
    const hour = component.get('hour')
    if (hour === null || hour < 1 || hour > 7) return
    component.assign('hour', hour + 12)
    component.assign('meridiem', 1) // PM
}

/**
 * "on the 23rd", "the 3rd at 4pm" -- an ordinal day-of-month with no month
 * name attached. chrono's built-in ordinal parsers require a month or
 * weekday alongside it; this fills the gap for the bare form.
 */
export const bareOrdinalDayOfMonth = {
    pattern: () => /\bthe\s+([0-9]{1,2})(?:st|nd|rd|th)\b/i,
    extract(_context, match) {
        const day = parseInt(match[1], 10)
        return (day >= 1 && day <= 31) ? {day} : null
    },
}

/**
 * Business shorthand chrono doesn't know: EOD/COB -> 17:00. (EOW resolves to
 * Friday via the surrounding day match; this only supplies the time part.)
 */
export const businessShorthandTime = {
    pattern: () => /\b(EOD|COB)\b/i,
    extract() {
        return {hour: 17, minute: 0, meridiem: 1}
    },
}

/** Spelled-out clock fractions: "half past three", "quarter to four". */
export const spelledOutClockFraction = {
    pattern: () => /\b(quarter|half)\s+(past|to)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\b/i,
    extract(_context, match) {
        const fraction = match[1].toLowerCase()
        const direction = match[2].toLowerCase()
        const hourToken = match[3].toLowerCase()
        let hour = NUMBER_WORD_VALUES[hourToken] ?? parseInt(hourToken, 10)
        if (!hour || hour < 1 || hour > 12) return null

        const minutesPart = CLOCK_FRACTION_MINUTES[fraction]
        if (direction === 'to') {
            hour = hour === 1 ? 12 : hour - 1
            return {hour, minute: 60 - minutesPart}
        }
        return {hour, minute: minutesPart}
    },
}

/**
 * Duration cues near a match ("30-min sync", "2-hour workshop") supply an
 * end time when chrono didn't find an explicit one. Scoped to a small window
 * around the match rather than the whole message, so an unrelated number
 * elsewhere in a long email is never picked up.
 */
export const durationCueSetsEnd = {
    refine(context, results) {
        for (const result of results) {
            if (result.end || !result.start.isCertain('hour')) continue

            const windowStart = Math.max(0, result.index - DURATION_SEARCH_WINDOW)
            const windowEnd = Math.min(context.text.length, result.index + result.text.length + DURATION_SEARCH_WINDOW)
            const nearbyText = context.text.slice(windowStart, windowEnd)
            const cue = nearbyText.match(DURATION_CUE_RE)
            if (!cue) continue

            const amount = parseInt(cue[1], 10)
            const minutes = /^h/i.test(cue[2]) ? amount * 60 : amount
            const endInstant = new Date(result.start.date().getTime() + minutes * 60000)

            result.end = result.start.clone()
            result.end.assign('hour', endInstant.getHours())
            result.end.assign('minute', endInstant.getMinutes())
        }
        return results
    },
}

/**
 * "Webinar Oct 6 at 11am PST / 2pm EST" -- the same instant stated twice in
 * different timezones. chrono parses the second mention as a bare time with
 * no date of its own (isCertain('day') is false) and defaults it to "today"
 * instead of carrying the date forward from the first mention, which both
 * misdates it and makes it look like an unrelated second event.
 *
 * Fix: whenever a result's date is uncertain and a dated result precedes it
 * closely, borrow that day/month/year before comparing instants. Once dates
 * line up, an equal instant is a genuine duplicate and gets dropped; a
 * different instant is a real second time ("Monday 2pm or 3pm") and stays.
 */
export const collapseRestatedTimezone = {
    refine(_context, results) {
        const kept = []
        let mostRecentDated = null

        for (const result of results) {
            if (!result.start.isCertain('day') && mostRecentDated) {
                result.start.assign('day', mostRecentDated.start.get('day'))
                result.start.assign('month', mostRecentDated.start.get('month'))
                result.start.assign('year', mostRecentDated.start.get('year'))
            } else if (result.start.isCertain('day')) {
                mostRecentDated = result
            }

            const isDuplicate = kept.some(existing =>
                Math.abs(existing.start.date().getTime() - result.start.date().getTime()) < 5 * 60000 &&
                result.index <= existing.index + existing.text.length + 10
            )
            if (!isDuplicate) kept.push(result)
        }
        return kept
    },
}

/** Refiners, applied in this order. */
export const REFINERS = [assumeBusinessHoursPm, durationCueSetsEnd, collapseRestatedTimezone]

/** Custom parsers, applied in this order. */
export const PARSERS = [bareOrdinalDayOfMonth, businessShorthandTime, spelledOutClockFraction]

/**
 * Applies the rules above to a chrono instance (a clone of chrono.casual,
 * chrono.GB, etc.) and returns it.
 *
 * @param {object} chronoInstance
 * @param {object} [options]
 * @param {boolean} [options.businessHoursMeridiem] - default true. When
 *   false, a bare hour 1-7 keeps chrono's own AM default instead.
 */
export function withCustomRules(chronoInstance, {businessHoursMeridiem = true} = {}) {
    for (const parser of PARSERS) chronoInstance.parsers.push(parser)

    const refiners = businessHoursMeridiem ? REFINERS : REFINERS.filter(r => r !== assumeBusinessHoursPm)
    for (const refiner of refiners) chronoInstance.refiners.push(refiner)

    return chronoInstance
}
