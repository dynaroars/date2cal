// Builds a flat-text view of a DOM subtree, and maps character ranges in
// that flat text back to real DOM text nodes -- so detection can run
// directly against exactly the text being highlighted (fixing the root
// cause of upstream's broken highlighting: it ran detection against a
// separately-fetched plain-text body, then tried to re-find the matched
// string in the DOM with indexOf(), which mis-anchors whenever the string
// repeats or the match spans multiple elements -- see PLAN.md section 1/
// Phase 3).

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT'])

/** Walks all text nodes under `root` (depth-first, document order), skipping
 * <script>/<style>, and returns the concatenated text plus a range table
 * mapping each text node to its [start, end) position in that text. */
export function buildFlatText(root, doc = document) {
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
        acceptNode(node) {
            const tag = node.parentElement?.tagName
            return (tag && SKIP_TAGS.has(tag)) ? 2 /* REJECT */ : 1 /* ACCEPT */
        },
    })

    let flatText = ''
    const ranges = []
    let node
    while ((node = walker.nextNode())) {
        const start = flatText.length
        flatText += node.textContent
        ranges.push({node, start, end: flatText.length})
    }
    return {flatText, ranges}
}

/** For a [matchStart, matchEnd) span in the flat text, returns the text
 * nodes it overlaps, each with the local [start, end) offset within that
 * node. A match normally falls inside one node; this also handles a match
 * spanning node boundaries (e.g. across an inline <b>) by returning one
 * entry per overlapping node. */
export function findOverlappingNodes(ranges, matchStart, matchEnd) {
    const hits = []
    for (const r of ranges) {
        const overlapStart = Math.max(r.start, matchStart)
        const overlapEnd = Math.min(r.end, matchEnd)
        if (overlapStart < overlapEnd) {
            hits.push({node: r.node, localStart: overlapStart - r.start, localEnd: overlapEnd - r.start})
        }
    }
    return hits
}

/** Wraps the [matchStart, matchEnd) span of `flatText` in `wrapperFactory()`
 * elements (one per overlapping text node -- see findOverlappingNodes),
 * calling `wrapperFactory` fresh for each so callers can attach independent
 * click handlers / dataset per wrapped fragment. Returns the created wrapper
 * elements. Splits each overlapping text node into up to three parts
 * (before/match/after) rather than mutating in place, so earlier ranges in
 * `ranges` stay valid for subsequent calls in the same pass as long as you
 * process matches back-to-front (see tag_dates.js). */
export function wrapRange(ranges, matchStart, matchEnd, wrapperFactory) {
    const hits = findOverlappingNodes(ranges, matchStart, matchEnd)
    const wrappers = []

    for (const {node, localStart, localEnd} of hits) {
        const text = node.textContent
        const before = text.slice(0, localStart)
        const matched = text.slice(localStart, localEnd)
        const after = text.slice(localEnd)

        const wrapper = wrapperFactory()
        wrapper.textContent = matched

        const parent = node.parentNode
        if (!parent) continue

        if (after) parent.insertBefore(node.ownerDocument.createTextNode(after), node.nextSibling)
        parent.insertBefore(wrapper, node.nextSibling)
        if (before) {
            node.textContent = before
        } else {
            parent.removeChild(node)
        }

        wrappers.push(wrapper)
    }

    return wrappers
}
