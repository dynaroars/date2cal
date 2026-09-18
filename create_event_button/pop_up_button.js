import {createEventFormTop, createEventFormBottom} from "../common/event_form.js";
import {getCurrentMailDates} from "./current_mail_to_date.js";
import {setupDateRangeSync} from "../common/date_range_sync.js";

// Insert top fields (title, calendar, timezone) before the dates selector
const {fragment: topFragment} = createEventFormTop()
const datesSelector = document.getElementById('dates-selector')
datesSelector.parentNode.insertBefore(topFragment, datesSelector)

// Insert bottom fields (location, description) before the create button
const {fragment: bottomFragment} = createEventFormBottom()
const createBtn = document.getElementById('create-calendar-event')
createBtn.parentNode.insertBefore(bottomFragment, createBtn)

// Import interaction only after form fields are in the DOM
await import("./pop_up_interaction.js")

const showFoundDates = (dates) => {
    const datesContainer = document.getElementById('dates-selector');
    const endDateEl = document.getElementById('end-date-input')
    dates.map((oneFoundDate) => {
        let container = document.createElement("div",)
        container.className = "one-date-selector"

        const dateInput = document.createElement('input');

        dateInput.className = "start-date-input"
        dateInput.type = 'datetime-local';
        dateInput.value = oneFoundDate.startDateTime.dateISO.slice(0, 16)
        dateInput.endDate = oneFoundDate.endDateTime.dateISO.slice(0, 16)
        dateInput._syncer = setupDateRangeSync(dateInput, endDateEl, dateInput.endDate)

        let selectOneDateInput = document.createElement('input');
        selectOneDateInput.type = "submit"
        selectOneDateInput.value = "select"
        selectOneDateInput.className = "submit-start-date"

        container.append(dateInput)
        container.append(selectOneDateInput)

        datesContainer.appendChild(container);
    })
}

const {dates, subject, messageId, detectedLanguage} = await getCurrentMailDates()
document.getElementById("event-title").value = subject
if (detectedLanguage) {
    document.getElementById("detected-language").textContent = detectedLanguage
}
if (dates.length > 0) {
    showFoundDates(dates)
    if (dates.length === 1) {
        document.querySelector('.submit-start-date').click()
    }
} else {
    const now = new Date()
    const offset = now.getTimezoneOffset() * 60000
    const startDate = new Date(now - offset)
    const endDate = new Date(now - offset + 30 * 60000)
    showFoundDates([{
        startDateTime: {dateISO: startDate.toISOString(), dateJS: startDate},
        endDateTime: {dateISO: endDate.toISOString(), dateJS: endDate},
    }])
}

const formContainer = document.querySelector('.pluginMailToEvent-event-creator')
if (messageId) {
    formContainer.dataset.messageId = messageId
}

const storageKey = messageId ? `emailFormData_${messageId}` : null

const saveFormData = async () => {
    if (!storageKey) return
    const startDateInputs = Array.from(document.getElementsByClassName('start-date-input'))
    const selectedInput = document.querySelector(".start-date-input[aria-selected='true']")
    await browser.storage.session.set({
        [storageKey]: {
            title: document.getElementById('event-title')?.value,
            location: document.getElementById('event-location')?.value,
            comment: document.getElementById('event-comment')?.value,
            startDates: startDateInputs.map(input => input.value),
            selectedDateIndex: selectedInput ? startDateInputs.indexOf(selectedInput) : -1,
            selectedEndDate: document.getElementById('end-date-input')?.value,
            allDay: document.getElementById('all-day')?.checked,
        }
    })
}

// Restore saved values per email (session storage — lost when Thunderbird closes)
if (storageKey) {
    const saved = await browser.storage.session.get(storageKey)
    const savedFormData = saved[storageKey]
    if (savedFormData) {
        if (savedFormData.title) document.getElementById('event-title').value = savedFormData.title
        if (savedFormData.location) document.getElementById('event-location').value = savedFormData.location
        if (savedFormData.comment) document.getElementById('event-comment').value = savedFormData.comment

        const startDateInputs = Array.from(document.getElementsByClassName('start-date-input'))

        if (savedFormData.startDates) {
            savedFormData.startDates.forEach((date, i) => {
                if (startDateInputs[i]) startDateInputs[i].value = date
            })
        }

        if (savedFormData.selectedDateIndex >= 0) {
            const selectedInput = startDateInputs[savedFormData.selectedDateIndex]
            if (selectedInput) {
                selectedInput.endDate = savedFormData.selectedEndDate
                selectedInput.parentElement.querySelector('.submit-start-date').click()
            }
        }

        if (savedFormData.selectedEndDate) {
            document.getElementById('end-date-input').value = savedFormData.selectedEndDate
        }

        if (savedFormData.allDay) {
            const allDayCheckbox = document.getElementById('all-day')
            allDayCheckbox.checked = true
            allDayCheckbox.dispatchEvent(new Event('change'))
        }
    }
}

formContainer.addEventListener('input', saveFormData)
document.getElementById('all-day').addEventListener('change', saveFormData)

// Save when a date row is selected — fires after pop_up_interaction.js's listener updates ariaSelected
document.getElementById('dates-selector').addEventListener('click', (e) => {
    if (e.target.className === 'submit-start-date') saveFormData()
})
