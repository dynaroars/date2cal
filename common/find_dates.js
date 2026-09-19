// Orchestrates the three detection layers (PLAN.md section 2) into one
// entry point: detectEvents(). Layer 1 (structured .ics/JSON-LD) short-
// circuits Layers 2-3 (chrono prose parsing + custom rules) when it finds
// anything, since a structured hit has nothing left to guess.
import {extractStructured} from './extract_structured.js'
import {parseProse} from './parse_prose.js'
import {stripQuotedAndNoise, filterNoise, dedupeOverlapping} from './filter_noise.js'
import {extractLocation, extractVideoLink, extractTitle} from './extract_details.js'
import {detectRecurrence} from './recurrence.js'
import {rankCandidates} from './rank.js'

const DEFAULT_DURATION_MS = 60 * 60 * 1000 // 1 hour: see PLAN.md Phase 1 step 14.
// (The upstream plugin rounded to the next half hour, producing odd
// 09:00-09:30 events; macOS Mail's convention of a flat 1-hour default reads
// better for real meetings.)

/** Fills in an end time/date for a prose match that chrono/Layer-3 didn't
 * already resolve (e.g. a duration cue set it). No time at all -> all-day. */
function applyDurationPolicy(match) {
    if (match.end) return {end: match.end, isAllDay: !match.hasTime && sameDay(match.start, match.end)}
    if (!match.hasTime) {
        const end = new Date(match.start.getTime())
        end.setDate(end.getDate() + 1)
        return {end, isAllDay: true}
    }
    return {end: new Date(match.start.getTime() + DEFAULT_DURATION_MS), isAllDay: false}
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Runs Layers 2-3 over one piece of text (subject or body) and returns
 * fully-formed candidates (title/location/url/recurrence attached). */
function detectInText(text, source, subject, referenceDate, dateOrder) {
    const cleaned = stripQuotedAndNoise(text)
    const rawMatches = parseProse(cleaned, referenceDate, dateOrder)
    const filtered = filterNoise(rawMatches, cleaned, referenceDate)
    const deduped = dedupeOverlapping(filtered)

    return deduped.map((match) => {
        const {end, isAllDay} = applyDurationPolicy(match)
        const recurrence = detectRecurrence(cleaned, match.index, match.text.length, referenceDate)
        return {
            confidence: 'prose',
            source,
            text: match.text,
            index: match.index,
            start: match.start,
            end,
            isAllDay,
            hasTime: match.hasTime,
            title: extractTitle(cleaned, match.index, match.text.length, subject),
            location: extractLocation(cleaned, match.index, match.text.length),
            url: extractVideoLink(cleaned),
            rrule: recurrence?.rrule ?? null,
            recurrenceLabel: recurrence?.label ?? null,
        }
    })
}

/**
 * Detects calendar-event candidates in an email.
 *
 * @param {object} input
 * @param {string} input.subject
 * @param {string} input.body - plain-text body (already extracted/converted
 *   by the caller; see create_event_button/current_mail_to_date.js)
 * @param {Date} input.referenceDate - the message's own Date: header, NOT
 *   Date.now() (see PLAN.md Phase 1 step 7 -- relative dates like "tomorrow"
 *   must resolve against when the mail was sent).
 * @param {string} [input.timezone] - IANA zone, e.g. from
 *   messenger.calendar.timezones.currentZone. Currently informational; wired
 *   into chrono's reference timezone in a follow-up if mismatches show up in
 *   the Phase 5 corpus.
 * @param {'MDY'|'DMY'} [input.dateOrder]
 * @param {string[]} [input.icsTexts] - raw text of any .ics/text-calendar
 *   parts on the message (Layer 1).
 * @param {Document} [input.htmlDocument] - message body as a DOM Document,
 *   for JSON-LD scanning (Layer 1). Omit if unavailable.
 * @returns {{candidates: Array, usedLayer: 'structured'|'prose'}}
 */
export function detectEvents({
    subject = '',
    body = '',
    referenceDate = new Date(),
    dateOrder = 'MDY',
    icsTexts = [],
    htmlDocument = null,
} = {}) {
    const structured = extractStructured({icsTexts, htmlDocument})
    if (structured.length > 0) {
        const withTitles = structured.map(c => ({...c, title: c.title || subject}))
        return {candidates: rankCandidates(withTitles), usedLayer: 'structured'}
    }

    const subjectCandidates = subject
        ? detectInText(subject, 'subject', subject, referenceDate, dateOrder)
        : []
    const bodyCandidates = body
        ? detectInText(body, 'body', subject, referenceDate, dateOrder)
        : []

    return {
        candidates: rankCandidates([...subjectCandidates, ...bodyCandidates]),
        usedLayer: 'prose',
    }
}
