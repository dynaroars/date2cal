// Recognizes "Month D1, D2[, D3...]" -- a common scheduling-email shorthand
// for several candidate days in the same month ("Oct 14, 21" meaning both
// Oct 14 AND Oct 21), typically seen in "which dates work"/syllabus-style
// lists.
//
// This doesn't fit chrono's one-match-one-date model: chrono instead reads
// the trailing 1-2 digit number as a 2-digit year abbreviation ("Oct 14, 21"
// -> October 14, 2021) -- reasonable in isolation, wrong here, and worse
// across a line break ("Oct 14\n21\nNov 11, 18" can garble into one span).
// Handled as a pre-pass instead of a chrono parser/refiner because a single
// chrono match can only ever produce one date, and this pattern needs to
// produce several.

const MONTH_INDEX = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}
const MONTH_NAME_ALTERNATION =
    'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|' +
    'aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

// "Oct 14, 21" / "Oct. 14th, 21st, 28" -- a month name followed by one or
// more comma-separated day numbers. Requires at least two day numbers; a
// lone "Oct 14" is already handled correctly by chrono on its own.
const DATE_LIST_RE = new RegExp(
    `\\b(${MONTH_NAME_ALTERNATION})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?((?:\\s*,\\s*\\d{1,2}(?:st|nd|rd|th)?)+)\\b`,
    'gi'
)

/** Same forward-looking convention chrono itself uses: prefer the reference
 * year, but roll forward one year if that would land in the past -- so a
 * list of dates mentioned near year-end for next January isn't silently
 * dropped by the past-date filter downstream. */
function resolveYear(month, day, referenceDate) {
    const referenceYear = referenceDate.getFullYear()
    const candidate = new Date(referenceYear, month, day)
    return candidate.getTime() < referenceDate.getTime() - 86400000 ? referenceYear + 1 : referenceYear
}

/**
 * Finds "Month D1, D2[, ...]" lists in `text` and returns one candidate per
 * day, plus the character spans consumed (so the caller can mask them out
 * before handing the rest of the text to chrono -- otherwise chrono
 * separately, and incorrectly, re-parses the same digits).
 *
 * @returns {{matches: Array<{text, index, start: Date, end: null, hasTime: false}>, spans: Array<[number, number]>}}
 */
export function extractDateLists(text, referenceDate) {
    const matches = []
    const spans = []

    DATE_LIST_RE.lastIndex = 0
    let match
    while ((match = DATE_LIST_RE.exec(text))) {
        const month = MONTH_INDEX[match[1].slice(0, 3).toLowerCase()]
        if (month === undefined) continue // shouldn't happen given MONTH_NAME_ALTERNATION

        const days = [match[2], ...match[3].split(',')]
            .map(token => parseInt(token.trim(), 10))
            .filter(n => n >= 1 && n <= 31)

        // One candidate per day, all sharing the whole "Month D1, D2" span as
        // display text (clear context for a title/snippet) but each with its
        // own resolved date. The whole span is only masked out once below.
        for (const day of days) {
            matches.push({
                text: match[0],
                index: match.index,
                start: new Date(resolveYear(month, day, referenceDate), month, day),
                end: null,
                hasTime: false,
            })
        }

        spans.push([match.index, match.index + match[0].length])
    }

    return {matches, spans}
}

/** Replaces each given span with spaces of the same length (preserving all
 * other character offsets) so chrono doesn't separately re-parse the same
 * digits and produce a conflicting/garbled result. */
export function maskSpans(text, spans) {
    return spans.reduce(
        (acc, [start, end]) => acc.slice(0, start) + ' '.repeat(end - start) + acc.slice(end),
        text
    )
}
