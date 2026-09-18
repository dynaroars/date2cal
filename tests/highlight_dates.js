import {expect} from "chai";
import {JSDOM} from "jsdom";
import {set, reset} from 'mockdate';
import {findDates} from "../common/find_dates.js";
import {tagDatesInDocument} from "../content_scripts/highlight_dates/tag_dates.js";

const emailSubject = '[CDG- HPC-KTT] Riunione del 20 aprile annullata – prossimo incontro 18 maggio';
const emailBody = `Gentili tutt*,

la riunione prevista per il 20 aprile non si terrà.

La prossima riunione è programmata per il 18 maggio 10:00- 11:00, salvo eventuali aggiornamenti.`;

function makeDocument(bodyText) {
    const escaped = bodyText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const dom = new JSDOM(`<html><body><p>${escaped.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p></body></html>`)
    return dom.window.document
}

describe('highlight email dates', function () {
    before(() => {
        set('2026-04-26T12:00:00.000Z')
    })
    after(() => {
        reset()
    })

    it('should detect the language as Italian', () => {
        const {detectedLanguage} = findDates(emailSubject, emailBody)
        expect(detectedLanguage).to.equal('it')
    })

    it('should detect April 20 and May 18 as calendar dates', () => {
        const {dates} = findDates(emailSubject, emailBody)
        const calendarDates = [...new Set(dates.map(d => d.originalDateTimeData.date.date))]
        expect(calendarDates).to.include('2026-04-20')
        expect(calendarDates).to.include('2026-05-18')
    })

    it('should detect "18 maggio" with time 11:00 from the meeting sentence', () => {
        // "10:00- 11:00" in the body — the library picks up "11:00" as the first clean time
        const {dates} = findDates(emailSubject, emailBody, false)
        const may18WithTime = dates.find(d =>
            d.originalDateTimeData.date.date === '2026-05-18' &&
            d.originalDateTimeData.startTime
        )
        expect(may18WithTime).to.not.be.undefined
        expect(may18WithTime.originalDateTimeData.startTime.time).to.equal('11:00')
        expect(may18WithTime.startDateTime.dateISO).to.equal('2026-05-18T11:00:00.000Z')
    })

    it('should highlight dates in DOM with pluginMailToEvent-highlightDate class', () => {
        const document = makeDocument(emailBody)
        const {dates} = findDates(emailSubject, emailBody, false)

        const {foundHtmlElements} = tagDatesInDocument(document, dates)

        const highlights = document.querySelectorAll('.pluginMailToEvent-highlightDate')
        expect(highlights.length).to.equal(foundHtmlElements.length)
        expect(highlights.length).to.be.greaterThan(0)
    })

    it('should wrap "18 maggio" in a highlight span in the DOM', () => {
        const document = makeDocument(emailBody)
        const {dates} = findDates(emailSubject, emailBody, false)
        tagDatesInDocument(document, dates)

        const highlights = Array.from(document.querySelectorAll('.pluginMailToEvent-highlightDate'))
        const may18Span = highlights.find(el => el.textContent.includes('18 maggio'))
        expect(may18Span).to.not.be.undefined
    })

    it('should assign sequential ids to highlight spans', () => {
        const document = makeDocument(emailBody)
        const {dates} = findDates(emailSubject, emailBody, false)
        const {foundHtmlElements} = tagDatesInDocument(document, dates)

        foundHtmlElements.forEach((el, i) => {
            expect(el.htmlContainerIdValue).to.equal(`plugin-date-index-${i}`)
            expect(document.getElementById(`plugin-date-index-${i}`)).to.not.be.null
        })
    })

    it('should preserve surrounding text after highlighting', () => {
        const document = makeDocument(emailBody)
        const {dates} = findDates(emailSubject, emailBody, false)
        tagDatesInDocument(document, dates)

        const bodyText = document.body.textContent
        expect(bodyText).to.include('La prossima riunione')
        expect(bodyText).to.include('salvo eventuali aggiornamenti')
        expect(bodyText).to.include('20 aprile')
        expect(bodyText).to.include('18 maggio')
    })
})
