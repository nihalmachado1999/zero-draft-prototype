// npm run pipeline:outcomes            (asks only for pages with no kept reply)
// npm run pipeline:outcomes -- --fresh (asks again for every page)
//
// The test-outcome reader (SPEC F2b, §7.2). For each Appendix A page of the BASS-II report (PDF
// pp. 111 to 121) it splits the page into one row per test, asks the LLM what each row's notes
// say the flame did, and keeps an answer only if its quote is in that test's row (src/lib/
// outcomes.ts). A row whose answer fails the check is asked once more. Writes
// public/data/test-outcomes.json (SPEC §6) and keeps every raw reply in
// pipeline/out/raw/outcomes-p<page>.json (and -retry.json).
import flowByTest from '../../docs/fixtures/flow-by-test.json'
import { compileBass2, type FlowByTest } from '../../src/lib/audit'
import type { TestOutcome, TestOutcomesFile } from '../../src/lib/generatedData'
import { assembleOutcomes, checkPage, notesOf, splitRows, type AppendixRow, type PageCheck, type RawOutcome } from '../../src/lib/outcomes'
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

/** What the model reads: each test's notes under its id (the settings and readings are left out). */
const asNotes = (rows: readonly AppendixRow[]) => rows.map((row) => `### ${row.testId}\n${notesOf(row)}`).join('\n\n')

async function main() {
  const fresh = process.argv.includes('--fresh')
  const prompt = loadPrompt('read-outcomes.md')
  const csv = read('pipeline', 'sources', 'PSI-25', 'PSI-25_Experimental table_BASS-II.csv')
  const testIds = compileBass2(csv, flowByTest as FlowByTest).map((row) => row.testId)
  const pages = loadPages('PSI-25').pages.filter((page) => page.page >= FIRST_PAGE && page.page <= LAST_PAGE)

  // `--probe O7 F2 …`: try the prompt on a few named tests, in one call, and write nothing else.
  const probeAt = process.argv.indexOf('--probe')
  if (probeAt !== -1) {
    const wanted = new Set(process.argv.slice(probeAt + 1))
    const rows = pages.flatMap((page) => splitRows(page.text, testIds)).filter((row) => wanted.has(row.testId))
    const raw = await ask({
      name: `outcomes-probe-${prompt.version.replace(/\W+/g, '-')}`,
      generatedBy: GENERATED_BY,
      subject: `PSI-25 probe: ${rows.map((row) => row.testId).join(' ')}`,
      prompt,
      user: asNotes(rows),
      jsonSchema: SCHEMA,
      maxOutputTokens: 3_000,
      fresh,
    })
    const result = checkPage(rows, parseReply<{ outcomes?: RawOutcome[] }>(raw)?.outcomes ?? [])
    for (const o of result.outcomes) console.log(`${o.testId.padEnd(5)} ${o.outcome.padEnd(12)} ${o.quote ?? ''}`)
    for (const f of result.failures) console.log(`Failed the check: ${f.testId} ${f.failure}: ${JSON.stringify(f.raw)}`)
    console.log(`tokens: ${JSON.stringify(raw.usage)}`)
    return
  }

  const checked: TestOutcome[] = []
  const failures: (PageCheck['failures'][number] & { pdfPage: number })[] = []
  let model = ''
  for (const page of pages) {
    const rows = splitRows(page.text, testIds)
    if (rows.length === 0) continue
    const user = asNotes(rows)
    const raw = await ask({
      name: `outcomes-p${page.page}`,
      generatedBy: GENERATED_BY,
      subject: `PSI-25 p.${page.page}`,
      prompt,
      user,
      jsonSchema: SCHEMA,
      // About 50 tokens a row, and a page holds at most 17 rows. A smaller cap also asks less of
      // the provider's daily quota, which is checked against what a call might use.
      maxOutputTokens: 1_300,
      fresh,
    })
    model ||= raw.model
    const reply = parseReply<{ outcomes?: RawOutcome[] }>(raw)?.outcomes ?? []
    let result = checkPage(rows, Array.isArray(reply) ? reply : [])

    // Rows whose answer failed the check are asked once more, on their own. The second answer
    // goes through the same check; nothing is kept on the model's word alone.
    const firstFailures = result.failures.length
    if (firstFailures > 0) {
      const again = rows.filter((row) => result.failures.some((f) => f.testId === row.testId))
      const retry = await ask({
        name: `outcomes-p${page.page}-retry`,
        generatedBy: GENERATED_BY,
        subject: `PSI-25 p.${page.page}, rows that failed the check`,
        prompt,
        user:
          'The quotes given before for these tests were not found word for word in their notes, or broke a rule. ' +
          'Copy consecutive words exactly, 15 at most; a shorter quote is safer.\n\n' +
          asNotes(again),
        jsonSchema: SCHEMA,
        maxOutputTokens: 800,
        fresh,
      })
      const second = checkPage(again, parseReply<{ outcomes?: RawOutcome[] }>(retry)?.outcomes ?? [])
      result = {
        outcomes: result.outcomes.map((o) => second.outcomes.find((s) => s.testId === o.testId && !second.failures.some((f) => f.testId === s.testId)) ?? o),
        failures: second.failures,
      }
    }
    checked.push(...result.outcomes)
    failures.push(...result.failures.map((failure) => ({ ...failure, pdfPage: page.page })))
    const kept = result.outcomes.filter((o) => o.outcome !== 'not-stated').length
    console.log(
      `p.${page.page}: ${rows.length} rows, ${kept} outcomes kept, ${firstFailures} failed the check` +
        (firstFailures ? `, ${result.failures.length} still failed when asked again` : '') +
        ` (${raw.finishReason ?? 'no finish reason'})`,
    )
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
