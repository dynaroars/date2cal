import {formatFoundDate} from "./format_dates.js";
import extractDate from "../import/default-date.js";
import extractTime from "../import/default-time.js";
import {franc} from "../dependencies/franc.js";
import {francLocaleToDateFnsLocale, francLocaleToTimezone} from "./franc_locale_to_extract_date_locale.js";

export const splitTextIntoSentences = (text) => {
    return text.split(/(?<!\w\.\w.)(?<![A-Z][a-z]\.)(?<=\.|\?|!|\n)\s*/);
}

const removeDuplicatesDateISO = (arrayOfObjects) => arrayOfObjects.reduce((acc, obj) => {
    if (!acc.some(item => (
        item.startDateTime.dateISO === obj.startDateTime.dateISO &&
        item.endDateTime.dateISO === obj.endDateTime.dateISO
    ))) {
        acc.push(obj);
    }
    return acc;
}, []);


const customExtractDateTimes = (text, options) => {
    const extractedDates = extractDate(text, options)

    const extractedDateTimes = extractedDates.map((oneExtractedDate) => {
        const dateStartingPoint = text.indexOf(oneExtractedDate.originalText)
        if (dateStartingPoint !== -1) {
            const sentenceAfterDate = text.slice(dateStartingPoint + oneExtractedDate.originalText.length)
            const timesAfterDate = extractTime(sentenceAfterDate)

            if (timesAfterDate.length >= 2 && timesAfterDate[0].time < timesAfterDate[1].time) {
                return {
                    date: oneExtractedDate,
                    startTime: timesAfterDate[0],
                    endTime: timesAfterDate[1]
                }
            } else if (timesAfterDate.length >= 1) {
                return {
                    date: oneExtractedDate,
                    startTime: timesAfterDate[0]
                }
            }
        }

        return {
            date: oneExtractedDate
        }
    })

    return extractedDateTimes
}

// HTML emails often inline a <style> block whose CSS rules survive into the plain-text body
// (e.g. "body { width: 100% }"). Those keywords drown out the real prose and flip franc's
// language detection (an Epic Games receipt in French was detected as English). Drop the
// "selector { ... }" blocks before detecting the language.
const stripCssNoise = (text) => text.replace(/[^{}]*\{[^{}]*\}/g, ' ')

const detectLang = (text) => {
    return franc(stripCssNoise(text), {only: Object.keys(francLocaleToDateFnsLocale)})
}

export function findDates(mailSubject, mailContent, removeDuplicatesDates = true, thunderbirdTimezone = null) {
    const langFranc = detectLang(mailSubject + '.\n' + mailContent)

    const locale = francLocaleToDateFnsLocale[langFranc] || 'en';
    const timezone = thunderbirdTimezone ?? francLocaleToTimezone[langFranc];

    const direction = langFranc === 'eng' && /^(America|US)\//.test(timezone) ? 'MD' : 'DM'

    const options = {
        minimumAge: 12,
        maximumAge: 12 * 20,
        direction,
        locale,
        timezone,
    }

    const mailSubjectSentences = splitTextIntoSentences(mailSubject)
    const mailSubjectDates = mailSubjectSentences.map(e => customExtractDateTimes(e, options))

    const mailContentSentences = splitTextIntoSentences(mailContent)
    const mailContentDates = mailContentSentences.map(e => customExtractDateTimes(e, options))


    const allFoundDates = [].concat(mailSubjectDates, mailContentDates)
    const flatFoundDates = [].concat(...allFoundDates);

    const formatedDates = flatFoundDates.map(formatFoundDate)
    const dates = removeDuplicatesDates ? removeDuplicatesDateISO(formatedDates) : formatedDates
    return {dates, detectedLanguage: locale}
}