// npm run pipeline:outcomes            (asks only for pages with no kept reply)
// npm run pipeline:outcomes -- --fresh (asks again for every page)
//
// The test-outcome reader (SPEC F2b, §7.2). For each Appendix A page of the BASS-II report (PDF
// pp. 111 to 121) it splits the page into one row per test, asks the LLM what each row's notes
// say the flame did, and keeps an answer only if its quote is in that test's row (src/lib/
// outcomes.ts). Writes public/data/test-outcomes.json (SPEC §6) and keeps every raw reply in
// pipeline/out/raw/outcomes-p<page>.json.
import flowByTest from '../../docs/fixtures/flow-by-test.json'
import { compileBass2, type FlowByTest } from '../../src/lib/audit'
import type { TestOutcome, TestOutcomesFile } from '../../src/lib/generatedData'
import { assembleOutcomes, checkPage, splitRows, type PageCheck, type RawOutcome } from '../../src/lib/outcomes'
import { ask, loadPages, loadPrompt, parseReply, read, writeJson } from './pipelineIo'

const GENERATED_BY = 'pipeline/scripts/outcomes.ts'
/** Appendix A: the test matrices (SPEC §7.2). */
const FIRST_PAGE = 111
const LAST_PAGE = 121

const SCHEMA = {
  type: 'object',
  properties: {
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          testId: { type: 'string' },
          outcome: { type: 'string', enum: ['sustained', 'brief', 'no-ignition', 'not-stated'] },
          quote: { type: 'string' },
        },
        required: ['testId', 'outcome', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['outcomes'],
  additionalProperties: false,
}

async function main() {
  const fresh = process.argv.includes('--fresh')
  const prompt = loadPrompt('read-outcomes.md')
  const csv = read('pipeline', 'sources', 'PSI-25', 'PSI-25_Experimental table_BASS-II.csv')
  const testIds = compileBass2(csv, flowByTest as FlowByTest).map((row) => row.testId)
  const pages = loadPages('PSI-25').pages.filter((page) => page.page >= FIRST_PAGE && page.page <= LAST_PAGE)

  const checked: TestOutcome[] = []
  const failures: (PageCheck['failures'][number] & { pdfPage: number })[] = []
  let model = ''
  for (const page of pages) {
    const rows = splitRows(page.text, testIds)
    if (rows.length === 0) continue
    const user = rows.map((row) => `### ${row.testId}\n${row.text}`).join('\n\n')
    const raw = await ask({
      name: `outcomes-p${page.page}`,
      generatedBy: GENERATED_BY,
      subject: `PSI-25 p.${page.page}`,
      prompt,
      user,
      jsonSchema: SCHEMA,
      // About 50 tokens a row, and a page holds at most 20 rows.
      maxOutputTokens: 1_600,
      fresh,
    })
    model ||= raw.model
    const reply = parseReply<{ outcomes?: RawOutcome[] }>(raw)?.outcomes ?? []
    const result = checkPage(rows, Array.isArray(reply) ? reply : [])
    checked.push(...result.outcomes)
    failures.push(...result.failures.map((failure) => ({ ...failure, pdfPage: page.page })))
    const kept = result.outcomes.filter((o) => o.outcome !== 'not-stated').length
    console.log(`p.${page.page}: ${rows.length} rows, ${kept} outcomes kept, ${result.failures.length} failed the check (${raw.finishReason ?? 'no finish reason'})`)
  }

  const outcomes = assembleOutcomes(testIds, checked)
  const file: TestOutcomesFile = {
    generatedBy: GENERATED_BY,
    generatedAt: new Date().toISOString(),
    model,
    promptVersion: prompt.version,
    outcomes,
  }
  writeJson(file, 'public', 'data', 'test-outcomes.json')

  const count = (outcome: TestOutcome['outcome']) => outcomes.filter((o) => o.outcome === outcome).length
  const notStated = count('not-stated')
  console.log(
    `\n${outcomes.length} tests: ${count('sustained')} sustained, ${count('brief')} brief, ${count('no-ignition')} no ignition, ` +
      `${notStated} not stated (${((100 * notStated) / outcomes.length).toFixed(1)}%)`,
  )
  const noRow = outcomes.filter((o) => !checked.some((c) => c.testId === o.testId)).map((o) => o.testId)
  if (noRow.length) console.log(`No row in Appendix A: ${noRow.join(', ')}`)
  for (const f of failures) console.log(`Failed the check: ${f.testId} (p.${f.pdfPage}) ${f.failure}: ${JSON.stringify(f.raw)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
