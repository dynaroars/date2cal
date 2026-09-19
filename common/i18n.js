// PLAN.md Phase 6: minimal i18n helper for HTML pages. WebExtensions only
// auto-substitute __MSG_key__ placeholders inside manifest.json -- plain
// HTML text needs an explicit pass, so any element tagged with
// data-i18n="key" gets its textContent set from _locales/<locale>/
// messages.json via browser.i18n.getMessage(). Mirrors the pattern the
// project's thunderbird-webextensions skill references (thunderbird/
// webext-support's i18n.mjs), kept local and small since only two pages
// need it here.
export function localizeDocument(doc = document) {
    for (const el of doc.querySelectorAll('[data-i18n]')) {
        const key = el.getAttribute('data-i18n')
        const message = browser.i18n.getMessage(key)
        if (message) el.textContent = message
    }
}
