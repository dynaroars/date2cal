// PLAN.md Phase 4: hands the detected event to Thunderbird's own New Event
// dialog (via calendar.items.createWithDialog, see
// experiments/calendar/parent/ext-calendar-items.js) instead of writing it
// directly. There is no "created item" to return here -- the dialog is
// user-driven; the user may edit anything and either save or cancel it.
const calendarItems = messenger.calendar.items

function generateUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// jCal RECUR value type is a structured object, not a bare string --
// converts an RFC 5545 RRULE string ("FREQ=WEEKLY;BYDAY=MO") into that shape.
const MULTI_VALUE_KEYS = new Set(['byday', 'bymonthday', 'bymonth', 'byyearday', 'byweekno', 'bysetpos'])
const NUMERIC_KEYS = new Set(['interval', 'count'])

function rruleStringToJCal(rrule) {
    const recur = {}
    for (const part of rrule.split(';')) {
        const [rawKey, rawValue] = part.split('=')
        if (!rawKey || rawValue === undefined) continue
        const key = rawKey.toLowerCase()
        if (MULTI_VALUE_KEYS.has(key)) {
            recur[key] = rawValue.split(',')
        } else if (NUMERIC_KEYS.has(key)) {
            recur[key] = parseInt(rawValue, 10)
        } else {
            recur[key] = rawValue
        }
    }
    return recur
}

function toDateComponents(date) {
    // jCal date-time components: [year, month, day, hour, minute, second, isUtc]
    return [
        date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
        date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), true,
    ]
}

function toDateOnlyComponents(date) {
    return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
}

/** Resolves which calendar to prefill the dialog with: the one explicitly
 * requested, else the user's saved default, else the first available
 * calendar. Shared by every caller (popup, background message listener,
 * future context menu) so "what's the default calendar" has one answer. */
async function resolveCalendarId(requestedCalendarId) {
    if (requestedCalendarId) return requestedCalendarId

    const {defaultCalendarId} = await browser.storage.local.get('defaultCalendarId')
    if (defaultCalendarId) return defaultCalendarId

    const calendars = await messenger.calendar.calendars.query({visible: true, readOnly: false, enabled: true})
    return calendars[0]?.id
}

/**
 * Opens Thunderbird's New Event dialog prefilled from a detected candidate.
 *
 * @param {object} event
 * @param {string} [event.calendarId] - defaults to the saved default calendar,
 *   then the first available one, if omitted.
 * @param {string} event.title
 * @param {Date} event.start
 * @param {Date} event.end
 * @param {boolean} [event.isAllDay]
 * @param {string} [event.location]
 * @param {string} [event.description]
 * @param {string} [event.url]
 * @param {string} [event.rrule] - RFC 5545 RRULE string, e.g. "FREQ=WEEKLY;BYDAY=MO"
 * @param {string} [event.timezone] - IANA zone; only meaningful when !isAllDay
 */
export async function createEvent({
    calendarId: requestedCalendarId, title, start, end, isAllDay = false,
    location, description, url, rrule, timezone,
}) {
    const calendarId = await resolveCalendarId(requestedCalendarId)
    const uid = generateUID()

    const valueType = isAllDay ? 'date' : 'date-time'
    const tzParam = (!isAllDay && timezone) ? {tzid: timezone} : {}
    const startValue = isAllDay ? toDateOnlyComponents(start) : toDateComponents(start)
    const endValue = isAllDay ? toDateOnlyComponents(end) : toDateComponents(end)

    const properties = [
        ['dtstart', tzParam, valueType, startValue],
        ['dtend', tzParam, valueType, endValue],
        ['summary', {}, 'text', title || ''],
        ['uid', {}, 'text', uid],
    ]
    if (description) properties.push(['description', {}, 'text', description])
    if (location) properties.push(['location', {}, 'text', location])
    if (url) properties.push(['url', {}, 'uri', url])
    if (rrule) properties.push(['rrule', {}, 'recur', rruleStringToJCal(rrule)])

    try {
        await calendarItems.createWithDialog(calendarId, {
            format: 'jcal',
            type: 'event',
            id: uid,
            allDay: isAllDay,
            item: ['vevent', properties, []],
        })
    } catch (e) {
        return {error: e}
    }
    return {opened: true, uid}
}
