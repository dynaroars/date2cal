export function setCreating(btn) {
    const setText = (text) => {
        if (btn.tagName === 'INPUT') btn.value = text
        else btn.textContent = text
    }
    btn.classList.remove("success", "error")
    btn.disabled = true
    setText("Creating…")
}

export function handleCreateResult(btn, result, onSuccess) {
    const setText = (text) => {
        if (btn.tagName === 'INPUT') btn.value = text
        else btn.textContent = text
    }

    if (result.error) {
        console.error(result)
        setText("✗ " + (result.error?.message || "Error"))
        btn.classList.remove("success")
        btn.classList.add("error")
        btn.disabled = false
    } else {
        setText("✓ Event created")
        btn.classList.remove("error")
        btn.classList.add("success")
        onSuccess?.()
    }
}
