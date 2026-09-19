// Registers the highlight-dates content script for every future message
// display, and injects it into any message tabs already open right now.
//
// This module's top-level code re-runs every time the background page
// starts -- not just once per Thunderbird launch. MV3 background pages are
// non-persistent event pages: Thunderbird can suspend and later respawn this
// script during a single running session (e.g. after a period of
// inactivity), and scripting.messageDisplay.registerScripts() registrations
// persist across that respawn (that's the whole point of the API). So a
// second call with the same `id` throws "already registered" -- and since
// this used to be a bare top-level `await` with no try/catch, that respawn
// scenario killed inline highlighting on every message opened afterwards,
// with only a possibly-missed unhandled-rejection warning in the console.
// (Diagnosed after highlighting worked once, then silently stopped without
// any further changes to this file.)
const CONTENT_SCRIPT_ID = "pluginMailToEvent-highlightDates"

async function registerHighlightScriptOnce() {
    try {
        // Idempotent: drop any stale registration from a previous
        // background-page lifetime before re-registering, rather than
        // letting registerScripts() throw on a duplicate id.
        await messenger.scripting.messageDisplay.unregisterScripts({ids: [CONTENT_SCRIPT_ID]})
    } catch {
        // No existing registration to remove -- expected on a genuinely
        // fresh Thunderbird launch.
    }

    await messenger.scripting.messageDisplay.registerScripts([{
        id: CONTENT_SCRIPT_ID,
        js: [
            "content_scripts/highlight_dates/bundle/highlight_dates.bundle.js"
        ],
    }])
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// On a cold Thunderbird launch, this background page can start running
// before messenger.scripting is fully ready, and registerScripts() fails
// silently (caught below, logged, nothing else) -- observed as "highlighting
// doesn't work until the extension is disabled and re-enabled", which just
// gives the background page a later, better-timed restart. Retrying with
// backoff covers the same race without requiring that manual step.
async function registerHighlightScript() {
    const delaysMs = [0, 500, 2000]
    let lastError
    for (const delay of delaysMs) {
        if (delay) await sleep(delay)
        try {
            await registerHighlightScriptOnce()
            return
        } catch (e) {
            lastError = e
        }
    }
    throw lastError
}

async function injectIntoOpenMessageTabs() {
    const openTabs = await messenger.tabs.query()
    const messageTabs = openTabs.filter(tab => ["mail", "messageDisplay"].includes(tab.type))

    for (const messageTab of messageTabs) {
        try {
            await messenger.scripting.executeScript({
                target: {tabId: messageTab.id},
                files: [
                    "content_scripts/highlight_dates/bundle/highlight_dates.bundle.js"
                ],
            })
        } catch (e) {
            // One tab's message pane not being ready yet (or having already
            // navigated away) shouldn't stop the others from being tagged.
            console.error(`[date2cal] could not inject into tab ${messageTab.id}`, e)
        }
    }
}

try {
    await registerHighlightScript()
    await injectIntoOpenMessageTabs()
} catch (e) {
    console.error('[date2cal] failed to set up inline date highlighting', e)
}
