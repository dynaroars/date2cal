import {createEvent} from "../create_event_button/create_calendar_event.js";
import {getCurrentMailDates, getCurrentMessageContext} from "../create_event_button/current_mail_to_date.js";

// https://webextension-api.thunderbird.net/en/mv3/guides/runtimeMessaging.html
browser.runtime.onMessage.addListener((message) => {
    const action = message?.action
    if (action === 'detectEvents') {
        // Used by the toolbar popup, which has no DOM of its own to run
        // detection against.
        return getCurrentMailDates()
    }
    else if (action === 'getDetectionContext') {
        // Used by the highlight-dates content script, which has its own
        // (better) view of the body -- the real rendered DOM -- and only
        // needs the parts it can't read itself: subject, reference date,
        // date-order preference, and any .ics attachments. Content scripts
        // don't have direct messenger.* access, hence the message round-trip.
        return getCurrentMessageContext()
    }
    else if (action === 'getTimezone') {
        return Promise.resolve(messenger.calendar.timezones.currentZone)
    }
    else if (action === 'createCalendarEvent') {
        // createEvent() resolves a default calendar itself when
        // message.event.calendarId is omitted.
        return createEvent(message.event)
    }
    // Not handled by this listener: return nothing so other listeners can respond.
})
