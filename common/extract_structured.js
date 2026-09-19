// Layer 1 of detection (see PLAN.md section 2): read event data the email
// already carries -- a text/calendar (.ics) attachment/part, or schema.org
// JSON-LD markup in an HTML body -- instead of guessing it from prose.
// Most real invites (Outlook, Google Calendar, Zoom, Teams, Webex, Eventbrite,
// airlines) ship one of these. When present, there is nothing to infer, so
// results from this layer are marked confidence: 'exact' and take priority
// over anything Layers 2-3 find.
//
// This is a small hand-written ICS reader, not a full RFC 5545 implementation:
// it covers the VEVENT properties that matter for "create an event"
// (DTSTART, DTEND, DURATION, SUMMARY, LOCATION, DESCRIPTION, RRULE, URL) and
// deliberately ignores the rest (timezone VTIMEZONE blocks, attendees,
// alarms). Good enough because we only need to prefill a dialog the user
// still reviews -- not to be a calendar client.

/** Un-fold ICS content-line continuations (RFC 5545 3.1): a line starting
 * with a single space or tab is a continuation of the previous line. */
function unfoldLines(icsText) {
    const rawLines = icsText.split(/\r\n|\n|\r/)
    const lines = []
    for (const line of rawLines) {
        if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
            lines[lines.length - 1] += line.slice(1)
        } else if (line.length > 0) {
            lines.push(line)
        }
    }
    return lines
}

/** Parses one ICS content line into {name, params, value}. */
function parseLine(line) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) return null
    const head = line.slice(0, colonIndex)
    const value = line.slice(colonIndex + 1)
    const [name, ...paramParts] = head.split(';')
    const params = {}
    for (const part of paramParts) {
        const eq = part.indexOf('=')
        if (eq === -1) continue
        params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1)
    }
    return {name: name.toUpperCase(), params, value}
}

const ICS_ESCAPES = {'\\n': '\n', '\\N': '\n', '\\,': ',', '\\;': ';', '\\\\': '\\'}
function unescapeText(value) {
    return value.replace(/\\[nN,;\\]/g, (m) => ICS_ESCAPES[m] ?? m)
}

/** Parses an ICS DATE or DATE-TIME value into a JS Date. */
function parseIcsDateTime(value, params) {
    const isDateOnly = params.VALUE === 'DATE' || /^\d{8}$/.test(value)
    if (isDateOnly) {
        const y = +value.slice(0, 4), m = +value.slice(4, 6), d = +value.slice(6, 8)
        return {date: new Date(y, m - 1, d), isDate: true}
    }
    const utc = value.endsWith('Z')
    const y = +value.slice(0, 4), m = +value.slice(4, 6), d = +value.slice(6, 8)
    const hh = +value.slice(9, 11), mm = +value.slice(11, 13), ss = +value.slice(13, 15) || 0
    const date = utc
        ? new Date(Date.UTC(y, m - 1, d, hh, mm, ss))
        : new Date(y, m - 1, d, hh, mm, ss) // local wall-clock; TZID handling out of scope
    return {date, isDate: false}
}

const DURATION_RE = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
function parseIcsDuration(value) {
    const m = value.match(DURATION_RE)
    if (!m) return null
    const sign = m[1] === '-' ? -1 : 1
    const [, , weeks, days, hours, minutes, seconds] = m
    const totalMs = sign * (
        (+(weeks || 0)) * 7 * 86400000 +
        (+(days || 0)) * 86400000 +
        (+(hours || 0)) * 3600000 +
        (+(minutes || 0)) * 60000 +
        (+(seconds || 0)) * 1000
    )
    return totalMs
}

/** Parses ICS text into an array of VEVENT candidates. */
export function parseICS(icsText) {
    if (!icsText || typeof icsText !== 'string') return []
    const lines = unfoldLines(icsText)
    const events = []
    let current = null

    for (const rawLine of lines) {
        const parsed = parseLine(rawLine)
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
            case 'DTEND': {
                const {date} = parseIcsDateTime(value, params)
                current.end = date
                break
            }
            case 'DURATION':
                current.durationMs = parseIcsDuration(value)
                break
            case 'SUMMARY':
                current.summary = unescapeText(value)
                break
            case 'LOCATION':
                current.location = unescapeText(value)
                break
            case 'DESCRIPTION':
                current.description = unescapeText(value)
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
            if (!end) end = e.isAllDay
                ? new Date(e.start.getTime() + 86400000)
                : new Date(e.start.getTime() + 3600000)
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

const EVENT_TYPES = new Set(['Event', 'BusinessEvent', 'EducationEvent', 'MusicEvent', 'SportsEvent', 'TheaterEvent'])

/** Extracts schema.org Event objects from JSON-LD <script> blocks in an
 * HTML document. `doc` is any DOM-Document-like object with querySelectorAll
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
        const type = node['@type']
        const types = Array.isArray(type) ? type : [type]
        if (types.some(t => EVENT_TYPES.has(t))) {
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
            // Malformed JSON-LD is common in the wild; skip it rather than fail
            // the whole detection pass.
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
export function extractStructured({icsTexts = [], htmlDocument = null} = {}) {
    const results = []
    for (const icsText of icsTexts) results.push(...parseICS(icsText))
    if (htmlDocument) results.push(...parseJsonLdEvents(htmlDocument))
    return results
}
