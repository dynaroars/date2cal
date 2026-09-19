import {expect} from "chai";

// createEvent calls messenger.calendar.items.createWithDialog (Phase 4) --
// mock it to capture the jCal payload it builds, rather than exercising the
// real Thunebird calendar (not available under Node).
let lastCall = null
globalThis.messenger = {
    calendar: {
        items: {
            createWithDialog: async (calendarId, createProperties) => {
                lastCall = {calendarId, createProperties}
            },
        },
    },
}

const {createEvent} = await import('../create_event_button/create_calendar_event.js')

function propOf(jcalProperties, name) {
    return jcalProperties.find(p => p[0] === name)
}

describe('createEvent (Phase 4: builds jCal for createWithDialog)', () => {
    it('builds a timed event with dtstart/dtend as UTC date-time components', async () => {
        await createEvent({
            calendarId: 'cal1',
            title: 'Planning Sync',
            start: new Date('2026-10-06T18:00:00.000Z'),
            end: new Date('2026-10-06T19:00:00.000Z'),
            timezone: 'America/New_York',
        })

        expect(lastCall.calendarId).to.equal('cal1')
        const {item, allDay} = lastCall.createProperties
        const [, properties] = item
        expect(allDay).to.equal(false)

        const dtstart = propOf(properties, 'dtstart')
        expect(dtstart[1]).to.deep.equal({tzid: 'America/New_York'})
        expect(dtstart[2]).to.equal('date-time')
        expect(dtstart[3]).to.deep.equal([2026, 10, 6, 18, 0, 0, true])

        expect(propOf(properties, 'summary')[3]).to.equal('Planning Sync')
    })

    it('builds an all-day event with date-only components and no tzid', async () => {
        await createEvent({
            calendarId: 'cal1',
            title: 'Company Retreat',
            start: new Date('2026-10-12T00:00:00.000Z'),
            end: new Date('2026-10-13T00:00:00.000Z'),
            isAllDay: true,
            timezone: 'America/New_York', // must be ignored when all-day
        })

        const {item, allDay} = lastCall.createProperties
        expect(allDay).to.equal(true)
        const [, properties] = item
        const dtstart = propOf(properties, 'dtstart')
        expect(dtstart[1]).to.deep.equal({})
        expect(dtstart[2]).to.equal('date')
        expect(dtstart[3]).to.deep.equal([2026, 10, 12])
    })

    it('includes location, description, and url only when present', async () => {
        await createEvent({
            calendarId: 'cal1', title: 't',
            start: new Date(), end: new Date(),
            location: 'Room 301', url: 'https://zoom.us/j/123',
        })
        const [, properties] = lastCall.createProperties.item
        expect(propOf(properties, 'location')[3]).to.equal('Room 301')
        expect(propOf(properties, 'url')).to.deep.equal(['url', {}, 'uri', 'https://zoom.us/j/123'])
        expect(propOf(properties, 'description')).to.equal(undefined)
    })

    it('converts a weekly-by-day RRULE string into jCal recur shape', async () => {
        await createEvent({
            calendarId: 'cal1', title: 't',
            start: new Date(), end: new Date(),
            rrule: 'FREQ=WEEKLY;BYDAY=MO',
        })
        const [, properties] = lastCall.createProperties.item
        expect(propOf(properties, 'rrule')).to.deep.equal(['rrule', {}, 'recur', {freq: 'WEEKLY', byday: ['MO']}])
    })

    it('converts a multi-value BYDAY and numeric INTERVAL correctly', async () => {
        await createEvent({
            calendarId: 'cal1', title: 't',
            start: new Date(), end: new Date(),
            rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR',
        })
        const [, properties] = lastCall.createProperties.item
        expect(propOf(properties, 'rrule')[3]).to.deep.equal({
            freq: 'WEEKLY', interval: 2, byday: ['MO', 'WE', 'FR'],
        })
    })

    it('omits rrule entirely for a non-recurring event', async () => {
        await createEvent({calendarId: 'cal1', title: 't', start: new Date(), end: new Date()})
        const [, properties] = lastCall.createProperties.item
        expect(propOf(properties, 'rrule')).to.equal(undefined)
    })

    it('returns {error} instead of throwing when createWithDialog rejects', async () => {
        const original = globalThis.messenger.calendar.items.createWithDialog
        globalThis.messenger.calendar.items.createWithDialog = async () => { throw new Error('no 3-pane window') }
        const result = await createEvent({calendarId: 'cal1', title: 't', start: new Date(), end: new Date()})
        expect(result.error).to.be.instanceOf(Error)
        globalThis.messenger.calendar.items.createWithDialog = original
    })
})
