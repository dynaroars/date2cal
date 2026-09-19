// PLAN.md Phase 3: highlights detected dates inline in the message body.
// Deliberately thin -- detection and DOM handling live in tag_dates.js /
// dom_text_walker.js; this file just wires the background message round-trip
// (for context content scripts can't fetch themselves) and routes clicks to
// event creation. No custom event-editing form here: clicking a highlighted
// date opens Thunderbird's own New Event dialog directly (Phase 4) -- see
// PLAN.md Phase 3 for why the earlier draggable custom-popup UI was dropped.
//
// Always on -- this is the add-on's core feature (the macOS-Mail-style
// behavior it exists to provide), not an optional extra, so there is no
// settings toggle for it.
import {tagMailContentDates} from "./tag_dates.js";
import cssText from "../../create_event_button/pop_up_button.css";

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
    try {
        const context = await browser.runtime.sendMessage({action: 'getDetectionContext'})
        if (!context) return // no message currently displayed

        tagMailContentDates(document, document.body, context, onCandidateSelected)
    } catch (e) {
        // Detection running against this specific message's DOM should
        // never take down the message view itself -- log and move on.
        console.error('[date2cal] highlighting failed', e)
    }
}

highlightEmailDates()
