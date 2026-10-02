import type { DocVerdict } from '../../types'
import type { ChatRequest } from '../llm'
import { parseJsonContent } from '../llm/protocol'
import { fold } from '../library/libraryDoc'
import { languageName } from '../requirements/translate'

/**
 * A visa sheet drafted with the model: a document a contractor submits — a drawing, a
 * calculation note — read against what it has to answer to — the specification, the
 * project's requirements —, and the observations that come of it, each with where it
 * is, what is wrong, how serious, and what it is checked against; then the verdict that
 * follows: without observations, with observations, refused.
 *
 * Only a draft: the reviewer reads it, changes it, signs it. The model is told to find
 * nothing it cannot point to in the texts it was given, and its verdict is checked
 * against its own observations — one blocking observation is a refusal, whatever it said.
 */

export type VisaSeverity = 'minor' | 'major' | 'blocking'

export const VISA_SEVERITIES: VisaSeverity[] = ['minor', 'major', 'blocking']
export const VISA_VERDICTS: DocVerdict[] = ['approved', 'observations', 'rejected']

export interface VisaObservation {
  /** Where in the document reviewed: a section, an article, a sheet, a detail. */
  article: string
  observation: string
  severity: VisaSeverity
  /** What it is checked against: a reference's article, a requirement's id; '' for none. */
  source: string
}

export interface VisaSheet {
  verdict: DocVerdict
  summary: string
  observations: VisaObservation[]
}

/** A text the document is read against, by its name. */
export interface VisaReference {
  name: string
  text: string
}

export interface VisaRequirement {
  id: string
  title: string
  text: string
}

export interface VisaInput {
  document: { title: string; reference: string; issue: string; issuer: string; file: string; text: string }
  references: VisaReference[]
  requirements: VisaRequirement[]
  /** The language the sheet is written in, as a code. */
  language: string
}

/** The verdict a list of observations calls for: none, a visa; one blocking, a refusal; else with observations. */
export function verdictFor(observations: Pick<VisaObservation, 'severity'>[]): DocVerdict {
  if (observations.some((one) => one.severity === 'blocking')) return 'rejected'
  return observations.length ? 'observations' : 'approved'
}

const SEVERITY_WORDS: [VisaSeverity, string[]][] = [
  ['blocking', ['blocking', 'bloquant', 'bloquante', 'critique', 'critical', 'majeur bloquant', 'non conforme']],
  ['major', ['major', 'majeur', 'majeure', 'important', 'importante', 'significant']],
  ['minor', ['minor', 'mineur', 'mineure', 'faible', 'low', 'remarque', 'forme']]
]

/** A severity as written, in either language; minor when it says none. */
export function readSeverity(raw: unknown): VisaSeverity {
  const folded = typeof raw === 'string' ? fold(raw).trim() : ''
  for (const [severity, words] of SEVERITY_WORDS) if (words.includes(folded)) return severity
  return 'minor'
}

/** A verdict as written — « VSO », « VAO », « refusé », « approved » —; null when it says none. */
export function readVerdict(raw: unknown): DocVerdict | null {
  const folded = typeof raw === 'string' ? fold(raw).replace(/[-_]/g, ' ').trim() : ''
  if (/^(vso|approved|sans observation|vise sans observation|bon pour execution|bpe|conforme)$/.test(folded)) {
    return 'approved'
  }
  if (/^(vao|observations?|avec observations?|vise avec observations?|approved with comments)$/.test(folded)) {
    return 'observations'
  }
  if (/^(rejected|refuse|refused|refus|non conforme|defavorable)$/.test(folded)) return 'rejected'
  return null
}

/**
 * The model's reply, read: its observations kept where they say something, its verdict
 * held to them. Null when it is no sheet at all.
 */
export function readVisaReply(reply: string): VisaSheet | null {
  let parsed: unknown
  try {
    parsed = parseJsonContent<unknown>(reply)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
  const raw = Array.isArray(record.observations) ? (record.observations as unknown[]) : []
  const observations = raw
    .map((one): VisaObservation | null => {
      if (!one || typeof one !== 'object') return null
      const row = one as Record<string, unknown>
      const observation = text(row.observation ?? row.comment ?? row.text)
      if (!observation) return null
      return {
        article: text(row.article ?? row.section ?? row.location),
        observation,
        severity: readSeverity(row.severity ?? row.gravite ?? row['gravité']),
        source: text(row.source ?? row.reference ?? row['référence'])
      }
    })
    .filter((one): one is VisaObservation => !!one)
  const said = readVerdict(record.verdict ?? record.avis)
  const owed = verdictFor(observations)
  // Never kinder than its own observations; it may be sterner.
  const rank: Record<DocVerdict, number> = { approved: 0, observations: 1, rejected: 2 }
  const verdict = said && rank[said] >= rank[owed] ? said : owed
  return { verdict, summary: text(record.summary ?? record.synthese ?? record['synthèse']), observations }
}

/** A text cut to a length, saying it was cut. */
function cut(text: string, size: number, mark: string): string {
  const clean = text.trim()
  return clean.length > size ? `${clean.slice(0, size)}\n${mark}` : clean
}

/**
 * The question: the document, then what it is read against, within `budget` characters —
 * the requirements first, being short and the most binding; the document next; the
 * references sharing what is left.
 */
export function visaRequest(model: string, input: VisaInput, budget = 60_000): ChatRequest {
  const language = languageName(input.language)
  const mark = '[…]'
  const requirements = input.requirements
    .map((one) => `- ${one.id}${one.title ? ` — ${one.title}` : ''} : ${one.text.replace(/\s+/g, ' ').trim()}`)
    .join('\n')
  const requirementText = cut(requirements, Math.round(budget * 0.15), mark)
  const left = budget - requirementText.length
  const documentText = cut(input.document.text, Math.round(left * 0.45), mark)
  const share = input.references.length ? Math.floor((left - documentText.length) / input.references.length) : 0
  const doc = input.document
  const user = [
    '# Document submitted for review',
    [
      `Title: ${doc.title}`,
      doc.reference && `Reference: ${doc.reference}`,
      doc.issue && `Issue: ${doc.issue}`,
      doc.issuer && `Issued by: ${doc.issuer}`,
      doc.file && `File: ${doc.file}`
    ]
      .filter(Boolean)
      .join('\n'),
    '',
    documentText || '(no text could be read from the document)',
    '',
    '# Reference documents',
    ...(input.references.length
      ? input.references.flatMap((one) => [`## ${one.name}`, cut(one.text, share, mark), ''])
      : ['(none given)', '']),
    '# Project requirements',
    requirementText || '(none given)'
  ].join('\n')
  const system = [
    'You review, for the client’s side, a document a contractor submitted for approval (« visa ») on a construction or engineering project: a drawing, a calculation note, a method statement, a data sheet.',
    'Read it against the reference documents (specifications such as a CCTP or CCTG, standards, the contract) and the project requirements given, and list your observations: a non-conformity, an omission, an inconsistency inside the document or with the references, a value out of the range required, a point to clarify.',
    'For each observation give: "article" — where it is in the document reviewed (section, article, sheet, detail), "observation" — one or two precise sentences quoting the figures concerned, "severity" — "minor" (form, clarification), "major" (to correct in the next issue) or "blocking" (a non-conformity that prevents executing the work), and "source" — the reference document and its article, or the requirement id, that it is checked against.',
    'Only raise what the texts given support: never invent a requirement, a standard or a value. A point the references do not cover is at most a minor request for clarification. A document that conforms gets no observation.',
    'Then propose the verdict: "approved" when there is no observation, "observations" when there are minor or major ones, "rejected" when at least one is blocking; and a two- or three-sentence "summary" of the review.',
    `Write the observations and the summary in ${language}. Keep references, article numbers, values and units exactly as written.`,
    'Answer with a JSON object only: {"verdict": "approved|observations|rejected", "summary": "…", "observations": [{"article": "…", "observation": "…", "severity": "minor|major|blocking", "source": "…"}]}'
  ].join('\n')
  return {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  }
}
