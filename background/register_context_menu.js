// PLAN.md Phase 3, step 17: "Create event from selection" -- the escape
// hatch for when automatic detection misses something. menus.onClicked
// already gives us the selected text directly (info.selectionText), so no
// content-script round trip is needed for the selection itself; only the
// message's reference date and options-page settings come from
// getCurrentMessageContext().
import {detectEvents} from "../common/find_dates.js";
import {createEvent} from "../create_event_button/create_calendar_event.js";
import {getCurrentMessageContext} from "../create_event_button/current_mail_to_date.js";
import {SETTINGS_DEFAULTS} from "../common/settings.js";

const MENU_ID = 'detect-cal-event-from-selection'

messenger.menus.create({
    id: MENU_ID,
    title: browser.i18n.getMessage('contextMenuCreateEvent'),
    contexts: ['selection'],
})

messenger.menus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== MENU_ID) return
    const selectionText = info.selectionText
    if (!selectionText) return

    const context = await getCurrentMessageContext().catch(() => null)
    const referenceDate = context?.referenceDate ?? new Date()
    const settings = context?.settings ?? SETTINGS_DEFAULTS

    // A user-selected snippet is unambiguous by construction -- no candidate
    // list needed here, unlike the toolbar popup. Take the highest-ranked
    // match, or fall back to a blank event using the selection itself as the
    // title if nothing was detected (mirrors the toolbar popup's empty-state
    // fallback).
    const {candidates} = detectEvents({
        subject: '',
        body: selectionText,
        referenceDate,
        dateOrder: settings.defaultDateOrder,
        businessHoursMeridiem: settings.businessHoursMeridiem,
        defaultDurationMinutes: settings.defaultDurationMinutes,
    })
    const top = candidates[0]

    if (top) {
        await createEvent({
            title: top.title || selectionText.slice(0, 80),
            start: top.start,
            end: top.end,
            isAllDay: top.isAllDay,
            location: top.location,
            description: top.description,
            url: top.url,
            rrule: top.rrule,
        })
    } else {
        const start = new Date(referenceDate)
        const end = new Date(start.getTime() + settings.defaultDurationMinutes * 60000)
        await createEvent({title: selectionText.slice(0, 80), start, end, isAllDay: false})
    }
})
