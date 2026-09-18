import {createEvent} from "./create_calendar_event.js";
import {populateCalendarSelector} from "../common/calendar_selector.js";
import {populateTimezoneSelector} from "../common/timezone_selector.js";
import {handleCreateResult, setCreating} from "../common/create_event_result.js";
import {setupAllDayToggle} from "../common/all_day_toggle.js";

setupAllDayToggle(
    document.getElementById('all-day'),
    () => Array.from(document.getElementsByClassName('start-date-input')),
    document.getElementById('end-date-input'),
    (_allDay, endInput) => {
        const selected = document.querySelector(".start-date-input[aria-selected='true']")
        if (selected?._syncer) selected._syncer.reset(selected.value, endInput.value)
    }
)

const calendarSelector = document.getElementById("calendar-selector")
const setDefaultCheckbox = document.getElementById("set-default-calendar")

await populateCalendarSelector(
    calendarSelector,
    setDefaultCheckbox,
    () => messenger.calendar.calendars.query({visible: true, readOnly: false, enabled: true})
)

const timezoneSelector = document.getElementById("timezone-selector")
const setDefaultTimezoneCheckbox = document.getElementById("set-default-timezone")

await populateTimezoneSelector(timezoneSelector, setDefaultTimezoneCheckbox, () => messenger.calendar.timezones.currentZone)

const resetAriaSelected = () => {
    Array.from(document.getElementsByClassName('start-date-input')).forEach((e) => {
        e.ariaSelected = "false"
    })
}

document.getElementById("dates-selector").addEventListener('click',
    (clickedElement) => {
        if (clickedElement.target.className === "submit-start-date") {
            resetAriaSelected()

            const startDatePicker = clickedElement.target.parentElement.getElementsByClassName('start-date-input')?.[0];
            startDatePicker.ariaSelected = "true"
            startDatePicker._syncer.reset(startDatePicker.value, startDatePicker.endDate)

            const allDay = document.getElementById('all-day').checked
            const endDate = allDay ? startDatePicker.endDate.slice(0, 10) : startDatePicker.endDate
            const startDate = allDay ? startDatePicker.value.slice(0, 10) : startDatePicker.value
            document.getElementById('end-date-input').value = (allDay && endDate < startDate) ? startDate : endDate
            document.getElementById('create-calendar-event').disabled = false
        }
    })

document.getElementById("dates-selector").addEventListener('input',
    (event) => {
        if (event.target.className !== "start-date-input") return

        if (event.target.ariaSelected !== "true") {
            resetAriaSelected()
            event.target.ariaSelected = "true"
            document.getElementById('create-calendar-event').disabled = false
        }
    })

document.getElementById("create-calendar-event").addEventListener('click',
    async () => {
        const selectedStartDate = document.querySelector(".start-date-input[aria-selected='true']")?.value
        const selectedEndDate = document.getElementById('end-date-input')?.value
        const title = document.getElementById('event-title').value
        const comment = document.getElementById('event-comment').value || ""
        const location = document.getElementById('event-location').value || ""
        const btn = document.getElementById("create-calendar-event")

        if (selectedStartDate && selectedEndDate && title) {
            setCreating(btn)

            const allDay = document.getElementById('all-day').checked
            const result = await createEvent(
                calendarSelector.value,
                allDay ? selectedStartDate : selectedStartDate + ':00',
                allDay ? selectedEndDate : selectedEndDate + ':00',
                title,
                comment,
                timezoneSelector.value,
                location,
                allDay
            )

            handleCreateResult(btn, result, async () => {
                const messageId = document.querySelector('.pluginMailToEvent-event-creator')?.dataset.messageId
                if (messageId) {
                    await browser.storage.session.remove(`emailFormData_${messageId}`)
                }
            })
        }
    })
