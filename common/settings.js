// PLAN.md Phase 6: options-page settings, read from storage.local with one
// set of defaults shared by every caller (popup, content script, context
// menu, options page itself) -- avoids the key names/defaults drifting
// between files. `browser.storage` is a plain WebExtension API available in
// content scripts too (given the "storage" permission), so this needs no
// message round-trip.
export const SETTINGS_DEFAULTS = {
    defaultDateOrder: 'MDY',
    defaultCalendarId: null,
    defaultDurationMinutes: 60,
    businessHoursMeridiem: true,
    inlineHighlightEnabled: true,
}

export async function getSettings() {
    const stored = await browser.storage.local.get(Object.keys(SETTINGS_DEFAULTS))
    return {...SETTINGS_DEFAULTS, ...stored}
}
