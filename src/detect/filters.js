// Precision filters applied to prose (layer 2/3) results before ranking.
// Structured (layer 1) results skip this entirely -- an .ics/JSON-LD hit has
// nothing to second-guess.

// Version numbers ("version 10.2", "v2.3"), invoice/order/tracking-style
// numbers immediately preceded by a word meaning "this is an id, not a
// date", and copyright lines.
const VERSION_LABEL_BEFORE_RE = /\b(version|v\.?|release|build|revision|rev\.?)\s*$/i
const ID_LABEL_BEFORE_RE = /\b(invoice|order|tracking|reference|ref\.?|account|acct\.?|item|sku|ticket|case|confirmation)\s*(#|number|no\.?|num\.?)?\s*$/i
// Quantity/unit words *after* a bare number ("12/19 items shipped") are just
// as strong a signal as an id label before it -- catch both directions.
const QUANTITY_LABEL_AFTER_RE = /^\s*(items?|units?|packages?|pcs\.?|pieces?|qty\.?|quantity|copies|tickets?|orders?|shipped|ordered|sold|remaining|in stock)\b/i
const COPYRIGHT_NEARBY_RE = /[©(]c[)]|\bcopyright\b/i

// A bare single relative-day word with no time and no other context
// ("shipped today", "is now out for delivery") is too weak a signal to
// justify surfacing an event -- overwhelmingly non-scheduling filler in real
// mail. A genuine scheduling mention almost always adds a time ("today at
// 3pm") or more context, which chrono includes in the matched text and so
// isn't caught by this rule.
const BARE_WEAK_WORDS = new Set(['now', 'today', 'tonight', 'tomorrow', 'yesterday'])
// Similarly, "the year"/"the day"/"the week"/"the month" alone carries no
// actual date -- chrono's casual mode occasionally matches these as vague
// filler ("...biggest sale of the year").
const VAGUE_PHRASE_RE = /^the\s+(year|day|week|month)$/i

/** True if the text around `index` suggests the number is an identifier or
 * quantity rather than a date -- checked in a short window so this doesn't
 * false-positive on an unrelated "version" earlier in a long email. */
function looksLikeIdOrQuantity(text, index, matchLength) {
    const before = text.slice(Math.max(0, index - 20), index)
    const after = text.slice(index + matchLength, index + matchLength + 20)
    return VERSION_LABEL_BEFORE_RE.test(before) || ID_LABEL_BEFORE_RE.test(before) || QUANTITY_LABEL_AFTER_RE.test(after)
}

/** Strips quoted-reply text ("> ...", "On <date>, <person> wrote:" and
 * everything after it) and leftover HTML noise so detection runs on what the
 * sender actually wrote, not the thread history beneath it. */
export function stripQuotedReplyAndMarkup(text) {
    let cleaned = text
        // <style>/<script> contents, in case plain-text extraction leaked them
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')

    // Cut at the first quoted-reply marker. Conservative: only recognized
    // reply-header phrasing, not every "On <date>" mention.
    const quoteHeader = /^\s*(>|On .{0,60}wrote:)/im.exec(cleaned)
    if (quoteHeader) cleaned = cleaned.slice(0, quoteHeader.index)

    return cleaned
}

/** Drops matches that are almost certainly not dates: version numbers,
 * order/tracking numbers, copyright lines, and anything dated in the past
 * relative to the reference date. Nobody auto-creates a calendar event dated
 * in the past -- even an explicit "March 3, 2021" in a newsletter/receipt is
 * a reference to something that already happened, not an event to add. */
export function rejectNonEvents(candidates, text, referenceDate) {
    return candidates.filter(candidate => {
        const normalized = candidate.text.trim().toLowerCase()
        if (BARE_WEAK_WORDS.has(normalized) || VAGUE_PHRASE_RE.test(normalized)) return false

        if (looksLikeIdOrQuantity(text, candidate.index, candidate.text.length)) return false

        const nearby = text.slice(Math.max(0, candidate.index - 30), candidate.index + candidate.text.length + 10)
        if (COPYRIGHT_NEARBY_RE.test(nearby)) return false

        const isInThePast = candidate.start.getTime() < referenceDate.getTime() - 86400000 // 1-day grace
        return !isInThePast
    })
}

/** Removes overlapping matches, keeping the longest span (more context is
 * more likely to be the real match rather than a fragment of it). */
export function dropOverlapping(candidates) {
    const longestFirst = [...candidates].sort((a, b) => b.text.length - a.text.length)
    const kept = []
    for (const candidate of longestFirst) {
        const overlapsKept = kept.some(existing =>
            candidate.index < existing.index + existing.text.length &&
            existing.index < candidate.index + candidate.text.length
        )
        if (!overlapsKept) kept.push(candidate)
    }
    return kept.sort((a, b) => a.index - b.index)
}
