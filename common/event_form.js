/**
 * Creates the shared top form fields: title, calendar selector, timezone selector.
 * Insert these BEFORE the date picker section.
 * @param {string} idPrefix - unique prefix for element IDs (leave empty for the popup)
 */
export function createEventFormTop(idPrefix = '') {
    const p = id => idPrefix ? `${idPrefix}-${id}` : id
    const ids = {
        eventTitle:              p('event-title'),
        calendarSelectorSection: p('calendar-selector-section'),
        calendarSelector:        p('calendar-selector'),
        setDefaultCalendar:      p('set-default-calendar'),
        timezoneSelectorSection: p('timezone-selector-section'),
        timezoneSelector:        p('timezone-selector'),
        setDefaultTimezone:      p('set-default-timezone'),
    }

    const fragment = document.createDocumentFragment()

    // Title
    const titleInput = document.createElement('input')
    titleInput.type = 'text'
    titleInput.id = ids.eventTitle
    titleInput.placeholder = 'Event title'
    fragment.appendChild(titleInput)

    // Calendar section
    const calSection = document.createElement('div')
    calSection.id = ids.calendarSelectorSection
    calSection.className = 'pluginMailToEvent-calendarSection'

    const calSelect = document.createElement('select')
    calSelect.id = ids.calendarSelector
    calSection.appendChild(calSelect)

    const calLabel = document.createElement('label')
    const calCheckbox = document.createElement('input')
    calCheckbox.type = 'checkbox'
    calCheckbox.id = ids.setDefaultCalendar
    calLabel.appendChild(calCheckbox)
    calLabel.appendChild(document.createTextNode(' Set as default'))
    calSection.appendChild(calLabel)
    fragment.appendChild(calSection)

    // Timezone section
    const tzSection = document.createElement('div')
    tzSection.id = ids.timezoneSelectorSection
    tzSection.className = 'pluginMailToEvent-timezoneSection'

    const tzSelect = document.createElement('select')
    tzSelect.id = ids.timezoneSelector
    tzSection.appendChild(tzSelect)

    const tzLabel = document.createElement('label')
    const tzCheckbox = document.createElement('input')
    tzCheckbox.type = 'checkbox'
    tzCheckbox.id = ids.setDefaultTimezone
    tzLabel.appendChild(tzCheckbox)
    tzLabel.appendChild(document.createTextNode(' Set as default'))
    tzSection.appendChild(tzLabel)
    fragment.appendChild(tzSection)

    return {fragment, ids}
}

/**
 * Creates the shared bottom form fields: location, description.
 * Insert these AFTER the date picker section.
 * @param {string} idPrefix - unique prefix for element IDs (leave empty for the popup)
 */
export function createEventFormBottom(idPrefix = '') {
    const p = id => idPrefix ? `${idPrefix}-${id}` : id
    const ids = {
        eventLocation: p('event-location'),
        eventComment:  p('event-comment'),
    }

    const fragment = document.createDocumentFragment()

    // Location
    const locationGroup = document.createElement('div')
    locationGroup.className = 'form-group'
    const locationInput = document.createElement('input')
    locationInput.type = 'text'
    locationInput.id = ids.eventLocation
    locationInput.placeholder = 'Optional location'
    locationGroup.appendChild(locationInput)
    fragment.appendChild(locationGroup)

    // Description
    const descriptionGroup = document.createElement('div')
    descriptionGroup.className = 'form-group'
    const descriptionTextarea = document.createElement('textarea')
    descriptionTextarea.rows = 2
    descriptionTextarea.id = ids.eventComment
    descriptionTextarea.placeholder = 'Optional description'
    descriptionGroup.appendChild(descriptionTextarea)
    fragment.appendChild(descriptionGroup)

    return {fragment, ids}
}
