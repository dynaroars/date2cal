const toLocalDateTimeString = (date) => {
    const offset = date.getTimezoneOffset() * 60000
    return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

/**
 * Syncs end date when start date changes, applying the same delta.
 * Returns { reset(start, end) } to reinitialise tracked values when switching rows.
 */
export function setupDateRangeSync(startInput, endInput, initialEnd) {
    let trackedStart = startInput.value
    let trackedEnd = initialEnd ?? endInput.value

    startInput.addEventListener('focus', () => {
        trackedStart = startInput.value
    })

    startInput.addEventListener('input', () => {
        const deltaMs = new Date(startInput.value) - new Date(trackedStart)
        const newEnd = new Date(new Date(trackedEnd).getTime() + deltaMs)
        if (endInput.type === 'date') {
            const newEndStr = newEnd.toISOString().slice(0, 10)
            endInput.value = newEndStr < startInput.value ? startInput.value : newEndStr
        } else {
            endInput.value = toLocalDateTimeString(newEnd)
        }
        trackedStart = startInput.value
        trackedEnd = endInput.value
    })

    endInput.addEventListener('input', () => {
        trackedStart = startInput.value
        trackedEnd = endInput.value
    })

    return {
        reset(start, end) {
            trackedStart = start
            trackedEnd = end
        }
    }
}
