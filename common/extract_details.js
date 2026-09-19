// Extras pulled from the text around a detected date: location, a
// video-call link, and a cleaned-up title. See PLAN.md section 2 "Extras".

const VIDEO_URL_RE = /https?:\/\/[^\s<>"']*(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)[^\s<>"']*/i
const ROOM_RE = /\b(?:Room|Rm\.?|Suite|Ste\.?|Bldg\.?|Building)\s+[\w-]+\b/i
// A conservative street-address pattern: house number + street-ish word,
// deliberately narrow to avoid grabbing arbitrary "123 happy days" text.
const STREET_ADDRESS_RE = /\b\d{1,5}\s+([A-Z][a-z]+\s){1,4}(Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Court|Ct\.?|Place|Pl\.?)\b/

/** Finds a video-call URL anywhere in the text (not scoped to the match --
 * these usually appear on their own line, away from the date mention). */
export function extractVideoLink(text) {
    const m = text.match(VIDEO_URL_RE)
    return m ? m[0] : null
}

/** Finds a location near a specific match: room/building, then street
 * address, searched in a window around the date mention (locations are
 * usually stated right next to the time, e.g. "2pm in Room 301"). */
export function extractLocation(text, matchIndex, matchLength, windowSize = 80) {
    const from = Math.max(0, matchIndex - windowSize)
    const to = Math.min(text.length, matchIndex + matchLength + windowSize)
    const around = text.slice(from, to)

    const room = around.match(ROOM_RE)
    if (room) return room[0]

    const address = around.match(STREET_ADDRESS_RE)
    if (address) return address[0].trim()

    return null
}

const REPLY_PREFIX_RE = /^(re|fwd?|fw)\s*:\s*/i

/** Derives a title from the sentence containing the date match, falling back
 * to the email subject with Re:/Fwd: noise stripped. */
export function extractTitle(text, matchIndex, matchLength, subject) {
    // Find the sentence containing the match: nearest sentence boundary
    // before and after (., !, ?, or newline).
    const boundary = /[.!?\n]/g
    let sentenceStart = 0
    let m
    while ((m = boundary.exec(text)) && m.index < matchIndex) {
        sentenceStart = m.index + 1
    }
    boundary.lastIndex = matchIndex + matchLength
    const nextBoundary = boundary.exec(text)
    const sentenceEnd = nextBoundary ? nextBoundary.index + 1 : text.length

    const sentence = text.slice(sentenceStart, sentenceEnd).trim()
    if (sentence && sentence.length <= 120 && sentence.length >= 8) {
        return sentence
    }

    return (subject || '').replace(REPLY_PREFIX_RE, '').trim() || sentence || subject || ''
}
