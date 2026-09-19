import {expect} from "chai";
import {JSDOM} from "jsdom";
import {tagMailContentDates} from "../content_scripts/highlight_dates/tag_dates.js";

function makeDoc(bodyHtml) {
    const dom = new JSDOM(`<html><body>${bodyHtml}</body></html>`)
    globalThis.document = dom.window.document
    return dom.window.document
}

const REF = new Date('2026-09-18T12:00:00-04:00')

describe('tagMailContentDates', () => {
    // tag_dates.js reads browser.i18n.getMessage() for the highlight
    // tooltip (Phase 6 i18n). Reset before each test rather than once at
    // module load: other test files also mutate the shared globalThis.browser
    // inside their own it() callbacks, and mocha loads/runs all test files
    // in the same process, so a module-load-time assignment here can be
    // clobbered by test execution order.
    beforeEach(() => {
        globalThis.browser = {i18n: {getMessage: (key) => `[${key}]`}}
    })

    it('highlights a date mention in the body and wires a click handler', () => {
        const doc = makeDoc('<p>Let\'s meet tomorrow at 3pm to discuss.</p>')
        const selected = []
        const {highlighted} = tagMailContentDates(doc, doc.body, {
            subject: 'Quick sync', referenceDate: REF,
        }, (c) => selected.push(c))

        expect(highlighted).to.equal(1)
        const span = doc.querySelector('.pluginMailToEvent-highlightDate')
        expect(span).to.not.equal(null)
        expect(span.textContent).to.equal('tomorrow at 3pm')

        span.dispatchEvent(new doc.defaultView.Event('click', {bubbles: true}))
        expect(selected.length).to.equal(1)
        expect(selected[0].start.toISOString()).to.equal('2026-09-19T19:00:00.000Z')
    })

    it('does not highlight a subject-only match (wrong coordinate space for this DOM)', () => {
        // "Tomorrow" only appears in the subject, not in the body -- if the
        // subject-relative index were (incorrectly) used against the body's
        // flat text, this would either highlight nothing findable or, worse,
        // wrap the wrong characters. Verify nothing is wrapped in the body.
        const doc = makeDoc('<p>See the attached document for details.</p>')
        const {highlighted} = tagMailContentDates(doc, doc.body, {
            subject: 'Tomorrow at 3pm', referenceDate: REF,
        }, () => {})

        expect(highlighted).to.equal(0)
        expect(doc.querySelectorAll('.pluginMailToEvent-highlightDate').length).to.equal(0)
    })

    it('highlights multiple non-overlapping matches without corrupting earlier ones', () => {
        const doc = makeDoc('<p>Standup tomorrow at 9am, then a follow-up on Oct 6, 2026 at 2pm.</p>')
        const {highlighted} = tagMailContentDates(doc, doc.body, {
            subject: 'Schedule', referenceDate: REF,
        }, () => {})

        expect(highlighted).to.equal(2)
        const spans = [...doc.querySelectorAll('.pluginMailToEvent-highlightDate')]
        expect(spans.map(s => s.textContent)).to.deep.equal(['tomorrow at 9am', 'Oct 6, 2026 at 2pm'])
        // Text outside the matches must survive untouched.
        expect(doc.body.textContent).to.equal(
            'Standup tomorrow at 9am, then a follow-up on Oct 6, 2026 at 2pm.'
        )
    })

    it('highlights a match spanning an inline element', () => {
        const doc = makeDoc('<p>See you <b>tomorrow</b> at 9am!</p>')
        const {highlighted} = tagMailContentDates(doc, doc.body, {
            subject: '', referenceDate: REF,
        }, () => {})
        expect(highlighted).to.equal(1)
        expect(doc.querySelectorAll('.pluginMailToEvent-highlightDate').length).to.equal(2) // one per node
        expect(doc.body.textContent).to.equal('See you tomorrow at 9am!')
    })

    it('does not highlight anything for a newsletter with no real event', () => {
        const doc = makeDoc('<p>Copyright (c) 2026 Acme Inc. Version 10.2. Unsubscribe here.</p>')
        const {highlighted, candidates} = tagMailContentDates(doc, doc.body, {
            subject: 'Newsletter', referenceDate: REF,
        }, () => {})
        expect(highlighted).to.equal(0)
        expect(candidates).to.deep.equal([])
    })
})
