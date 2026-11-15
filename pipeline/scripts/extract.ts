// npm run pipeline:extract             (asks only for investigations with no kept reply)
// npm run pipeline:extract -- --fresh  (asks again for all of them)
// npm run pipeline:extract -- PSI-98   (just the ones named)
//
// The investigation extraction (SPEC F7, §7.2): one LLM call per investigation, temperature 0,
// with pipeline/prompts/extract-investigation.md. Each call reads only that investigation's PSI
// metadata (i_Investigation.txt and s_*.txt, without blank fields and contact details). PSI-25
// has no metadata file in our sources, so it reads the report's summary page (PDF p. 9) and
// nothing else of the report. The raw reply is kept untouched in pipeline/out/raw/extract-<ID>.json;
// verify.ts decides what of it may be shown.
import { metadataForModel } from '../../src/lib/investigationVerify'
import type { TextPage } from '../../src/lib/pages'
import { ask, loadPages, loadPrompt } from './pipelineIo'

export const GENERATED_BY = 'pipeline/scripts/extract.ts'
export const PROMPT = 'extract-investigation.md'
export const INVESTIGATION_IDS = ['PSI-25', 'PSI-26', 'PSI-62', 'PSI-69', 'PSI-98', 'PSI-99', 'PSI-100', 'PSI-102']

/** PSI-25's only input: the page of the BASS-II report that holds its Summary. */
export const PSI_25_SUMMARY_PAGE = 9

/** The pages of an investigation the model reads, and verify.ts checks quotes against. */
export function pagesFor(id: string): TextPage[] {
  const pages = loadPages(id).pages
  if (id === 'PSI-25') return pages.filter((page) => /\.pdf$/i.test(page.file) && page.page === PSI_25_SUMMARY_PAGE)
  return pages.filter((page) => /^(i_Investigation|s_.+)\.txt$/.test(page.file))
}

/** The user message: the id, then each page under its label. */
export function inputFor(id: string): string {
  const parts = pagesFor(id)
    .map((page) => ({ page, text: page.lines ? metadataForModel(page) : page.text }))
    // A sample file that only says "Do not use this" has nothing to read.
    .filter(({ text }) => text.length > 80)
    .map(({ page, text }) => `[${page.file} p.${page.page}]\n${text}`)
  return `Investigation: ${id}\n\n${parts.join('\n\n')}`
}

export const rawName = (id: string) => `extract-${id}`

async function main() {
  const args = process.argv.slice(2)
  const fresh = args.includes('--fresh')
  const named = args.filter((arg) => !arg.startsWith('--'))
  const ids = named.length ? named : INVESTIGATION_IDS
  const prompt = loadPrompt(PROMPT)
  for (const id of ids) {
    const user = inputFor(id)
    const raw = await ask({
      name: rawName(id),
      generatedBy: GENERATED_BY,
      subject: id,
      prompt,
      user,
      // The reply is checked field by field in verify.ts, so it only has to be JSON.
      // About 1,000 tokens of JSON: seven fields with their quotes.
      maxOutputTokens: 1_500,
      fresh,
    })
    console.log(`${id}: ${user.length} characters in, ${raw.usage?.output ?? '?'} tokens out (${raw.finishReason ?? 'no finish reason'})`)
  }
}

// Only when run as a script: verify.ts imports the helpers above.
if (process.argv[1]?.endsWith('extract.ts')) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
