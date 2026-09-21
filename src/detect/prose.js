// Second detection layer: chrono-node over free-text English prose. English
// only, by design -- no language auto-detection, which is what turned out to
// produce the most severe false positives in earlier explorations of this
// approach.
import {casual, GB} from '../../dependencies/chrono-en.js'
import {withCustomRules} from './rules.js'

// One configured chrono instance per (dateOrder, businessHoursMeridiem)
// combination -- building an instance and pushing rules onto it isn't free,
// and there are only four possible combinations to cache.
const configuredInstances = new Map()

function instanceFor(dateOrder, businessHoursMeridiem) {
    const cacheKey = `${dateOrder}:${businessHoursMeridiem}`
    if (!configuredInstances.has(cacheKey)) {
        const base = dateOrder === 'DMY' ? GB.clone() : casual.clone()
        configuredInstances.set(cacheKey, withCustomRules(base, {businessHoursMeridiem}))
    }
    return configuredInstances.get(cacheKey)
}

/**
 * Parses free-text English for date/time mentions.
 *
 * @param {string} text
 * @param {Date} referenceDate - anchors relative expressions ("tomorrow",
 *   "next Monday"). Must be the email's own Date: header, not Date.now() --
 *   a message read a week late must still resolve "tomorrow" against when it
 *   was sent.
 * @param {'MDY'|'DMY'} [dateOrder] - default 'MDY' (US). Set explicitly via
 *   options, never inferred from the text's language.
 * @param {boolean} [businessHoursMeridiem] - default true; see rules.js.
 * @returns {Array<{text, index, start: Date, end: Date|null, hasTime: boolean}>}
 */
export function parseProse(text, referenceDate, dateOrder = 'MDY', businessHoursMeridiem = true) {
    const chrono = instanceFor(dateOrder, businessHoursMeridiem)
    const parsed = chrono.parse(text, referenceDate, {forwardDate: true})

    return parsed.map(result => ({
        text: result.text,
        index: result.index,
        start: result.start.date(),
        end: result.end ? result.end.date() : null,
        hasTime: result.start.isCertain('hour'),
    }))
}
