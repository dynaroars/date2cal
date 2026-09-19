// Registers the highlight-dates content script for every future message
// display, and injects it into any message tabs already open right now.
const CONTENT_SCRIPT_ID = "pluginMailToEvent-highlightDates"

async function registerHighlightScript() {
    try {
        // Idempotent: drop any stale registration from a previous
        // background-page lifetime before re-registering.
        await messenger.scripting.messageDisplay.unregisterScripts({ids: [CONTENT_SCRIPT_ID]})
    } catch {
        // Expected on a fresh launch.
    }

    await messenger.scripting.messageDisplay.registerScripts([{
        id: CONTENT_SCRIPT_ID,
        js: [
            "content_scripts/highlight_dates/bundle/highlight_dates.bundle.js"
        ],
    }])
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
            // One tab's message pane not being ready yet shouldn't stop others.
            console.error(`[date2cal] could not inject into tab ${messageTab.id}`, e)
        }
    }
}

// On Manifest V3, background scripts are non-persistent event pages.
// Registering top-level listeners ensures Thunderbird launches the
// background page on startup and install.
browser.runtime.onStartup.addListener(() => {})
browser.runtime.onInstalled.addListener(() => {})

async function init() {
    try {
        const {initialized} = await browser.storage.session.get({initialized: false})
        if (initialized) return

        await registerHighlightScript()
        await injectIntoOpenMessageTabs()
        await browser.storage.session.set({initialized: true})
    } catch (e) {
        console.error('[date2cal] failed to set up inline date highlighting', e)
    }
}

init()
