// Orchestrates the three detection layers into one entry point:
// detectEvents(). The structured layer (.ics/JSON-LD) short-circuits the
// prose/rules layers when it finds anything, since a structured hit has
// nothing left to guess.
import {extractStructuredEvents} from './structured.js'
import {parseProse} from './prose.js'
import {stripQuotedReplyAndMarkup, rejectNonEvents, dropOverlapping} from './filters.js'
import {findNearbyLocation, findVideoCallLink, deriveTitle} from './details.js'
import {detectRecurrence} from './recurrence.js'
import {rankCandidates} from './rank.js'
import {extractDateLists, maskSpans} from './date-lists.js'

// The upstream plugin this project began as rounded to the next half hour,
// producing odd 09:00-09:30 events; a flat 1-hour default (macOS Mail's
// convention) reads better for real meetings. Configurable via the options
// page.
const DEFAULT_DURATION_MINUTES = 60

/** Fills in an end time/date for a prose match that wasn't already resolved
 * (e.g. a duration cue set it). No time at all -> all-day. */
function resolveEnd(match, defaultDurationMinutes) {
    if (match.end) return {end: match.end, isAllDay: !match.hasTime && isSameDay(match.start, match.end)}

    if (!match.hasTime) {
        const end = new Date(match.start.getTime())
        end.setDate(end.getDate() + 1)
        return {end, isAllDay: true}
    }

    return {end: new Date(match.start.getTime() + defaultDurationMinutes * 60000), isAllDay: false}
}

function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Runs the prose+rules layers over one piece of text (subject or body) and
 * returns fully-formed candidates (title/location/url/recurrence attached). */
function detectInText(text, source, subject, referenceDate, dateOrder, businessHoursMeridiem, defaultDurationMinutes) {
    const cleaned = stripQuotedReplyAndMarkup(text)

    // "Month D1, D2[, ...]" lists ("Oct 14, 21") don't fit chrono's one-
    // match-one-date model -- pull them out first and mask their spans so
    // chrono doesn't separately (mis)parse the same digits. Deliberately NOT
    // deduped against each other below: several of these results
    // intentionally share the same source span (one "Oct 14, 21" mention
    // produces two distinct dates), which dropOverlapping would otherwise
    // collapse to one.
    const {matches: dateListMatches, spans} = extractDateLists(cleaned, referenceDate)
    const maskedText = maskSpans(cleaned, spans)

    const proseMatches = parseProse(maskedText, referenceDate, dateOrder, businessHoursMeridiem)
    const precise = dropOverlapping(rejectNonEvents(proseMatches, maskedText, referenceDate))

    return [...dateListMatches, ...precise].map((match) => {
        const {end, isAllDay} = resolveEnd(match, defaultDurationMinutes)
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
            title: deriveTitle(cleaned, match.index, match.text.length, subject),
            location: findNearbyLocation(cleaned, match.index, match.text.length),
            url: findVideoCallLink(cleaned),
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
 *   by the caller; see src/popup/mail-context.js)
 * @param {Date} input.referenceDate - the message's own Date: header, NOT
 *   Date.now() -- relative dates like "tomorrow" must resolve against when
 *   the mail was sent.
 * @param {string} [input.timezone] - IANA zone, e.g. from
 *   messenger.calendar.timezones.currentZone. Currently informational.
 * @param {'MDY'|'DMY'} [input.dateOrder]
 * @param {string[]} [input.icsTexts] - raw text of any .ics/text-calendar
 *   parts on the message (structured layer).
 * @param {Document} [input.htmlDocument] - message body as a DOM Document,
 *   for JSON-LD scanning (structured layer). Omit if unavailable.
 * @param {boolean} [input.businessHoursMeridiem] - default true; the rules-
 *   layer heuristic defaulting a bare hour 1-7 to PM. Options-page toggle.
 * @param {number} [input.defaultDurationMinutes] - default 60. Options-page
 *   setting.
 * @returns {{candidates: Array, usedLayer: 'structured'|'prose'}}
 */
export function detectEvents({
    subject = '',
    body = '',
    referenceDate = new Date(),
    dateOrder = 'MDY',
    icsTexts = [],
    htmlDocument = null,
    businessHoursMeridiem = true,
    defaultDurationMinutes = DEFAULT_DURATION_MINUTES,
} = {}) {
    const structured = extractStructuredEvents({icsTexts, htmlDocument})
    if (structured.length > 0) {
        const withTitles = structured.map(c => ({...c, title: c.title || subject}))
        return {candidates: rankCandidates(withTitles), usedLayer: 'structured'}
    }

    const subjectCandidates = subject
        ? detectInText(subject, 'subject', subject, referenceDate, dateOrder, businessHoursMeridiem, defaultDurationMinutes)
        : []
    const bodyCandidates = body
        ? detectInText(body, 'body', subject, referenceDate, dateOrder, businessHoursMeridiem, defaultDurationMinutes)
        : []

    return {
        candidates: rankCandidates([...subjectCandidates, ...bodyCandidates]),
        usedLayer: 'prose',
    }
}
