// PLAN.md Phase 3, step 15: highlights detected dates directly in the
// message body. Detection runs against the exact same flat text the
// highlighter walks (via dom_text_walker.js), so match offsets always line
// up with real DOM positions -- fixing upstream's approach of running
// detection against a separately-fetched plain-text body and then
// re-finding the matched string in the DOM with indexOf(), which mis-
// anchored whenever the string repeated or the match spanned elements.
import {detectEvents} from "../../common/find_dates.js";
import {buildFlatText, wrapRange} from "./dom_text_walker.js";

const HIGHLIGHT_CLASS = 'pluginMailToEvent-highlightDate'

/**
 * Detects and highlights dates in `root`, calling `onSelect(candidate)`
 * when a highlighted span is clicked.
 *
 * @param {Document} doc
 * @param {Element} root - usually doc.body
 * @param {object} context - {subject, referenceDate, dateOrder, icsTexts}
 *   supplied by the caller (content scripts can't call messenger.* directly
 *   to fetch these themselves -- see highlight_dates.js).
 * @param {(candidate: object) => void} onSelect
 * @returns {{candidates: Array, usedLayer: string, highlighted: number}}
 */
export function tagMailContentDates(doc, root, context, onSelect) {
    const {flatText, ranges} = buildFlatText(root, doc)

    const {candidates, usedLayer} = detectEvents({
        subject: context.subject || '',
        body: flatText,
        referenceDate: context.referenceDate,
        dateOrder: context.dateOrder,
        icsTexts: context.icsTexts,
        htmlDocument: doc, // the content script's own document -- JSON-LD scan for free
    })

    // Only highlight matches whose `index` is relative to *this* flat text.
    // Structured (Layer 1) hits have no position at all (an .ics attachment
    // isn't inline content). Subject-sourced matches DO have an `index`, but
    // it's relative to the subject string, not `flatText` -- wrapping with it
    // here would highlight the wrong span in the body (and the subject line
    // usually isn't even part of this document; it's shown in the thread
    // header, outside the message body content script runs in). The toolbar
    // popup surfaces both of those instead.
    const positioned = candidates.filter(c => typeof c.index === 'number' && c.source === 'body')

    // Wrap back-to-front: wrapping mutates the DOM (splits text nodes), which
    // would invalidate the position of any later range still expressed in
    // terms of the original flat text -- processing highest-index-first
    // keeps every not-yet-processed range's offsets valid.
    const sorted = [...positioned].sort((a, b) => b.index - a.index)
    let highlighted = 0

    for (const candidate of sorted) {
        const wrappers = wrapRange(ranges, candidate.index, candidate.index + candidate.text.length, () => {
            const span = doc.createElement('span')
            span.className = HIGHLIGHT_CLASS
            span.title = 'Click to create a calendar event'
            return span
        })
        if (wrappers.length === 0) continue
        highlighted++
        for (const span of wrappers) {
            span.addEventListener('click', (event) => {
                event.stopPropagation()
                onSelect(candidate)
            })
        }
    }

    return {candidates, usedLayer, highlighted}
}
