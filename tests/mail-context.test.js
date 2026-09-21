import {expect} from "chai";
import {JSDOM} from "jsdom";

// mail-context.js runs inside a Thunderbird extension page, where
// `messenger`/`browser` are host-provided globals and `DOMParser` is a
// standard Window API. Neither exists under plain Node, so this test installs
// minimal mocks of both -- enough to exercise the fallback logic without
// needing Thunderbird itself.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
globalThis.DOMParser = dom.window.DOMParser

function installMessengerMocks({
    inlineParts = [],
    attachments = [],
    attachmentFiles = {},
    message = {id: 1, subject: 'Test subject', date: new Date('2026-09-18T12:00:00-04:00')},
    listInlineTextPartsThrows = false,
}) {
    globalThis.messenger = {
        tabs: {query: async () => [{id: 42}]},
        messageDisplay: {getDisplayedMessages: async () => ({messages: [message]})},
        messages: {
            listInlineTextParts: async () => {
                if (listInlineTextPartsThrows) throw new Error('boom')
                return inlineParts
            },
            listAttachments: async () => attachments,
            getAttachmentFile: async (_id, partName) => attachmentFiles[partName],
        },
        messengerUtilities: {
            convertToPlainText: async (html) => html.replace(/<[^>]+>/g, ''),
        },
    }
    globalThis.browser = {
        storage: {local: {get: async () => ({})}},
    }
}

// Force a fresh module instance per test so each test's mocks take effect --
// mail-context.js reads the messenger/browser globals at call time,
// but re-importing avoids any accidental cross-test state in its own module
// scope.
async function loadModule() {
    const mod = await import(`../src/popup/mail-context.js?t=${Date.now()}-${Math.random()}`)
    return mod
}

describe('getCurrentMailDates', () => {
    it('returns null when no message is displayed', async () => {
        globalThis.messenger = {
            tabs: {query: async () => [{id: 1}]},
            messageDisplay: {getDisplayedMessages: async () => ({messages: []})},
        }
        globalThis.browser = {storage: {local: {get: async () => ({})}}}
        const {getCurrentMailDates} = await loadModule()
        expect(await getCurrentMailDates()).to.equal(null)
    })

    it('prefers text/plain over text/html when both are present', async () => {
        installMessengerMocks({
            inlineParts: [
                {contentType: 'text/html', content: '<p>Meeting <b>tomorrow</b> at 9am</p>'},
                {contentType: 'text/plain', content: 'Meeting tomorrow at 9am'},
            ],
        })
        const {getCurrentMailDates} = await loadModule()
        const result = await getCurrentMailDates()
        expect(result.body).to.equal('Meeting tomorrow at 9am')
        expect(result.candidates.length).to.equal(1)
    })

    it('falls back to convertToPlainText when only text/html is present', async () => {
        installMessengerMocks({
            inlineParts: [{contentType: 'text/html', content: '<p>Meeting tomorrow at 9am</p>'}],
        })
        const {getCurrentMailDates} = await loadModule()
        const result = await getCurrentMailDates()
        expect(result.body).to.equal('Meeting tomorrow at 9am')
    })

    it('degrades to an empty body instead of throwing when listInlineTextParts fails', async () => {
        installMessengerMocks({listInlineTextPartsThrows: true})
        const {getCurrentMailDates} = await loadModule()
        const result = await getCurrentMailDates()
        expect(result.body).to.equal('')
        expect(result.candidates).to.deep.equal([])
    })

    it('uses the message Date header as the detection reference date, not now()', async () => {
        installMessengerMocks({
            inlineParts: [{contentType: 'text/plain', content: 'See you tomorrow at 9am'}],
            message: {id: 1, subject: 'x', date: new Date('2026-01-01T12:00:00-05:00')},
        })
        const {getCurrentMailDates} = await loadModule()
        const result = await getCurrentMailDates()
        expect(result.candidates[0].start.toISOString()).to.equal('2026-01-02T14:00:00.000Z')
    })

    it('reads an .ics attachment and short-circuits prose parsing (Layer 1)', async () => {
        const ics = [
            'BEGIN:VCALENDAR', 'BEGIN:VEVENT',
            'DTSTART:20261006T180000Z', 'DTEND:20261006T190000Z',
            'SUMMARY:Planning Sync',
            'END:VEVENT', 'END:VCALENDAR',
        ].join('\r\n')
        installMessengerMocks({
            inlineParts: [{contentType: 'text/plain', content: 'Also works tomorrow at 3pm.'}],
            attachments: [{name: 'invite.ics', contentType: 'text/calendar', partName: '1.2'}],
            attachmentFiles: {'1.2': {text: async () => ics}},
        })
        const {getCurrentMailDates} = await loadModule()
        const result = await getCurrentMailDates()
        expect(result.usedLayer).to.equal('structured')
        expect(result.candidates[0].title).to.equal('Planning Sync')
    })

    it('finds JSON-LD event markup in the HTML part (Layer 1)', async () => {
        const html = `<html><body><script type="application/ld+json">
            {"@type":"Event","name":"Product Launch","startDate":"2026-10-06T18:00:00Z"}
        </script></body></html>`
        installMessengerMocks({
            inlineParts: [{contentType: 'text/html', content: html}],
        })
        const {getCurrentMailDates} = await loadModule()
        const result = await getCurrentMailDates()
        expect(result.usedLayer).to.equal('structured')
        expect(result.candidates[0].title).to.equal('Product Launch')
    })

    it('does not throw when an attachment fetch fails', async () => {
        installMessengerMocks({
            inlineParts: [{contentType: 'text/plain', content: 'Meeting tomorrow at 9am'}],
            attachments: [{name: 'invite.ics', contentType: 'text/calendar', partName: '1.2'}],
            attachmentFiles: {}, // getAttachmentFile('1.2') resolves undefined -> .text() throws
        })
        const {getCurrentMailDates} = await loadModule()
        const result = await getCurrentMailDates()
        expect(result.usedLayer).to.equal('prose')
        expect(result.candidates.length).to.equal(1)
    })
})
