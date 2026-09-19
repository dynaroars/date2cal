import {createEvent} from "../create_event_button/create_calendar_event.js";
import {getCurrentMailDates} from "../create_event_button/current_mail_to_date.js";

async function resolveCalendarId(requestedCalendarId) {
    if (requestedCalendarId) return requestedCalendarId

    const {defaultCalendarId} = await browser.storage.local.get("defaultCalendarId")
    if (defaultCalendarId) return defaultCalendarId

    const calendars = await messenger.calendar.calendars.query({visible: true, readOnly: false, enabled: true})
    return calendars[0]?.id
}

async function createCalendarEvent(message) {
    const calendarId = await resolveCalendarId(message.calendarId)
    return createEvent({...message.event, calendarId})
}

// https://webextension-api.thunderbird.net/en/mv3/guides/runtimeMessaging.html
browser.runtime.onMessage.addListener((message) => {
    const action = message?.action
    if (action === 'detectEvents') {
        // Used by both the toolbar popup and the highlight-dates content
        // script (content scripts don't have direct messenger.* access, so
        // they go through this instead of calling getCurrentMailDates()
        // themselves -- see content_scripts/highlight_dates/highlight_dates.js).
        return getCurrentMailDates()
    }
    else if (action === 'getCalendars') {
        return messenger.calendar.calendars.query({visible: true, readOnly: false, enabled: true})
    }
    else if (action === 'getTimezone') {
        return Promise.resolve(messenger.calendar.timezones.currentZone)
    }
    else if (action === 'createCalendarEvent') {
        return createCalendarEvent(message)
    }
    // Not handled by this listener: return nothing so other listeners can respond.
})
