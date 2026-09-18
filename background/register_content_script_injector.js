await messenger.scripting.messageDisplay.registerScripts([{
    id: "pluginMailToEvent-highlightDates",
    js: [
        "content_scripts/highlight_dates/bundle/highlight_dates.bundle.js"
    ],
}]);


// Inject script in all every open message tabs.
let openTabs = await messenger.tabs.query();
let messageTabs = openTabs.filter(
    tab => ["mail", "messageDisplay"].includes(tab.type)
);
for (let messageTab of messageTabs) {
    await messenger.scripting.executeScript({
        target: {tabId: messageTab.id},
        files: [
            "content_scripts/highlight_dates/bundle/highlight_dates.bundle.js"
        ],
    })
}