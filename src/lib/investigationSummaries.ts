// What the "Investigations" section needs from public/data/investigations.json (SPEC F7): each
// checked quote as a claim the citation drawer can show, and ranges as text. Pure.
import type { Claim } from './claims'
import type { Evidence, Range } from './investigationVerify'

/** The BASS-II report, which PSI-25's summary is read from. */
const REPORT = 'nasa-tm-20210011385'

/** "PSI-98" is source "psi-98" in sources.json; a PDF page comes from the BASS-II report. */
export const sourceIdFor = (investigationId: string, evidence: Evidence): string =>
  /\.pdf$/i.test(evidence.file) ? REPORT : investigationId.toLowerCase()

/** A quote verify.ts found in an investigation's source, as a claim: checked, so `verified`. */
export function evidenceClaim(investigationId: string, evidence: Evidence, what: string): Claim {
  const pdf = /\.pdf$/i.test(evidence.file)
  return {
    id: `investigations.${investigationId}.${evidence.page}.${evidence.line ?? 'x'}.${evidence.quote.slice(0, 40)}`,
    topic: 'investigations',
    text: `${what}: a quote the AI chose from the source, checked by script`,
    kind: 'quoted',
    sourceId: sourceIdFor(investigationId, evidence),
    quote: evidence.quote,
    locator: pdf
      ? { pdfPage: evidence.page, reportPage: evidence.reportPage }
      : { file: evidence.file, ...(evidence.line !== null && { line: evidence.line }) },
    verified: true,
  }
}

const trim = (n: number) => String(Number(n.toFixed(2)))

/** "21.5 to 21.7%", "20 cm/s": a range as the source states it. */
export function rangeText(range: Range, unit: string): string {
  const joiner = unit === '%' ? '' : ' '
  return range.min === range.max ? `${trim(range.min)}${joiner}${unit}` : `${trim(range.min)} to ${trim(range.max)}${joiner}${unit}`
}
