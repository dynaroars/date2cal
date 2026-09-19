// Filters applied to Layer 2/3 (prose) results before ranking. Structured
// (Layer 1) results skip this entirely -- an .ics/JSON-LD hit has nothing to
// second-guess. See PLAN.md section 2 "noise filter".

// Version numbers ("version 10.2", "v2.3"), invoice/order/tracking-style
// numbers immediately preceded by a word that means "this is an id, not a
// date", and copyright lines.
const VERSION_CONTEXT = /\b(version|v\.?|release|build|revision|rev\.?)\s*$/i
const ID_CONTEXT_BEFORE = /\b(invoice|order|tracking|reference|ref\.?|account|acct\.?|item|sku|ticket|case|confirmation)\s*(#|number|no\.?|num\.?)?\s*$/i
// Quantity/unit words *after* a bare number ("12/19 items shipped") are just
// as strong a signal as an id label before it -- catch both directions.
const QUANTITY_CONTEXT_AFTER = /^\s*(items?|units?|packages?|pcs\.?|pieces?|qty\.?|quantity|copies|tickets?|orders?|shipped|ordered|sold|remaining|in stock)\b/i
const COPYRIGHT_CONTEXT = /[©(]c[)]|\bcopyright\b/i

// A bare single relative-day word with no time and no other context
// ("shipped today", "is now out for delivery") is too weak a signal to
// justify surfacing an event -- it's overwhelmingly non-scheduling filler in
// real mail. A genuine scheduling mention almost always adds a time
// ("today at 3pm") or more context; those aren't caught by this rule since
// chrono includes them in the matched text.
const BARE_WEAK_WORDS = new Set(['now', 'today', 'tonight', 'tomorrow', 'yesterday'])
// Similarly, "the year"/"the day"/"the week"/"the month" alone carries no
// actual date -- chrono's casual mode occasionally matches these as vague
// filler ("...biggest sale of the year").
const VAGUE_PHRASE_RE = /^the\s+(year|day|week|month)$/i

/** True if the text around `index` suggests the number is an identifier or
 * quantity, not a date -- checked within a short window so we don't false-
 * positive on an unrelated "version" earlier in a long email. */
function hasNonDateContext(text, index, matchLength) {
    const before = text.slice(Math.max(0, index - 20), index)
    const after = text.slice(index + matchLength, index + matchLength + 20)
    return VERSION_CONTEXT.test(before) || ID_CONTEXT_BEFORE.test(before) || QUANTITY_CONTEXT_AFTER.test(after)
}

/** Strips quoted-reply text ("> ...", "On <date>, <person> wrote:" and
 * everything after it) and HTML noise so detection runs on what the sender
 * actually wrote, not the thread history beneath it. */
export function stripQuotedAndNoise(text) {
    let cleaned = text
        // <style>/<script> contents, in case plain-text extraction leaked them
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')

    // Cut at the first quoted-reply marker. Conservative: only recognized
    // reply-header phrasing, not every "On <date>" mention.
    const quoteHeaderRe = /^\s*(>|On .{0,60}wrote:)/im
    const match = quoteHeaderRe.exec(cleaned)
    if (match) cleaned = cleaned.slice(0, match.index)

    return cleaned
}

/** Drops matches that are almost certainly not dates: version numbers, order/
 * tracking numbers, copyright lines, and any date in the past relative to the
 * reference date. Nobody auto-creates a calendar event dated in the past --
 * even an explicit "March 3, 2021" in a newsletter/receipt is a reference to
 * something that already happened, not an event to add. (An earlier version
 * of this filter exempted explicit-year past dates; measured against a
 * newsletter sample it let exactly that kind of false positive through, so
 * the exemption was removed.) */
export function filterNoise(candidates, text, referenceDate) {
    return candidates.filter((c) => {
        // Bare single-word matches are inherently too weak regardless of
        // whether chrono claims a certain time -- "now" resolves to the
        // current instant down to the minute (hasTime: true) purely because
        // "now" always means *this* moment, not because the mail said
        // anything temporally specific.
        const trimmedLower = c.text.trim().toLowerCase()
        if (BARE_WEAK_WORDS.has(trimmedLower) || VAGUE_PHRASE_RE.test(trimmedLower)) return false

        if (hasNonDateContext(text, c.index, c.text.length)) return false

        const around = text.slice(Math.max(0, c.index - 30), c.index + c.text.length + 10)
        if (COPYRIGHT_CONTEXT.test(around)) return false

        const isPast = c.start.getTime() < referenceDate.getTime() - 86400000 // 1-day grace
        if (isPast) return false

        return true
    })
}

/** Removes overlapping matches, keeping the longest span (most context =
 * most likely to be the real match rather than a fragment of it). */
export function dedupeOverlapping(candidates) {
    const sorted = [...candidates].sort((a, b) => b.text.length - a.text.length)
    const kept = []
    for (const c of sorted) {
        const overlaps = kept.some(k =>
            c.index < k.index + k.text.length && k.index < c.index + c.text.length
        )
        if (!overlaps) kept.push(c)
    }
    return kept.sort((a, b) => a.index - b.index)
}
