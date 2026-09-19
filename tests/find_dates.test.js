import {expect} from "chai";
import {detectEvents} from "../common/find_dates.js";

// Reference date fixed to a real Tuesday so weekday-relative assertions below
// ("tomorrow", "next Monday", etc.) are unambiguous. This is the message's
// own Date: header in production -- see common/find_dates.js docstring.
const REF = new Date('2026-09-18T12:00:00-04:00') // Tuesday, America/New_York

function top(subject, body) {
    const {candidates} = detectEvents({subject, body, referenceDate: REF})
    return candidates[0]
}

describe('detectEvents - prose (Layers 2-3)', () => {
    it('finds an explicit date+time+location', () => {
        const c = top('Meeting invite', "Let's meet on Tuesday, October 6, 2026 at 2:00 PM in Room 301.")
        expect(c.start.toISOString()).to.equal('2026-10-06T18:00:00.000Z')
        expect(c.end.toISOString()).to.equal('2026-10-06T19:00:00.000Z')
        expect(c.location).to.equal('Room 301')
        expect(c.isAllDay).to.equal(false)
    })

    it('resolves relative dates against the message date, not wall-clock now', () => {
        const c = top('Quick sync', 'Can we sync tomorrow at 3pm?')
        expect(c.start.toISOString()).to.equal('2026-09-19T19:00:00.000Z')
    })

    it('finds a time range on a weekday', () => {
        const c = top('Office hours', 'Office hours Thursday 2-4 PM.')
        expect(c.start.toISOString()).to.equal('2026-09-24T18:00:00.000Z')
        expect(c.end.toISOString()).to.equal('2026-09-24T20:00:00.000Z')
    })

    it('parses US-format numeric dates as MDY by default', () => {
        const c = top('Deliverables', "Let's meet on 5/7/2027 at 9 AM to discuss the project deliverables")
        expect(c.start.toISOString()).to.equal('2027-05-07T13:00:00.000Z')
    })

    it('parses DMY when dateOrder is explicitly set', () => {
        const {candidates} = detectEvents({
            subject: 'Deliverables',
            body: "Let's meet on 5/7/2027 at 9 AM to discuss the project deliverables",
            referenceDate: REF,
            dateOrder: 'DMY',
        })
        expect(candidates[0].start.toISOString()).to.equal('2027-07-05T13:00:00.000Z')
    })

    it('defaults a bare hour 1-7 to PM (business-hours meridiem)', () => {
        const c = top('Meeting reminder', 'Meeting on the 23rd at 4')
        expect(c.start.getUTCHours()).to.equal(20) // 4pm EDT = 20:00 UTC
    })

    it('does not override an explicit meridiem', () => {
        const c = top('Standup', 'Meeting tomorrow at 9am')
        expect(c.start.toISOString()).to.equal('2026-09-19T13:00:00.000Z') // 9am, not 9pm
    })

    it('resolves EOD to 17:00', () => {
        const c = top('Deadline', 'Please submit by EOD Thursday')
        expect(c.start.toISOString()).to.equal('2026-09-24T21:00:00.000Z')
    })

    it('uses a duration cue to set the end time', () => {
        const c = top('Quick sync', '30-min sync Tuesday 2pm')
        expect(c.end.toISOString()).to.equal('2026-09-22T18:30:00.000Z')
    })

    it('defaults to a 1-hour duration when no end or duration cue is given', () => {
        const c = top('Standup', 'Standup tomorrow at 9am')
        expect(c.end.toISOString()).to.equal('2026-09-19T14:00:00.000Z')
    })

    it('marks a date with no time as all-day', () => {
        const c = top('Retreat', 'The retreat is on October 12.')
        expect(c.isAllDay).to.equal(true)
    })

    it('extracts a video-call link', () => {
        const c = top('Standup', 'Standup tomorrow at 9am. Join: https://zoom.us/j/123456789')
        expect(c.url).to.equal('https://zoom.us/j/123456789')
    })

    it('detects a weekly recurrence', () => {
        const c = top('Standup', 'Weekly standup every Monday at 9am')
        expect(c.rrule).to.equal('FREQ=WEEKLY;BYDAY=MO')
        expect(c.recurrenceLabel).to.equal('weekly on Monday')
    })
})

describe('detectEvents - noise rejection (precision)', () => {
    it('ignores a version number', () => {
        const {candidates} = detectEvents({
            subject: 'Release notes',
            body: 'Please upgrade to version 10.2 for the latest fixes.',
            referenceDate: REF,
        })
        expect(candidates).to.deep.equal([])
    })

    it('ignores an item count that looks like a date', () => {
        const {candidates} = detectEvents({
            subject: 'Order shipped',
            body: 'Total: 12/19 items shipped to your address.',
            referenceDate: REF,
        })
        expect(candidates).to.deep.equal([])
    })

    it('ignores a past date even with an explicit year (newsletter/receipt reference)', () => {
        const {candidates} = detectEvents({
            subject: 'Newsletter',
            body: 'Our Q3 2026 results were released on March 3, 2021. ' +
                'Copyright (c) 2026 Acme Inc. version 10.2. Unsubscribe here.',
            referenceDate: REF,
        })
        expect(candidates).to.deep.equal([])
    })

    it('merges a duplicate timezone mention into one event on the right date', () => {
        const {candidates} = detectEvents({
            subject: 'Webinar',
            body: 'Webinar Oct 6 at 11am PST / 2pm EST',
            referenceDate: REF,
        })
        expect(candidates.length).to.equal(1)
        expect(candidates[0].start.toISOString()).to.equal('2026-10-06T19:00:00.000Z')
    })
})

describe('detectEvents - structured data (Layer 1)', () => {
    it('prefers an .ics attachment over prose in the body', () => {
        const ics = [
            'BEGIN:VCALENDAR', 'BEGIN:VEVENT',
            'DTSTART:20261006T180000Z', 'DTEND:20261006T190000Z',
            'SUMMARY:Q4 Planning Sync', 'LOCATION:Room 4705',
            'END:VEVENT', 'END:VCALENDAR',
        ].join('\r\n')
        const {candidates, usedLayer} = detectEvents({
            subject: 'Invite',
            body: 'Also let us know if tomorrow at 3pm works instead.',
            icsTexts: [ics],
            referenceDate: REF,
        })
        expect(usedLayer).to.equal('structured')
        expect(candidates[0].title).to.equal('Q4 Planning Sync')
        expect(candidates[0].confidence).to.equal('exact')
    })
})
