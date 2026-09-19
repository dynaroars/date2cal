// Confidence scoring and ranking (PLAN.md section 2). The top-ranked
// candidate is what the one-click inline-highlight and context-menu paths
// use without asking the user to disambiguate; the toolbar popup shows the
// full ranked list.

const SCORE = {
    exact: 100,        // Layer 1: .ics / JSON-LD -- nothing was guessed
    dateTimeRange: 60,  // explicit date + start + end time
    dateTime: 50,       // explicit date + time, no end
    dateOnly: 30,       // date with no time (all-day)
    weekdayOnly: 10,     // bare weekday, least specific
}

function scoreOf(candidate) {
    if (candidate.confidence === 'exact') return SCORE.exact
    if (candidate.hasTime && candidate.end) return SCORE.dateTimeRange
    if (candidate.hasTime) return SCORE.dateTime
    if (candidate.isWeekdayOnly) return SCORE.weekdayOnly
    return SCORE.dateOnly
}

/** Sorts candidates most-confident first. Ties broken by earliest position
 * in the text (subject/earlier body content tends to be more relevant than
 * something mentioned in passing later on). */
export function rankCandidates(candidates) {
    return [...candidates]
        .map(c => ({...c, score: c.score ?? scoreOf(c)}))
        .sort((a, b) => (b.score - a.score) || ((a.index ?? 0) - (b.index ?? 0)))
}
