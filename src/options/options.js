// Options page. The only writer of these storage.local keys -- every other
// file (mail-context.js, create-event.js, context-menu.js, highlight.js)
// only reads them via src/settings.js's getSettings().
import {getSettings} from "../settings.js";
import {localizeDocument} from "../i18n.js";

localizeDocument()

const dateOrderSelect = document.getElementById('date-order')
const calendarSelect = document.getElementById('calendar-select')
const defaultDurationInput = document.getElementById('default-duration')
const businessHoursMeridiemCheckbox = document.getElementById('business-hours-meridiem')
const saveStatus = document.getElementById('save-status')

let saveStatusTimer = null
function showSaved() {
    saveStatus.textContent = browser.i18n.getMessage('optionsSaved')
    clearTimeout(saveStatusTimer)
    saveStatusTimer = setTimeout(() => { saveStatus.textContent = '' }, 1500)
}

async function save(key, value) {
    await browser.storage.local.set({[key]: value})
    showSaved()
}

async function populateCalendars(selectedId) {
    calendarSelect.innerHTML = ''
    let calendars = []
    try {
        calendars = await messenger.calendar.calendars.query({visible: true, readOnly: false, enabled: true})
    } catch {
        // Calendar list unavailable (e.g. no calendars configured yet) --
        // leave the dropdown empty rather than failing the whole page.
    }

    for (const calendar of calendars) {
        const option = document.createElement('option')
        option.value = calendar.id
        option.textContent = calendar.name || calendar.id
        calendarSelect.appendChild(option)
    }

    if (selectedId && calendars.some(c => c.id === selectedId)) {
        calendarSelect.value = selectedId
    }
}

async function init() {
    const settings = await getSettings()

    dateOrderSelect.value = settings.defaultDateOrder
    defaultDurationInput.value = settings.defaultDurationMinutes
    businessHoursMeridiemCheckbox.checked = settings.businessHoursMeridiem
    await populateCalendars(settings.defaultCalendarId)

    dateOrderSelect.addEventListener('change', () => save('defaultDateOrder', dateOrderSelect.value))
    calendarSelect.addEventListener('change', () => save('defaultCalendarId', calendarSelect.value))

    defaultDurationInput.addEventListener('change', () => {
        const minutes = parseInt(defaultDurationInput.value, 10)
        if (!Number.isFinite(minutes) || minutes <= 0) return
        save('defaultDurationMinutes', minutes)
    })

    businessHoursMeridiemCheckbox.addEventListener('change', () => {
        save('businessHoursMeridiem', businessHoursMeridiemCheckbox.checked)
    })
}

init()
