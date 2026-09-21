// "Create event from selection" -- the escape hatch for when automatic
// detection misses something. menus.onClicked already gives us the selected
// text directly (info.selectionText), so no content-script round trip is
// needed for the selection itself; only the message's reference date and
// options-page settings come from getCurrentMessageContext().
import {detectEvents} from "../detect/index.js";
import {createEvent} from "../popup/create-event.js";
import {getCurrentMessageContext} from "../popup/mail-context.js";
import {SETTINGS_DEFAULTS} from "../settings.js";

const MENU_ID = 'date2cal-from-selection'

async function registerMenu() {
    try {
        // Idempotent for the same reason as content-script-injector.js: this
        // top-level code re-runs whenever the (non-persistent, MV3)
        // background page respawns within a single Thunderbird session, and
        // menu registrations persist across that respawn -- so a second
        // create() with the same id throws.
        await messenger.menus.remove(MENU_ID)
    } catch {
        // No existing menu item to remove -- expected on a fresh launch.
    }
    await messenger.menus.create({
        id: MENU_ID,
        title: browser.i18n.getMessage('contextMenuCreateEvent'),
        contexts: ['selection'],
    })
}

registerMenu().catch(e => console.error('date2cal: failed to register context menu', e))

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
    const best = candidates[0]

    if (best) {
        await createEvent({
            title: best.title || selectionText.slice(0, 80),
            start: best.start,
            end: best.end,
            isAllDay: best.isAllDay,
            location: best.location,
            description: best.description,
            url: best.url,
            rrule: best.rrule,
        })
    } else {
        const start = new Date(referenceDate)
        const end = new Date(start.getTime() + settings.defaultDurationMinutes * 60000)
        await createEvent({title: selectionText.slice(0, 80), start, end, isAllDay: false})
    }
})
