// PLAN.md Phase 4: hands the detected event to Thunderbird's own New Event
// dialog (via calendar.items.createWithDialog, see
// experiments/calendar/parent/ext-calendar-items.js) instead of writing it
// directly. There is no "created item" to return here -- the dialog is
// user-driven; the user may edit anything and either save or cancel it.
import {getSettings} from "../common/settings.js";

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

// jCal DATE/DATE-TIME values are formatted strings, NOT arrays of numbers --
// confirmed against Thunderbird's actual ICAL.js (Ical.sys.mjs
// Time.fromDateTimeString/fromDateString): it slices fixed character
// positions out of a string like "2015-01-02T03:04:05Z" (jCal's ISO-8601
// extended form, per RFC 7265 -- distinct from classic iCal's compact
// "20150102T030405Z" wire format). An earlier version of this file passed
// [year, month, day, ...] arrays instead; ICAL.js's slice() calls on that
// array produced empty strings, which its own strictParseInt() then
// rejected with "Could not extract integer from \"\"" -- caught by
// clicking a highlighted date in a real Thunderbird session, not by any
// mocked test (the mock only checked internal consistency of this file's
// own output, not the real consumer's actual parsing contract).
function pad(n, len = 2) {
    return String(n).padStart(len, '0')
}

/** UTC date-time string with trailing Z -- used whenever no explicit tzid
 * parameter is set (the case for every caller today; timezone-aware zoned
 * events are supported below but nothing currently supplies `timezone`). */
function toUtcDateTimeString(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
        `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
}

/** Wall-clock date-time string (no Z) for a specific IANA zone -- the TZID
 * parameter itself declares the zone per RFC 5545/jCal, so the value must
 * NOT also carry a Z suffix or UTC components. */
function toZonedDateTimeString(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc }, {})
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

/** DATE values have no time-zone concept at all -- use the calendar day the
 * candidate represents (local components, not UTC: an all-day match
 * shouldn't shift to a different calendar day because of a UTC offset). */
function toDateOnlyString(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Resolves which calendar to prefill the dialog with: the one explicitly
 * requested, else the user's saved default, else the first available
 * calendar. Shared by every caller (popup, background message listener,
 * future context menu) so "what's the default calendar" has one answer. */
async function resolveCalendarId(requestedCalendarId) {
    if (requestedCalendarId) return requestedCalendarId

    const {defaultCalendarId} = await getSettings()
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

    const formatValue = (date) => {
        if (isAllDay) return toDateOnlyString(date)
        return timezone ? toZonedDateTimeString(date, timezone) : toUtcDateTimeString(date)
    }
    const startValue = formatValue(start)
    const endValue = formatValue(end)

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
