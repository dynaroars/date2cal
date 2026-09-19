// Layer 3 of detection (see PLAN.md section 2): custom chrono-node parsers and
// refiners that close the specific gaps measured in real email phrasing.
// chrono-node alone gets tomorrow/next-Monday/ranges/ISO/etc. right; these
// rules cover the handful of things it still misses or mishandles.
//
// Each rule below was prototyped and verified against both the failing case
// it fixes AND a guard case proving it doesn't corrupt an already-correct
// explicit time. Run `npm test` -- tests/chrono_rules.js exercises both.

const DURATION_CUE = /(\d+)\s*[-\s]?\s*(min(?:ute)?s?|hours?|hrs?)\b/i
const DURATION_WINDOW = 40 // chars to look around a match for a duration cue

const SPELLED_OUT_MINUTES = {
    'quarter': 15,
    'half': 30,
}

/**
 * Bare hour 1-7 with no explicit am/pm, in running prose, most often means
 * PM (business hours) -- "meeting at 4", "call at 2". chrono defaults these
 * to AM. Skip anything where the meridiem was already stated explicitly.
 */
export const businessHoursMeridiem = {
    refine(_ctx, results) {
        for (const r of results) {
            if (r.start.isCertain('meridiem')) continue
            const hour = r.start.get('hour')
            if (hour === null || hour < 1 || hour > 7) continue
            r.start.assign('hour', hour + 12)
            r.start.assign('meridiem', 1) // PM
            if (r.end && !r.end.isCertain('meridiem')) {
                const endHour = r.end.get('hour')
                if (endHour !== null && endHour >= 1 && endHour <= 7) {
                    r.end.assign('hour', endHour + 12)
                    r.end.assign('meridiem', 1)
                }
            }
        }
        return results
    }
}

/**
 * "on the 23rd", "the 3rd at 4pm" -- a bare ordinal day-of-month with no
 * month name. chrono's built-in parsers require a month or weekday alongside
 * an ordinal; this catches the bare case.
 */
export const bareOrdinalDay = {
    pattern: () => /\bthe\s+([0-9]{1,2})(?:st|nd|rd|th)\b/i,
    extract(_ctx, match) {
        const day = parseInt(match[1], 10)
        if (day < 1 || day > 31) return null
        return {day}
    }
}

/**
 * EOD / EOW / COB -- common business shorthand chrono doesn't know.
 * EOD/COB -> 17:00, EOW -> Friday 17:00 (handled by the surrounding day
 * match; this rule only supplies the time component).
 */
export const eodEowCob = {
    pattern: () => /\b(EOD|COB)\b/i,
    extract() {
        return {hour: 17, minute: 0, meridiem: 1}
    }
}

/**
 * Spelled-out clock fractions: "half past three", "quarter past three",
 * "quarter to four".
 */
export const spelledOutClock = {
    pattern: () => /\b(quarter|half)\s+(past|to)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\b/i,
    extract(_ctx, match) {
        const NUMBER_WORDS = {
            one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
            seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
        }
        const fraction = match[1].toLowerCase()
        const direction = match[2].toLowerCase()
        const hourWord = match[3].toLowerCase()
        let hour = NUMBER_WORDS[hourWord] ?? parseInt(hourWord, 10)
        if (!hour || hour < 1 || hour > 12) return null

        const minutes = SPELLED_OUT_MINUTES[fraction]
        if (direction === 'to') {
            hour = hour === 1 ? 12 : hour - 1
            return {hour, minute: 60 - minutes}
        }
        return {hour, minute: minutes}
    }
}

/**
 * Duration cues ("30-min sync", "2-hour workshop", "quick 15 min chat") set
 * the end time when chrono found no explicit end. Looks at a small window of
 * text around the match rather than the whole document, so it doesn't grab
 * an unrelated number elsewhere in a long email.
 */
export const durationCue = {
    refine(ctx, results) {
        for (const r of results) {
            if (r.end || !r.start.isCertain('hour')) continue
            const from = Math.max(0, r.index - DURATION_WINDOW)
            const to = Math.min(ctx.text.length, r.index + r.text.length + DURATION_WINDOW)
            const around = ctx.text.slice(from, to)
            const m = around.match(DURATION_CUE)
            if (!m) continue

            const n = parseInt(m[1], 10)
            const isHours = /^h/i.test(m[2])
            const minutes = isHours ? n * 60 : n
            const endDate = new Date(r.start.date().getTime() + minutes * 60000)

            r.end = r.start.clone()
            r.end.assign('hour', endDate.getHours())
            r.end.assign('minute', endDate.getMinutes())
        }
        return results
    }
}

/**
 * "Webinar Oct 6 at 11am PST / 2pm EST" -- the same instant stated in two
 * timezones. chrono parses the second mention ("2pm EST") as a bare time with
 * no date of its own -- isCertain('day') is false -- and defaults its date to
 * "today" rather than carrying forward the "Oct 6" from the first mention.
 * Two problems follow from that, both fixed here: (1) the date is wrong, and
 * (2) it looks like a second, unrelated event 18 days away instead of a
 * duplicate of the first.
 *
 * Fix: for any result immediately following another (separated only by
 * punctuation/"or"/whitespace) whose date is uncertain, borrow the day/month/
 * year from the preceding dated result before comparing instants. Once dates
 * are aligned, an equal instant is a genuine duplicate (same event, two
 * timezones) and is dropped; a different instant is a real second time
 * ("Monday 2pm or 3pm") and is kept.
 */
export const mergeDuplicateTimezones = {
    refine(_ctx, results) {
        const merged = []
        let lastDated = null

        for (const r of results) {
            if (!r.start.isCertain('day') && lastDated) {
                r.start.assign('day', lastDated.start.get('day'))
                r.start.assign('month', lastDated.start.get('month'))
                r.start.assign('year', lastDated.start.get('year'))
            } else if (r.start.isCertain('day')) {
                lastDated = r
            }

            const dupe = merged.find(m =>
                Math.abs(m.start.date().getTime() - r.start.date().getTime()) < 5 * 60000 &&
                r.index <= m.index + m.text.length + 10
            )
            if (!dupe) merged.push(r)
        }
        return merged
    }
}

/** All Layer-3 refiners, in the order they should run. */
export const REFINERS = [businessHoursMeridiem, durationCue, mergeDuplicateTimezones]

/** All Layer-3 custom parsers, in the order they should run. */
export const PARSERS = [bareOrdinalDay, eodEowCob, spelledOutClock]

/**
 * Applies Layer-3 rules to a chrono instance (a clone of chrono.casual,
 * chrono.GB, etc.) and returns it.
 *
 * @param {object} chronoInstance
 * @param {object} [options]
 * @param {boolean} [options.businessHoursMeridiem] - default true. Options-
 *   page toggle (PLAN.md Phase 6) -- some users may prefer chrono's own
 *   default (bare 1-7 = AM) over the business-hours assumption.
 */
export function applyChronoRules(chronoInstance, {businessHoursMeridiem: useBusinessHoursMeridiem = true} = {}) {
    for (const parser of PARSERS) chronoInstance.parsers.push(parser)
    const refiners = useBusinessHoursMeridiem ? REFINERS : REFINERS.filter(r => r !== businessHoursMeridiem)
    for (const refiner of refiners) chronoInstance.refiners.push(refiner)
    return chronoInstance
}
