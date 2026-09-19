import {expect} from "chai";
import {JSDOM} from "jsdom";
import {buildFlatText, wrapRange} from "../content_scripts/highlight_dates/dom_text_walker.js";

function makeBody(html) {
    const dom = new JSDOM(`<html><body>${html}</body></html>`)
    globalThis.document = dom.window.document // TreeWalker's NodeFilter constants are globals in a real DOM env
    return dom.window.document.body
}

describe('buildFlatText', () => {
    it('concatenates text across elements in document order', () => {
        const body = makeBody('<p>Hello <b>world</b>. See you <i>tomorrow</i>.</p>')
        const {flatText} = buildFlatText(body, body.ownerDocument)
        expect(flatText).to.equal('Hello world. See you tomorrow.')
    })

    it('skips <script> and <style> contents', () => {
        const body = makeBody('<style>.x{color:red}</style>Hello<script>var x=1</script> world')
        const {flatText} = buildFlatText(body, body.ownerDocument)
        expect(flatText).to.equal('Hello world')
    })

    it('produces ranges that reconstruct the flat text', () => {
        const body = makeBody('<p>Hello <b>world</b></p>')
        const {flatText, ranges} = buildFlatText(body, body.ownerDocument)
        const rebuilt = ranges.map(r => flatText.slice(r.start, r.end)).join('')
        expect(rebuilt).to.equal(flatText)
    })
})

describe('wrapRange', () => {
    it('wraps a match fully inside one text node', () => {
        const body = makeBody('<p>Meeting tomorrow at 9am please.</p>')
        const {flatText, ranges} = buildFlatText(body, body.ownerDocument)
        const start = flatText.indexOf('tomorrow at 9am')
        const wrappers = wrapRange(ranges, start, start + 'tomorrow at 9am'.length, () => {
            const span = body.ownerDocument.createElement('span')
            span.className = 'hit'
            return span
        })
        expect(wrappers.length).to.equal(1)
        expect(wrappers[0].textContent).to.equal('tomorrow at 9am')
        expect(body.innerHTML).to.equal('<p>Meeting <span class="hit">tomorrow at 9am</span> please.</p>')
    })

    it('wraps a match spanning two elements as two wrappers', () => {
        const body = makeBody('<p>See you <b>tomorrow</b> at 9am!</p>')
        const {flatText, ranges} = buildFlatText(body, body.ownerDocument)
        const start = flatText.indexOf('tomorrow at 9am')
        const wrappers = wrapRange(ranges, start, start + 'tomorrow at 9am'.length, () => {
            const span = body.ownerDocument.createElement('span')
            span.className = 'hit'
            return span
        })
        expect(wrappers.length).to.equal(2)
        expect(wrappers.map(w => w.textContent)).to.deep.equal(['tomorrow', ' at 9am'])
    })

    it('preserves surrounding text exactly when the match is at the start of a node', () => {
        const body = makeBody('<p>Tomorrow works for me.</p>')
        const {flatText, ranges} = buildFlatText(body, body.ownerDocument)
        const wrappers = wrapRange(ranges, 0, 'Tomorrow'.length, () => body.ownerDocument.createElement('span'))
        expect(wrappers.length).to.equal(1)
        expect(body.textContent).to.equal('Tomorrow works for me.')
    })

    it('preserves surrounding text exactly when the match is at the end of a node', () => {
        const body = makeBody('<p>See you tomorrow</p>')
        const {flatText, ranges} = buildFlatText(body, body.ownerDocument)
        const matchStart = flatText.length - 'tomorrow'.length
        wrapRange(ranges, matchStart, flatText.length, () => body.ownerDocument.createElement('span'))
        expect(body.textContent).to.equal('See you tomorrow')
    })

    it('creates an independent wrapper per call so click handlers can be attached separately', () => {
        const body = makeBody('<p>tomorrow and tomorrow</p>')
        const {flatText, ranges} = buildFlatText(body, body.ownerDocument)
        let calls = 0
        const first = flatText.indexOf('tomorrow')
        const second = flatText.indexOf('tomorrow', first + 1)
        wrapRange(ranges, first, first + 8, () => { calls++; return body.ownerDocument.createElement('span') })
        // Re-walk after the first wrap since the DOM structure changed.
        const {flatText: flatText2, ranges: ranges2} = buildFlatText(body, body.ownerDocument)
        const secondNow = flatText2.indexOf('tomorrow', flatText2.indexOf('tomorrow') + 1)
        wrapRange(ranges2, secondNow, secondNow + 8, () => { calls++; return body.ownerDocument.createElement('span') })
        expect(calls).to.equal(2)
        expect(body.querySelectorAll('span').length).to.equal(2)
    })
})
