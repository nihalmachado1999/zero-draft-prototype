// npm run pipeline:verify
//
// Checks every kept extraction (pipeline/out/raw/extract-<ID>.json) against the investigation's
// own text and writes public/data/investigations.json, with pipeline/out/review.md listing each
// field or sentence that failed and why (SPEC F7, §7.2). No LLM: the checks are src/lib/
// investigationVerify.ts. A failed field is null in the output ("Not stated"), never repaired.
import type { InvestigationsFile } from '../../src/lib/generatedData'
import { verifyInvestigation, type FieldFailure, type InvestigationSummary } from '../../src/lib/investigationVerify'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { INVESTIGATION_IDS, inputFor, pagesFor, PROMPT, rawName } from './extract'
import { keptReply, loadPrompt, parseReply, ROOT, writeJson } from './pipelineIo'

const GENERATED_BY = 'pipeline/scripts/verify.ts'

function reviewFile(file: InvestigationsFile, failures: readonly FieldFailure[]): string {
  const fieldsChecked = file.investigations.length * 6
  const sentences = file.investigations.reduce((sum, inv) => sum + inv.summary.length, 0)
  const lines = [
    '# Fields that failed verification',
    '',
    `Written by \`${GENERATED_BY}\` on ${file.generatedAt.slice(0, 10)} from the replies of \`${file.model}\` to \`${file.promptVersion}\`.`,
    '',
    `${file.investigations.length} investigations, ${fieldsChecked} fields and ${sentences + failures.filter((f) => f.field.startsWith('summary')).length} summary sentences checked. ` +
      `**${failures.length} failed** and are "Not stated" (fields) or left out (sentences) in \`public/data/investigations.json\`.`,
    '',
    'A field that is null because the source does not state it is not a failure and is not listed.',
    '',
  ]
  if (failures.length === 0) lines.push('Nothing failed.', '')
  for (const id of INVESTIGATION_IDS) {
    const mine = failures.filter((f) => f.id === id)
    if (mine.length === 0) continue
    lines.push(`## ${id}`, '')
    for (const f of mine) lines.push(`- **${f.field}**: ${f.reason}.`, '  ```json', `  ${JSON.stringify(f.raw)}`, '  ```')
    lines.push('')
  }
  lines.push('## Human review', '', 'Read each summary against its source and spot-check 3 fields per investigation; record who checked and when in `pipeline/out/REVIEWED.md` (SPEC §7.2).', '')
  return lines.join('\n')
}

function main() {
  const prompt = loadPrompt(PROMPT)
  const investigations: InvestigationSummary[] = []
  const failures: FieldFailure[] = []
  let model = ''
  for (const id of INVESTIGATION_IDS) {
    const raw = keptReply(rawName(id), prompt.version, inputFor(id))
    if (!raw) throw new Error(`No kept reply for ${id} at ${prompt.version}. Run: npm run pipeline:extract`)
    if (model && raw.model !== model) throw new Error(`${id} was extracted by ${raw.model}, the others by ${model}: one model per file`)
    model = raw.model
    const result = verifyInvestigation(id, pagesFor(id), parseReply<unknown>(raw))
    investigations.push(result.summary)
    failures.push(...result.failures)
    const stated = ['acronym', 'title', 'platform', 'o2Pct', 'pressure', 'flow'].filter(
      (field) => (result.summary as unknown as Record<string, { value: unknown }>)[field].value !== null,
    )
    console.log(`${id}: ${stated.length} of 6 fields stated, ${result.summary.summary.length} summary sentences, ${result.failures.length} failed`)
  }
  const file: InvestigationsFile = {
    generatedBy: GENERATED_BY,
    generatedAt: new Date().toISOString(),
    model,
    promptVersion: prompt.version,
    investigations,
    failures: failures.map(({ id, field, reason }) => ({ id, field, reason })),
  }
  writeJson(file, 'public', 'data', 'investigations.json')
  writeFileSync(join(ROOT, 'pipeline', 'out', 'review.md'), reviewFile(file, failures))
  console.log(`\n${failures.length} fields or sentences failed verification: see pipeline/out/review.md`)
}

main()
