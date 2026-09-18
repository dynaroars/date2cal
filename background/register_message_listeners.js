import {createEvent} from "../create_event_button/create_calendar_event.js";
import {findDates} from "../common/find_dates.js";

async function createCalendarEvent(message) {
    let calendarId = message.calendarId
    if (!calendarId) {
        const {defaultCalendarId} = await browser.storage.local.get("defaultCalendarId")
        calendarId = defaultCalendarId
    }
    if (!calendarId) {
        const calendars = await messenger.calendar.calendars.query({visible: true, readOnly: false, enabled: true})
        calendarId = calendars[0].id
    }
    return createEvent(calendarId, ...message.args)
}


// https://webextension-api.thunderbird.net/en/mv3/guides/runtimeMessaging.html
browser.runtime.onMessage.addListener((message) => {
    const action = message?.action
    if (action === 'findDates') {
        return Promise.resolve(findDates(message.mailSubject, message.mailContentPlainText, message.removeDuplicatesDates, messenger.calendar.timezones.currentZone).dates)
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
