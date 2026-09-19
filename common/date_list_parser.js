// Recognizes "Month D1, D2[, D3...]" -- a common scheduling-email shorthand
// for multiple candidate days in the same month ("Oct 14, 21" = Oct 14 AND
// Oct 21), most often seen in "which dates work" / syllabus-style lists.
//
// This doesn't fit chrono's one-match-one-date model at all: chrono instead
// reads the trailing 1-2 digit number as a 2-digit YEAR abbreviation
// ("Oct 14, 21" -> October 14, 2021), which is a perfectly reasonable
// interpretation in isolation but wrong here, and got worse across a line
// break in a real email -- "Oct 14\n21\nNov 11, 18" produced one garbled
// match spanning both lines ("2011-11-21"). Handled as a pre-pass instead
// of a chrono parser/refiner because a single chrono match can only ever
// produce a single date, and this pattern needs to produce several.
const MONTH_NAMES = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}
const MONTH_RE_PART = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
// "Oct 14, 21" / "Oct. 14th, 21st, 28" -- one or more comma-separated day
// numbers after a month name. Requires at least 2 day numbers (a single
// "Oct 14" is already handled correctly by chrono on its own).
const DATE_LIST_RE = new RegExp(
    `\\b(${MONTH_RE_PART})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?((?:\\s*,\\s*\\d{1,2}(?:st|nd|rd|th)?)+)\\b`,
    'gi'
)

function resolveYear(month, day, referenceDate) {
    // Same forward-looking convention chrono itself uses: prefer the
    // reference year, but roll forward a year if that would land in the
    // past (so a list of dates mentioned near year's end for next January
    // isn't silently dropped by the past-date noise filter downstream).
    const refYear = referenceDate.getFullYear()
    const candidate = new Date(refYear, month, day)
    if (candidate.getTime() < referenceDate.getTime() - 86400000) {
        return refYear + 1
    }
    return refYear
}

/**
 * Finds "Month D1, D2[, ...]" lists in `text` and returns one candidate per
 * day, plus the character spans consumed (so the caller can mask them out
 * before handing the remaining text to chrono -- otherwise chrono will
 * separately, and incorrectly, re-parse the same digits).
 *
 * @returns {{matches: Array<{text, index, start: Date, end: null, hasTime: false}>, spans: Array<[number, number]>}}
 */
export function extractDateLists(text, referenceDate) {
    const matches = []
    const spans = []
    let m

    DATE_LIST_RE.lastIndex = 0
    while ((m = DATE_LIST_RE.exec(text))) {
        const monthKey = m[1].slice(0, 3).toLowerCase()
        const month = MONTH_NAMES[monthKey]
        if (month === undefined) continue // shouldn't happen given MONTH_RE_PART

        const dayNumbers = [m[2], ...m[3].split(',')]
            .map(s => parseInt(s.trim(), 10))
            .filter(n => n >= 1 && n <= 31)

        // Build one match per day, each using the whole "Month D1, D2" span
        // as its display text (clear context for the title/snippet) but a
        // distinct resolved date -- and only the FIRST one keeps its
        // original `index`; the rest are still emitted (for detection
        // purposes) but only the whole span is masked out once.
        for (const day of dayNumbers) {
            const year = resolveYear(month, day, referenceDate)
            const start = new Date(year, month, day)
            matches.push({
                text: m[0],
                index: m.index,
                start,
                end: null,
                hasTime: false,
            })
        }

        spans.push([m.index, m.index + m[0].length])
    }

    return {matches, spans}
}

/** Replaces each matched span with spaces of the same length (preserving
 * all other character offsets) so chrono doesn't separately re-parse the
 * same digits and produce a conflicting/garbled result. */
export function maskSpans(text, spans) {
    let masked = text
    for (const [start, end] of spans) {
        masked = masked.slice(0, start) + ' '.repeat(end - start) + masked.slice(end)
    }
    return masked
}
