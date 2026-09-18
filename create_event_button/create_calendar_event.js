const calendarItems = messenger.calendar.items

function generateUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export async function createEvent(calendarId, eventStartDate, eventEndDate, eventSummary, eventComment, timezone, location, allDay = false) {
    const uid = generateUID()

    let startValue, endValue, valueType, tzParam
    if (allDay) {
        valueType = 'date'
        tzParam = {}
        startValue = eventStartDate.slice(0, 10)
        const endDay = new Date(eventEndDate.slice(0, 10))
        endDay.setUTCDate(endDay.getUTCDate() + 1)
        endValue = endDay.toISOString().slice(0, 10)
    } else {
        valueType = 'date-time'
        tzParam = timezone ? {tzid: timezone} : {}
        startValue = eventStartDate
        endValue = eventEndDate
    }

    const properties = [
        ['dtstart', tzParam, valueType, startValue],
        ['dtend', tzParam, valueType, endValue],
        ['summary', {}, 'text', eventSummary],
        ['description', {}, 'text', eventComment],
        ['uid', {}, 'text', uid],
    ]
    if (location) {
        properties.push(['location', {}, 'text', location])
    }
    try {
        await calendarItems.create(calendarId, {
            format: "jcal",
            type: 'event',
            id: uid,

            item: [
                'vevent',
                properties,
                []
            ]
        })
    } catch (e) {
        return {error: e}
    }
    return {uid}
}