// Toolbar-button popup: a plain ranked list of detected candidates. No
// event-editing form here (see popup.css/highlight.js comments); clicking a
// row opens Thunderbird's own New Event dialog already prefilled, where the
// user reviews everything. This is also the fallback surface when inline
// highlighting can't attach to a particular message's DOM.
import {getCurrentMailDates} from "./mail-context.js";
import {createEvent} from "./create-event.js";

const WHEN_WITH_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
const WHEN_DATE_ONLY_FORMAT = new Intl.DateTimeFormat(undefined, {weekday: 'short', month: 'short', day: 'numeric'})

function formatWhen(candidate) {
    return candidate.isAllDay ? WHEN_DATE_ONLY_FORMAT.format(candidate.start) : WHEN_WITH_TIME_FORMAT.format(candidate.start)
}

function toEventPayload(candidate) {
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
    const result = await createEvent(toEventPayload(candidate))
    if (result?.error) {
        console.error('[date2cal] createEvent failed', result.error)
        window.alert(`Could not open the event dialog:\n${result.error?.message || result.error}`)
        return
    }
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

function renderEmptyState(subject, referenceDate, defaultDurationMinutes) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pluginMailToEvent-candidate'
    button.textContent = browser.i18n.getMessage('noDatesFoundCreateBlank')
    button.addEventListener('click', () => {
        const start = new Date(referenceDate)
        const end = new Date(start.getTime() + defaultDurationMinutes * 60000)
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
            textContent: browser.i18n.getMessage('noMessageOpen'),
        }))
        return
    }

    const {candidates, subject, referenceDate, settings} = result
    container.innerHTML = ''
    if (candidates.length === 0) {
        container.appendChild(renderEmptyState(subject, referenceDate, settings.defaultDurationMinutes))
        return
    }
    for (const candidate of candidates) {
        container.appendChild(renderCandidateRow(candidate))
    }
}

render()
