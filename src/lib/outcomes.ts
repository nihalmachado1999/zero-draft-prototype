// The test-outcome reader's checks (SPEC F2b, §7.2). An LLM reads NASA's "Test observations"
// column in Appendix A and says, for each test, whether a flame sustained; this module decides
// what of that may be shown. Pure: page text and the model's raw reply in, checked outcomes out.
//
// - A page is first split into one row per test, by the test ids that open each row. The model
//   reads labelled rows, so it can't give one test's note to its neighbour.
// - A quote is kept only if it is at most 15 words and found, after normalize(), in its own
//   test's row: on that page, after that test's id. Anything else becomes "not-stated".
import type { Outcome, TestOutcome } from './generatedData'
import { normalize } from './normalize'

export const OUTCOMES: readonly Outcome[] = ['sustained', 'brief', 'no-ignition', 'not-stated']

/** SPEC §7.2: a quote is at most 15 words. */
export const MAX_QUOTE_WORDS = 15

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const words = (text: string) => text.split(' ').filter(Boolean).length

/** One test's row on an Appendix A page: from its test id to the next row's test id. */
export interface AppendixRow {
  testId: string
  /** Where the test id starts in the page text. */
  start: number
  /** The row's text, starting at its test id. */
  text: string
}

/**
 * Splits a normalized Appendix A page into rows. A row opens where a known test id is followed
 * by its sample number ("O12 217m", "F4 39M", "M5 167"): at most three digits and a letter, which
 * tells the test F2 from the camera's F-stop ("F2 1,000 Cont"). An id mentioned inside another
 * test's notes ("Repeat of clear rod O8b test") opens nothing.
 */
export function splitRows(pageText: string, testIds: readonly string[]): AppendixRow[] {
  const starts: { testId: string; start: number }[] = []
  for (const testId of testIds) {
    const opener = new RegExp(`(?<![\\w.-])${escape(testId)}\\s+\\d{1,3}[A-Za-z]?(?=\\s)`, 'g')
    const found = [...pageText.matchAll(opener)]
    // Twice on one page would be ambiguous: leave the test unread rather than guess.
    if (found.length === 1) starts.push({ testId, start: found[0].index })
  }
  starts.sort((a, b) => a.start - b.start)
  return starts.map(({ testId, start }, i) => ({
    testId,
    start,
    text: pageText.slice(start, starts[i + 1]?.start ?? pageText.length).trim(),
  }))
}

/** What the model returns for one test (pipeline/prompts/read-outcomes.md). */
export interface RawOutcome {
  testId?: unknown
  outcome?: unknown
  quote?: unknown
}

export type OutcomeFailure = 'unknown-test' | 'bad-outcome' | 'no-quote' | 'quote-too-long' | 'quote-not-in-row'

export interface CheckedOutcome {
  outcome: TestOutcome
  /** Why a reply was turned into "not-stated"; null when it was kept as given. */
  failure: OutcomeFailure | null
}

/** Checks one reply against its test's row. A failure is "not-stated" with no quote. */
export function checkOutcome(raw: RawOutcome, row: AppendixRow): CheckedOutcome {
  const notStated = (failure: OutcomeFailure | null): CheckedOutcome => ({
    outcome: { testId: row.testId, outcome: 'not-stated', quote: null },
    failure,
  })
  if (raw.testId !== row.testId) return notStated('unknown-test')
  if (typeof raw.outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(raw.outcome)) return notStated('bad-outcome')
  if (raw.outcome === 'not-stated') return notStated(null)
  const quote = normalize(typeof raw.quote === 'string' ? raw.quote : '')
  if (!quote) return notStated('no-quote')
  if (words(quote) > MAX_QUOTE_WORDS) return notStated('quote-too-long')
  // The row starts at the test id, so "found in the row past the id" is "after its id on the page".
  if (!row.text.slice(row.testId.length).includes(quote)) return notStated('quote-not-in-row')
  return { outcome: { testId: row.testId, outcome: raw.outcome as Outcome, quote }, failure: null }
}

export interface PageCheck {
  outcomes: TestOutcome[]
  failures: { testId: string; failure: OutcomeFailure; raw: RawOutcome | null }[]
}

/**
 * Checks a page's reply: one outcome per row of the page, in row order. A row the model skipped,
 * or answered twice, is "not-stated"; an entry for a test that isn't on the page is ignored.
 */
export function checkPage(rows: readonly AppendixRow[], reply: readonly RawOutcome[]): PageCheck {
  const outcomes: TestOutcome[] = []
  const failures: PageCheck['failures'] = []
  for (const row of rows) {
    const mine = reply.filter((raw) => raw.testId === row.testId)
    if (mine.length !== 1) {
      outcomes.push({ testId: row.testId, outcome: 'not-stated', quote: null })
      failures.push({ testId: row.testId, failure: 'unknown-test', raw: mine[0] ?? null })
      continue
    }
    const checked = checkOutcome(mine[0], row)
    outcomes.push(checked.outcome)
    if (checked.failure) failures.push({ testId: row.testId, failure: checked.failure, raw: mine[0] })
  }
  return { outcomes, failures }
}

/**
 * One entry for every test, in the CSV's order: the checked outcome of its row, or "not-stated"
 * for a test with no row in Appendix A (O20, O21 and O22 were run in 2016).
 */
export function assembleOutcomes(testIds: readonly string[], checked: readonly TestOutcome[]): TestOutcome[] {
  const byId = new Map<string, TestOutcome>()
  for (const outcome of checked) if (!byId.has(outcome.testId)) byId.set(outcome.testId, outcome)
  return testIds.map((testId) => byId.get(testId) ?? { testId, outcome: 'not-stated', quote: null })
}
