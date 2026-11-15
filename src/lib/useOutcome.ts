// A test's AI-read outcome for the views (SPEC F2b): the generated file joined with where the
// test's row is in Appendix A. Undefined until test-outcomes.json has loaded, and for good when
// it was never generated, so everything that shows an outcome renders nothing without it.
import { useAuditData } from './bass2Data'
import { useTestOutcomes, type TestOutcome, type TestOutcomesFile } from './generatedData'
import { outcomeView, type OutcomeView } from './outcomes'

/** Each loaded file's outcomes by test id, built once per file. */
const indexes = new WeakMap<TestOutcomesFile, Map<string, TestOutcome>>()
function byTestId(file: TestOutcomesFile): Map<string, TestOutcome> {
  let index = indexes.get(file)
  if (!index) {
    index = new Map(file.outcomes.map((outcome) => [outcome.testId, outcome]))
    indexes.set(file, index)
  }
  return index
}

export function useOutcome(testId: string): OutcomeView | undefined {
  const file = useTestOutcomes()
  const data = useAuditData()
  if (!file || data.status !== 'ready') return undefined
  const outcome = byTestId(file).get(testId)
  return outcome && outcomeView(outcome, data.bass2.flowEvidence[testId])
}
