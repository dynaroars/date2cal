/**
 * Populates a timezone <select> element and wires up the "Set as default" checkbox.
 * @param {HTMLSelectElement} selectEl
 * @param {HTMLInputElement} defaultCheckboxEl
 * @param {() => string | Promise<string>} getCurrentZone - returns the current timezone ID
 */
export async function populateTimezoneSelector(selectEl, defaultCheckboxEl, getCurrentZone) {
    const timezoneIds = Intl.supportedValuesOf('timeZone')
    const currentZone = getCurrentZone
        ? await getCurrentZone()
        : Intl.DateTimeFormat().resolvedOptions().timeZone

    timezoneIds.forEach((tzId) => {
        const option = document.createElement('option')
        option.value = tzId
        option.textContent = tzId
        selectEl.appendChild(option)
    })

    const {defaultTimezone} = await browser.storage.local.get("defaultTimezone")
    if (defaultTimezone && timezoneIds.includes(defaultTimezone)) {
        selectEl.value = defaultTimezone
        defaultCheckboxEl.checked = true
    } else {
        selectEl.value = currentZone
    }

    defaultCheckboxEl.addEventListener("change", async () => {
        if (defaultCheckboxEl.checked) {
            await browser.storage.local.set({defaultTimezone: selectEl.value})
        } else {
            await browser.storage.local.remove("defaultTimezone")
        }
    })

    selectEl.addEventListener("change", async () => {
        if (defaultCheckboxEl.checked) {
            await browser.storage.local.set({defaultTimezone: selectEl.value})
        }
    })
}
