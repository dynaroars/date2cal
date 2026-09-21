// Recurrence detection. Deliberately narrow and conservative -- a wrong
// RRULE spams the calendar indefinitely, so this only recognizes a handful
// of unambiguous phrasings and always returns a human-readable description
// alongside the RRULE, so the UI can show "Repeats weekly on Monday" and let
// the user fall back to a single occurrence. Never created silently with no
// way to see or undo it: the toolbar popup shows the label before the
// dialog opens, and Thunderbird's own New Event dialog has its own "Repeat"
// editor already populated from the RRULE passed in, which the user can
// change or clear before saving.
import {parseProse} from './prose.js'

const UNTIL_CLAUSE_RE = /\buntil\s+([^.,;\n]+)/i

const WEEKDAY_TO_RRULE = {
    sunday: 'SU', monday: 'MO', tuesday: 'TU', wednesday: 'WE',
    thursday: 'TH', friday: 'FR', saturday: 'SA',
}
const WEEKDAY_LABEL = {
    SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday',
    TH: 'Thursday', FR: 'Friday', SA: 'Saturday',
}
const ORDINAL_WORD_VALUE = {first: 1, second: 2, third: 3, fourth: 4, last: -1}

const RECURRENCE_PATTERNS = [
    {
        // "every other Tuesday"
        re: /\bevery\s+other\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
        build: (m) => {
            const day = WEEKDAY_TO_RRULE[m[1].toLowerCase()]
            return {rrule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${day}`, label: `every other ${WEEKDAY_LABEL[day]}`}
        },
    },
    {
        // "every Monday", "weekly on Monday"
        re: /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\bweekly\s+on\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
        build: (m) => {
            const day = WEEKDAY_TO_RRULE[(m[1] || m[2]).toLowerCase()]
            return {rrule: `FREQ=WEEKLY;BYDAY=${day}`, label: `weekly on ${WEEKDAY_LABEL[day]}`}
        },
    },
    {
        // "first Tuesday of the month"
        re: /\b(first|second|third|fourth|last)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+of\s+(?:the\s+)?month\b/i,
        build: (m) => {
            const ordinal = ORDINAL_WORD_VALUE[m[1].toLowerCase()]
            const day = WEEKDAY_TO_RRULE[m[2].toLowerCase()]
            return {
                rrule: `FREQ=MONTHLY;BYDAY=${ordinal}${day}`,
                label: `${m[1].toLowerCase()} ${WEEKDAY_LABEL[day]} of the month`,
            }
        },
    },
    {
        // bare "daily" / "every day"
        re: /\b(?:daily|every\s+day)\b/i,
        build: () => ({rrule: 'FREQ=DAILY', label: 'daily'}),
    },
    {
        // bare "weekly" with no day specified -- day comes from the matched
        // event's own start date, filled in by the caller.
        re: /\bweekly\b/i,
        build: () => ({rrule: 'FREQ=WEEKLY', label: 'weekly'}),
    },
]

/** Looks for a trailing "until <date>" clause near the recurrence phrase
 * ("daily until Dec 1") and, if it parses, appends an UNTIL component to
 * both the RRULE and the human-readable label. Best-effort: an unparseable
 * or absent "until" clause just means an open-ended recurrence. */
function withUntilClause(result, nearbyText, referenceDate) {
    const untilMatch = nearbyText.match(UNTIL_CLAUSE_RE)
    if (!untilMatch) return result

    const parsedUntil = parseProse(untilMatch[1], referenceDate)[0]
    if (!parsedUntil) return result

    const untilValue = parsedUntil.start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    return {
        rrule: `${result.rrule};UNTIL=${untilValue}`,
        label: `${result.label} until ${parsedUntil.start.toDateString()}`,
    }
}

/**
 * Looks for a recurrence phrase near a detected date match and returns
 * {rrule, label} if found, otherwise null. `windowSize` limits the search to
 * text near the match so an unrelated "daily" elsewhere in the email isn't
 * misattributed.
 */
export function detectRecurrence(text, matchIndex, matchLength, referenceDate = new Date(), windowSize = 60) {
    const from = Math.max(0, matchIndex - windowSize)
    const to = Math.min(text.length, matchIndex + matchLength + windowSize)
    const nearbyText = text.slice(from, to)

    for (const pattern of RECURRENCE_PATTERNS) {
        const match = nearbyText.match(pattern.re)
        if (match) return withUntilClause(pattern.build(match), nearbyText, referenceDate)
    }
    return null
}
