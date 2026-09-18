/**
 * Populates a calendar <select> element and wires up the "Set as default" checkbox.
 * @param {HTMLSelectElement} selectEl
 * @param {HTMLInputElement} defaultCheckboxEl
 * @param {() => Promise<Array>} getCalendars - async function returning calendar list
 */
export async function populateCalendarSelector(selectEl, defaultCheckboxEl, getCalendars) {
    const calendars = await getCalendars()

    calendars.forEach((cal) => {
        const option = document.createElement('option')
        option.value = cal.id
        option.textContent = cal.name
        selectEl.appendChild(option)
    })

    const {defaultCalendarId} = await browser.storage.local.get("defaultCalendarId")
    if (defaultCalendarId && calendars.some(c => c.id === defaultCalendarId)) {
        selectEl.value = defaultCalendarId
        defaultCheckboxEl.checked = true
    }

    defaultCheckboxEl.addEventListener("change", async () => {
        if (defaultCheckboxEl.checked) {
            await browser.storage.local.set({defaultCalendarId: selectEl.value})
        } else {
            await browser.storage.local.remove("defaultCalendarId")
        }
    })

    selectEl.addEventListener("change", async () => {
        if (defaultCheckboxEl.checked) {
            await browser.storage.local.set({defaultCalendarId: selectEl.value})
        }
    })
}
