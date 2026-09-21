// First detection layer: read event data the email already carries -- a
// text/calendar (.ics) attachment/part, or schema.org JSON-LD markup in an
// HTML body -- instead of guessing it from prose. Most real invites
// (Outlook, Google Calendar, Zoom, Teams, Webex, Eventbrite, airlines) ship
// one of these. When present, there is nothing to infer, so results from
// this layer are marked confidence: 'exact' and take priority over anything
// the prose/rules layers find.
//
// This is a small hand-written ICS reader, not a full RFC 5545
// implementation: it covers the VEVENT properties that matter for "create an
// event" (DTSTART, DTEND, DURATION, SUMMARY, LOCATION, DESCRIPTION, RRULE,
// URL) and deliberately ignores the rest (VTIMEZONE blocks, attendees,
// alarms). That's enough because the result only prefills a dialog the user
// still reviews -- this isn't meant to be a full calendar client.

/** Un-folds ICS content-line continuations (RFC 5545 3.1): a line starting
 * with a single space or tab is a continuation of the previous line. */
function unfoldLines(icsText) {
    const lines = []
    for (const rawLine of icsText.split(/\r\n|\n|\r/)) {
        if ((rawLine.startsWith(' ') || rawLine.startsWith('\t')) && lines.length > 0) {
            lines[lines.length - 1] += rawLine.slice(1)
        } else if (rawLine.length > 0) {
            lines.push(rawLine)
        }
    }
    return lines
}

/** Parses one ICS content line into {name, params, value}. */
function parseContentLine(line) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) return null

    const head = line.slice(0, colonIndex)
    const value = line.slice(colonIndex + 1)
    const [name, ...paramTokens] = head.split(';')

    const params = {}
    for (const token of paramTokens) {
        const eqIndex = token.indexOf('=')
        if (eqIndex === -1) continue
        params[token.slice(0, eqIndex).toUpperCase()] = token.slice(eqIndex + 1)
    }
    return {name: name.toUpperCase(), params, value}
}

const ICS_ESCAPE_SEQUENCES = {'\\n': '\n', '\\N': '\n', '\\,': ',', '\\;': ';', '\\\\': '\\'}
function unescapeIcsText(value) {
    return value.replace(/\\[nN,;\\]/g, (seq) => ICS_ESCAPE_SEQUENCES[seq] ?? seq)
}

/** Parses an ICS DATE or DATE-TIME value into a JS Date. */
function parseIcsDateTime(value, params) {
    const isDateOnly = params.VALUE === 'DATE' || /^\d{8}$/.test(value)
    const year = +value.slice(0, 4), month = +value.slice(4, 6), day = +value.slice(6, 8)

    if (isDateOnly) {
        return {date: new Date(year, month - 1, day), isDate: true}
    }

    const isUtc = value.endsWith('Z')
    const hours = +value.slice(9, 11), minutes = +value.slice(11, 13), seconds = +value.slice(13, 15) || 0
    const date = isUtc
        ? new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds))
        : new Date(year, month - 1, day, hours, minutes, seconds) // local wall-clock; TZID handling out of scope
    return {date, isDate: false}
}

const ICS_DURATION_RE = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
function parseIcsDurationMs(value) {
    const match = value.match(ICS_DURATION_RE)
    if (!match) return null

    const sign = match[1] === '-' ? -1 : 1
    const [, , weeks, days, hours, minutes, seconds] = match
    return sign * (
        (+(weeks || 0)) * 7 * 86400000 +
        (+(days || 0)) * 86400000 +
        (+(hours || 0)) * 3600000 +
        (+(minutes || 0)) * 60000 +
        (+(seconds || 0)) * 1000
    )
}

/** Parses ICS text into an array of VEVENT candidates. */
export function parseIcsEvents(icsText) {
    if (!icsText || typeof icsText !== 'string') return []

    const events = []
    let current = null

    for (const rawLine of unfoldLines(icsText)) {
        const parsed = parseContentLine(rawLine)
        if (!parsed) continue
        const {name, params, value} = parsed

        if (name === 'BEGIN' && value === 'VEVENT') {
            current = {}
            continue
        }
        if (name === 'END' && value === 'VEVENT') {
            if (current) events.push(current)
            current = null
            continue
        }
        if (!current) continue

        switch (name) {
            case 'DTSTART': {
                const {date, isDate} = parseIcsDateTime(value, params)
                current.start = date
                current.isAllDay = isDate
                break
            }
            case 'DTEND':
                current.end = parseIcsDateTime(value, params).date
                break
            case 'DURATION':
                current.durationMs = parseIcsDurationMs(value)
                break
            case 'SUMMARY':
                current.summary = unescapeIcsText(value)
                break
            case 'LOCATION':
                current.location = unescapeIcsText(value)
                break
            case 'DESCRIPTION':
                current.description = unescapeIcsText(value)
                break
            case 'RRULE':
                current.rrule = value
                break
            case 'URL':
                current.url = value
                break
            case 'UID':
                current.uid = value
                break
        }
    }

    return events
        .filter(e => e.start instanceof Date && !isNaN(e.start))
        .map(e => {
            let end = e.end
            if (!end && e.durationMs != null) end = new Date(e.start.getTime() + e.durationMs)
            if (!end) end = e.isAllDay ? new Date(e.start.getTime() + 86400000) : new Date(e.start.getTime() + 3600000)

            return {
                confidence: 'exact',
                source: 'ics',
                title: e.summary || null,
                start: e.start,
                end,
                isAllDay: !!e.isAllDay,
                location: e.location || null,
                description: e.description || null,
                url: e.url || null,
                rrule: e.rrule || null,
                text: e.summary || '(calendar invite)',
            }
        })
}

const SCHEMA_EVENT_TYPES = new Set(['Event', 'BusinessEvent', 'EducationEvent', 'MusicEvent', 'SportsEvent', 'TheaterEvent'])

/** Extracts schema.org Event objects from JSON-LD <script> blocks in an HTML
 * document. `doc` is any DOM-Document-like object with querySelectorAll
 * (works with the real DOM in a content script, or a lightweight shim). */
export function parseJsonLdEvents(doc) {
    const scripts = doc.querySelectorAll?.('script[type="application/ld+json"]') || []
    const results = []

    const visit = (node) => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) {
            node.forEach(visit)
            return
        }

        const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
        if (types.some(t => SCHEMA_EVENT_TYPES.has(t))) {
            const start = node.startDate ? new Date(node.startDate) : null
            if (start && !isNaN(start)) {
                const end = node.endDate ? new Date(node.endDate) : new Date(start.getTime() + 3600000)
                const location = typeof node.location === 'string'
                    ? node.location
                    : (node.location?.name || node.location?.address?.streetAddress || null)

                results.push({
                    confidence: 'exact',
                    source: 'jsonld',
                    title: node.name || null,
                    start,
                    end,
                    isAllDay: false,
                    location,
                    description: node.description || null,
                    url: node.url || null,
                    rrule: null,
                    text: node.name || '(event listing)',
                })
            }
        }

        if (node['@graph']) visit(node['@graph'])
    }

    for (const script of scripts) {
        try {
            visit(JSON.parse(script.textContent))
        } catch {
            // Malformed JSON-LD is common in the wild; skip it rather than
            // fail the whole detection pass.
        }
    }
    return results
}

/**
 * Runs both structured extractors and returns their combined results.
 *
 * @param {object} input
 * @param {string[]} [input.icsTexts] - raw text of any .ics/text-calendar parts
 * @param {Document} [input.htmlDocument] - the message body parsed as HTML,
 *   for JSON-LD scanning. Omit if only plain text is available.
 */
export function extractStructuredEvents({icsTexts = [], htmlDocument = null} = {}) {
    const results = []
    for (const icsText of icsTexts) results.push(...parseIcsEvents(icsText))
    if (htmlDocument) results.push(...parseJsonLdEvents(htmlDocument))
    return results
}
