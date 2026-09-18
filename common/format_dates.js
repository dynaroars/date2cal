const formatHourMinutes = (maybeTime, shiftNextHalfHour) => {
    let [hours, minutes] = [null, null]
    if (maybeTime) {
        [hours, minutes] = maybeTime.split(':').map((x) => {
            return +x
        })
    }

    const now = new Date()
    hours = Number.isInteger(hours) ? hours : now.getHours()
    minutes = Number.isInteger(minutes) ? minutes : now.getMinutes()

    const minutesOffset = shiftNextHalfHour ? 30 : 0
    minutes = (minutes - (minutes % 30)) + minutesOffset


    return [+hours, +minutes]
}

export const formatFoundDate = (aFoundDate) => {
    const [year, month, day] = aFoundDate.date.date.split('-')

    const startDateData = [
        +year,
        +month - 1, // monthIndex starts at 0 e.g. January is 0
        +day,
        ...formatHourMinutes(aFoundDate?.startTime?.time, false)
    ]
    const endDateData = [
        +year,
        +month - 1, // monthIndex starts at 0 e.g. January is 0
        +day,
        ...(aFoundDate?.endTime?.time ?
            formatHourMinutes(aFoundDate?.endTime?.time, false) :
            formatHourMinutes(aFoundDate?.startTime?.time, true))
    ]

    const startDateTimeJs = new Date(...startDateData)
    let endDateTimeJs = new Date(...endDateData)

    if (endDateTimeJs <= startDateTimeJs) {
        endDateTimeJs = new Date(+year, +month - 1, +day, ...formatHourMinutes(aFoundDate?.startTime?.time, true))
    }

    startDateTimeJs.setTime(startDateTimeJs.getTime() - startDateTimeJs.getTimezoneOffset() * 60 * 1000);
    endDateTimeJs.setTime(endDateTimeJs.getTime() - endDateTimeJs.getTimezoneOffset() * 60 * 1000);

    const startDateTimeISO = startDateTimeJs.toISOString()
    const endDateTimeISO = endDateTimeJs.toISOString()

    return {
        originalDateTimeData: aFoundDate,
        startDateTime: {
            dateJs: startDateTimeJs,
            dateISO: startDateTimeISO
        },
        endDateTime: {
            dateJs: endDateTimeJs,
            dateISO: endDateTimeISO
        }
    }

}