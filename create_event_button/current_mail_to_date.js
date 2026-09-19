import {detectEvents} from "../common/find_dates.js";

/** Extracts the best available plain-text body, degrading gracefully instead
 * of throwing (PLAN.md Phase 2, step 13 -- upstream did
 * `emailBodyTextInline[0].content` with no guard, so a message with no
 * inline text part killed the whole popup with no visible error). Also
 * returns the raw HTML part (if any) so the caller can scan it for
 * schema.org JSON-LD markup -- Layer 1's second structured source. */
async function extractBody(messageId) {
    let inlineParts = []
    try {
        inlineParts = await messenger.messages.listInlineTextParts(messageId)
    } catch {
        return {plainText: '', html: null}
    }

    const plainPart = inlineParts.find(p => p.contentType === 'text/plain')
    const htmlPart = inlineParts.find(p => p.contentType === 'text/html')

    if (plainPart?.content) return {plainText: plainPart.content, html: htmlPart?.content ?? null}

    const fallbackHtml = htmlPart?.content ?? inlineParts[0]?.content ?? null
    if (fallbackHtml) {
        try {
            const plainText = await messenger.messengerUtilities.convertToPlainText(fallbackHtml)
            return {plainText, html: fallbackHtml}
        } catch {
            return {plainText: fallbackHtml, html: fallbackHtml}
        }
    }

    return {plainText: '', html: null}
}

/** Parses an HTML string into a Document for JSON-LD scanning.
 * DOMParser is a standard Window API available in extension page contexts
 * (background/popup pages), not just content scripts, so this works without
 * injecting anything into the message itself. */
function parseHtmlDocument(html) {
    if (!html || typeof DOMParser === 'undefined') return null
    try {
        return new DOMParser().parseFromString(html, 'text/html')
    } catch {
        return null
    }
}

/** Reads any text/calendar (.ics) attachments on the message -- Layer 1 of
 * detection (PLAN.md section 2). Best-effort: a message with no calendar
 * attachment, or one Thunderbird can't fetch for some reason, just falls
 * through to prose detection. */
async function extractIcsTexts(messageId) {
    let attachments = []
    try {
        attachments = await messenger.messages.listAttachments(messageId)
    } catch {
        return []
    }

    const icsAttachments = attachments.filter(a =>
        a.contentType === 'text/calendar' || /\.ics$/i.test(a.name || '')
    )

    const texts = await Promise.all(icsAttachments.map(async (a) => {
        try {
            const file = await messenger.messages.getAttachmentFile(messageId, a.partName)
            return await file.text()
        } catch {
            return null
        }
    }))

    return texts.filter(Boolean)
}

export async function getCurrentMailDates() {
    let tabs = await messenger.tabs.query({active: true, currentWindow: true});
    const currentTab = tabs[0];
    const currentTabId = currentTab.id;

    const messages = await messenger.messageDisplay.getDisplayedMessages(currentTabId);
    const message = messages.messages?.[0]

    if (!message) return null

    const subject = message.subject || ''
    const messageId = message.id

    // referenceDate anchors relative expressions ("tomorrow", "next Monday")
    // -- must be when the mail was *sent*, not when it happens to be read
    // (see PLAN.md Phase 1 step 7). message.date is already a Date.
    const referenceDate = message.date instanceof Date ? message.date : new Date()

    const [{plainText: body, html}, icsTexts] = await Promise.all([
        extractBody(messageId),
        extractIcsTexts(messageId),
    ])
    const htmlDocument = parseHtmlDocument(html)

    const {defaultDateOrder} = await browser.storage.local.get('defaultDateOrder')

    const {candidates, usedLayer} = detectEvents({
        subject,
        body,
        referenceDate,
        dateOrder: defaultDateOrder || 'MDY',
        icsTexts,
        htmlDocument,
    })

    return {candidates, usedLayer, subject, messageId, body, referenceDate}
}
