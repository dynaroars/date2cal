// PLAN.md Phase 3, step 16: toolbar-button popup. Slimmed down to a plain
// ranked list of detected candidates -- no event-editing form here either
// (see pop_up_button.css/highlight_dates.js comments); clicking a row opens
// Thunderbird's own New Event dialog (Phase 4) already prefilled, where the
// user reviews everything. This is also the fallback surface when inline
// highlighting can't attach to a particular message's DOM.
import {getCurrentMailDates} from "./current_mail_to_date.js";
import {createEvent} from "./create_calendar_event.js";

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
const DATE_ONLY_FORMAT = new Intl.DateTimeFormat(undefined, {weekday: 'short', month: 'short', day: 'numeric'})

function formatWhen(candidate) {
    return candidate.isAllDay ? DATE_ONLY_FORMAT.format(candidate.start) : TIME_FORMAT.format(candidate.start)
}

function candidateToEventPayload(candidate) {
    return {
        title: candidate.title,
        start: candidate.start,
        end: candidate.end,
        isAllDay: candidate.isAllDay,
        location: candidate.location,
        description: candidate.description,
        url: candidate.url,
        rrule: candidate.rrule,
    }
}

async function selectCandidate(candidate) {
    await createEvent(candidateToEventPayload(candidate))
    window.close()
}

function renderCandidateRow(candidate) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pluginMailToEvent-candidate'

    const when = document.createElement('span')
    when.className = 'pluginMailToEvent-candidate-when'
    when.textContent = formatWhen(candidate) + (candidate.recurrenceLabel ? ` · ${candidate.recurrenceLabel}` : '')

    const snippet = document.createElement('span')
    snippet.className = 'pluginMailToEvent-candidate-snippet'
    snippet.textContent = candidate.title || candidate.text

    button.append(when, snippet)
    button.addEventListener('click', () => selectCandidate(candidate))
    return button
}

function renderEmptyState(subject, referenceDate) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pluginMailToEvent-candidate'
    button.textContent = 'No dates found — create a blank event'
    button.addEventListener('click', () => {
        const start = new Date(referenceDate)
        const end = new Date(start.getTime() + 60 * 60000)
        selectCandidate({title: subject, start, end, isAllDay: false})
    })
    return button
}

async function render() {
    const container = document.getElementById('candidate-list')
    const result = await getCurrentMailDates()

    if (!result) {
        container.innerHTML = ''
        container.appendChild(Object.assign(document.createElement('div'), {
            className: 'pluginMailToEvent-empty',
            textContent: 'No message is open.',
        }))
        return
    }

    const {candidates, subject, referenceDate} = result
    container.innerHTML = ''
    if (candidates.length === 0) {
        container.appendChild(renderEmptyState(subject, referenceDate))
        return
    }
    for (const candidate of candidates) {
        container.appendChild(renderCandidateRow(candidate))
    }
}

render()
