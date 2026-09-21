import {expect} from "chai";
import {detectEvents} from "../src/detect/index.js";
import {CORPUS} from "./fixtures/corpus.js";

function isoDate(d) {
    return d.toISOString().slice(0, 10)
}

describe('golden corpus (PLAN.md Phase 5)', () => {
    const positives = CORPUS.filter(c => c.expect === 'event')
    const negatives = CORPUS.filter(c => c.expect === 'none')
    let truePositives = 0
    let trueNegatives = 0

    for (const testCase of positives) {
        it(`[event] ${testCase.name}`, () => {
            const {candidates} = detectEvents({
                subject: testCase.subject,
                body: testCase.body,
                referenceDate: testCase.referenceDate,
                icsTexts: testCase.icsTexts,
            })
            expect(candidates.length, 'expected at least one candidate').to.be.greaterThan(0)
            if (testCase.expectedDate) {
                const found = candidates.some(c => isoDate(c.start) === testCase.expectedDate)
                expect(found, `expected a candidate on ${testCase.expectedDate}, got: ${candidates.map(c => isoDate(c.start))}`).to.equal(true)
            }
            truePositives++
        })
    }

    for (const testCase of negatives) {
        it(`[none] ${testCase.name}`, () => {
            const {candidates} = detectEvents({
                subject: testCase.subject,
                body: testCase.body,
                referenceDate: testCase.referenceDate,
            })
            expect(candidates, `expected no candidates, got: ${JSON.stringify(candidates.map(c => c.text))}`).to.deep.equal([])
            trueNegatives++
        })
    }

    after(() => {
        const recall = positives.length ? truePositives / positives.length : 1
        const precision = negatives.length ? trueNegatives / negatives.length : 1
        // eslint-disable-next-line no-console
        console.log(
            `\n    corpus: ${CORPUS.length} cases -- ` +
            `recall ${(recall * 100).toFixed(0)}% (${truePositives}/${positives.length}), ` +
            `precision (neg. guardrail) ${(precision * 100).toFixed(0)}% (${trueNegatives}/${negatives.length})`
        )
        // PLAN.md Phase 5 step 25: regression gate.
        expect(recall, 'corpus recall dropped below the 0.95 gate').to.be.at.least(0.95)
        expect(precision, 'corpus precision dropped below the 0.95 gate').to.be.at.least(0.95)
    })
})
