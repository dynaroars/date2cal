/**
 * Wires up an "All day" checkbox to toggle start/end inputs between
 * datetime-local and date types, shifting the end date by delta when needed.
 *
 * @param {HTMLInputElement} checkbox
 * @param {() => HTMLInputElement[]} getStartInputs
 * @param {HTMLInputElement} endInput
 * @param {(allDay: boolean, endInput: HTMLInputElement) => void} [onToggle]
 */
export function setupAllDayToggle(checkbox, getStartInputs, endInput, onToggle) {
    checkbox.addEventListener('change', () => {
        const allDay = checkbox.checked
        const startInputs = getStartInputs()

        ;[...startInputs, endInput].forEach(input => {
            const value = input.value
            input.type = allDay ? 'date' : 'datetime-local'
            input.value = allDay ? value.slice(0, 10) : (value ? value + 'T00:00' : '')
        })

        if (allDay) {
            const ref = startInputs.find(i => i.ariaSelected === 'true') ?? startInputs[0]
            if (ref?.value) {
                if (!endInput.value) {
                    const next = new Date(ref.value)
                    next.setDate(next.getDate() + 1)
                    endInput.value = next.toISOString().slice(0, 10)
                } else if (endInput.value < ref.value) {
                    endInput.value = ref.value
                }
            }
        }

        onToggle?.(allDay, endInput)
    })
}
