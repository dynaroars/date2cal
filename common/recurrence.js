// Phase 3a (PLAN.md): recurrence detection. Deliberately narrow and
// conservative -- a wrong RRULE spams the calendar indefinitely, so this only
// recognizes a handful of unambiguous phrasings and always returns a
// human-readable description alongside the RRULE, so the UI can show
// "Repeats weekly on Monday" and let the user drop back to a single
// occurrence. (Concretely: the toolbar popup shows the label before the
// dialog opens, and Thunderbird's own New Event dialog has its own "Repeat"
// editor already populated from the RRULE we pass in -- the user can change
// or clear it there before saving. Never created silently with no way to see
// or undo it.)
import {parseProse} from './parse_prose.js'

const UNTIL_RE = /\buntil\s+([^.,;\n]+)/i

const WEEKDAY_RRULE = {
    sunday: 'SU', monday: 'MO', tuesday: 'TU', wednesday: 'WE',
    thursday: 'TH', friday: 'FR', saturday: 'SA',
}
const WEEKDAY_LABEL = {
    SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday',
    TH: 'Thursday', FR: 'Friday', SA: 'Saturday',
}
const ORDINAL_WORD = {first: 1, second: 2, third: 3, fourth: 4, last: -1}

const PATTERNS = [
    {
        // "every other Tuesday"
        re: /\bevery\s+other\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
        build: (m) => {
            const day = WEEKDAY_RRULE[m[1].toLowerCase()]
            return {rrule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${day}`, label: `every other ${WEEKDAY_LABEL[day]}`}
        },
    },
    {
        // "every Monday", "weekly on Monday"
        re: /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\bweekly\s+on\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
        build: (m) => {
            const day = WEEKDAY_RRULE[(m[1] || m[2]).toLowerCase()]
            return {rrule: `FREQ=WEEKLY;BYDAY=${day}`, label: `weekly on ${WEEKDAY_LABEL[day]}`}
        },
    },
    {
        // "first Tuesday of the month"
        re: /\b(first|second|third|fourth|last)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+of\s+(?:the\s+)?month\b/i,
        build: (m) => {
            const ord = ORDINAL_WORD[m[1].toLowerCase()]
            const day = WEEKDAY_RRULE[m[2].toLowerCase()]
            return {
                rrule: `FREQ=MONTHLY;BYDAY=${ord}${day}`,
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
 * ("daily until Dec 1") and, if the date parses, appends an UNTIL component
 * to both the RRULE and the human-readable label. Best-effort: an
 * unparseable or absent "until" clause just means an open-ended recurrence,
 * not a detection failure. */
function appendUntilClause(result, around, referenceDate) {
    const m = around.match(UNTIL_RE)
    if (!m) return result

    const parsed = parseProse(m[1], referenceDate)[0]
    if (!parsed) return result

    const untilValue = parsed.start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    return {
        rrule: `${result.rrule};UNTIL=${untilValue}`,
        label: `${result.label} until ${parsed.start.toDateString()}`,
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
    const around = text.slice(from, to)

    for (const pattern of PATTERNS) {
        const m = around.match(pattern.re)
        if (m) return appendUntilClause(pattern.build(m), around, referenceDate)
    }
    return null
}
