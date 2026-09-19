// Layer 2 of detection (see PLAN.md section 2): chrono-node over free-text
// English prose. English only, by design -- no language auto-detection (that
// was the root cause of the worst upstream bugs; see PLAN.md section 1).
import {casual, GB} from '../dependencies/chrono-en.js'
import {applyChronoRules} from './chrono_rules.js'

// Cached per (dateOrder, businessHoursMeridiem) combination -- constructing
// a chrono instance and pushing rules onto it isn't free, and there are only
// four possible combinations.
const instanceCache = new Map()

function getInstance(dateOrder, businessHoursMeridiem) {
    const key = `${dateOrder}:${businessHoursMeridiem}`
    if (!instanceCache.has(key)) {
        const base = dateOrder === 'DMY' ? GB.clone() : casual.clone()
        instanceCache.set(key, applyChronoRules(base, {businessHoursMeridiem}))
    }
    return instanceCache.get(key)
}

/**
 * Parses free-text English for date/time mentions.
 *
 * @param {string} text
 * @param {Date} referenceDate - anchors relative expressions ("tomorrow",
 *   "next Monday"). Must be the email's own Date: header, not Date.now() --
 *   a message read a week late must still resolve "tomorrow" against when it
 *   was *sent*.
 * @param {'MDY'|'DMY'} [dateOrder] - default 'MDY' (US). Never inferred from
 *   text language -- set explicitly via options (see PLAN.md Phase 6).
 * @param {boolean} [businessHoursMeridiem] - default true; see chrono_rules.js.
 * @returns {Array<{text, index, start: Date, end: Date|null, hasTime: boolean}>}
 */
export function parseProse(text, referenceDate, dateOrder = 'MDY', businessHoursMeridiem = true) {
    const chrono = getInstance(dateOrder, businessHoursMeridiem)
    const results = chrono.parse(text, referenceDate, {forwardDate: true})

    return results.map((r) => ({
        text: r.text,
        index: r.index,
        start: r.start.date(),
        end: r.end ? r.end.date() : null,
        hasTime: r.start.isCertain('hour'),
    }))
}
