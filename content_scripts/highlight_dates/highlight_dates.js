// PLAN.md Phase 3: highlights detected dates inline in the message body.
// Deliberately thin -- detection and DOM handling live in tag_dates.js /
// dom_text_walker.js; this file just wires the background message round-trip
// (for context content scripts can't fetch themselves) and routes clicks to
// event creation. No custom event-editing form here: clicking a highlighted
// date opens Thunderbird's own New Event dialog directly (Phase 4) -- see
// PLAN.md Phase 3 for why the earlier draggable custom-popup UI was dropped.
import {tagMailContentDates} from "./tag_dates.js";
import {getSettings} from "../../common/settings.js";
import cssText from "../../create_event_button/pop_up_button.css";

// Unconditional, unmissable breadcrumb: proves the content script is even
// running at all, independent of anything below succeeding or failing.
// TEMPORARY diagnostic logging while tracking down why highlighting isn't
// appearing in a real Thunderbird session with no errors visible in any
// console mode -- remove once confirmed working (see chat).
console.log('[detect-cal-event] content script loaded, url=', location.href)

const style = document.createElement('style')
style.textContent = cssText
document.head.appendChild(style)

function candidateToEventPayload(candidate) {
    return {
        title: candidate.title,
        start: candidate.start,
        end: candidate.end,
        isAllDay: candidate.isAllDay,
        location: candidate.location,
        description: candidate.description,
        url: candidate.url,
        rrule: candidate.rrule,
    }
}

async function onCandidateSelected(candidate) {
    await browser.runtime.sendMessage({
        action: 'createCalendarEvent',
        event: candidateToEventPayload(candidate),
    })
}

async function highlightEmailDates() {
    console.log('[detect-cal-event] highlightEmailDates() starting')
    try {
        // browser.storage is a plain WebExtension API available in content
        // scripts (given the "storage" permission) -- no message round-trip
        // needed for this one setting.
        const settings = await getSettings()
        console.log('[detect-cal-event] settings:', settings)
        if (!settings.inlineHighlightEnabled) {
            console.log('[detect-cal-event] inline highlighting disabled in settings, stopping')
            return
        }

        const context = await browser.runtime.sendMessage({action: 'getDetectionContext'})
        console.log('[detect-cal-event] context from background:', context)
        if (!context) {
            console.log('[detect-cal-event] no context (no message currently displayed?), stopping')
            return
        }

        const result = tagMailContentDates(document, document.body, context, onCandidateSelected)
        console.log('[detect-cal-event] tagMailContentDates result:', result)
    } catch (e) {
        // Detection running against this specific message's DOM should
        // never take down the message view itself -- log and move on.
        console.error('[detect-cal-event] highlighting failed', e)
    }
}

highlightEmailDates().catch(e => console.error('[detect-cal-event] unhandled error', e))
