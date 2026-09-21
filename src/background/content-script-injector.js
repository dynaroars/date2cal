// Registers the highlight content script for every future message display,
// and injects it into any message tabs already open right now.
const CONTENT_SCRIPT_ID = "pluginMailToEvent-highlightDates"
const HIGHLIGHT_BUNDLE_PATH = "src/content/highlight/bundle/highlight.bundle.js"

async function registerHighlightScriptOnce() {
    try {
        // Idempotent: drop any stale registration from a previous
        // background-page lifetime before re-registering.
        await messenger.scripting.messageDisplay.unregisterScripts({ids: [CONTENT_SCRIPT_ID]})
    } catch {
        // Expected on a fresh launch.
    }

    await messenger.scripting.messageDisplay.registerScripts([{
        id: CONTENT_SCRIPT_ID,
        js: [HIGHLIGHT_BUNDLE_PATH],
    }])
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// On a cold Thunderbird launch, this background page can start running
// before messenger.scripting is fully ready, and registerScripts() fails
// silently (caught below) -- observed as "highlighting doesn't work until
// the extension is disabled and re-enabled", which just gives the
// background page a later, better-timed restart. Retrying with backoff
// covers the same race without requiring that manual step.
async function registerHighlightScript() {
    const retryDelaysMs = [0, 500, 2000]
    let lastError
    for (const delay of retryDelaysMs) {
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
                files: [HIGHLIGHT_BUNDLE_PATH],
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
