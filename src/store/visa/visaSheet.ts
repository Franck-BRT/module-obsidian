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
 *
 * A later issue of the document is read against the observations still open on the one
 * before: each said lifted, partly lifted or not lifted, with what shows it; those not
 * lifted stay in force, with their severity, in the verdict and on the next sheet.
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

/** Where an observation of an earlier issue stands in this one. */
export type LiftState = 'lifted' | 'partial' | 'open'

export const LIFT_STATES: LiftState[] = ['lifted', 'partial', 'open']

/** An observation of an earlier issue, followed up in this one. */
export interface CarriedObservation extends VisaObservation {
  /** Its number, the issue it was raised at first: « B2 ». */
  ref: string
  state: LiftState
  /** What shows it lifted, or not. */
  note: string
}

export interface VisaSheet {
  verdict: DocVerdict
  summary: string
  /** What this issue newly raises. */
  observations: VisaObservation[]
  /** The observations still open on the sheet before, and where each stands now. */
  carried?: CarriedObservation[]
  /** The issue of that sheet, and the sheet itself by its path. */
  previous?: { issue: string; sheet: string }
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
  /** The observations still open on the sheet of an earlier issue, to say where each stands. */
  previous?: { issue: string; observations: CarriedObservation[] }
}

/**
 * The verdict a list of observations calls for — those of an earlier issue not lifted
 * counting with them —: none, a visa; one blocking, a refusal; else with observations.
 */
export function verdictFor(
  observations: Pick<VisaObservation, 'severity'>[],
  carried: Pick<CarriedObservation, 'severity' | 'state'>[] = []
): DocVerdict {
  const standing = [...observations, ...carried.filter((one) => one.state !== 'lifted')]
  if (standing.some((one) => one.severity === 'blocking')) return 'rejected'
  return standing.length ? 'observations' : 'approved'
}

/** Where an earlier observation stands, as written, in either language; open when it says none. */
export function readLiftState(raw: unknown): LiftState {
  const folded = typeof raw === 'string' ? fold(raw).replace(/[-_]/g, ' ').trim() : ''
  if (/^(lifted|levee?|leve|resolved|resolue?|closed|close|soldee?)$/.test(folded)) return 'lifted'
  if (/^(partial|partially lifted|partiellement levee?|partielle|partiel|in part)$/.test(folded)) return 'partial'
  return 'open'
}

/** The numbers new observations take at an issue: « C1 », « C2 »…; « 1 », « 2 » when it has none. */
export function numberObservations<T extends VisaObservation>(issue: string, list: T[]): (T & { ref: string })[] {
  const mark = issue.trim().replace(/\s+/g, '')
  return list.map((one, at) => ({ ...one, ref: `${mark}${at + 1}` }))
}

/**
 * The observations a sheet's note keeps, as its properties hold them, ready to follow up
 * at the next issue: those lifted dropped.
 */
export function openObservations(raw: unknown): CarriedObservation[] {
  if (!Array.isArray(raw)) return []
  const text = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
  return raw
    .map((one): CarriedObservation | null => {
      if (!one || typeof one !== 'object') return null
      const row = one as Record<string, unknown>
      const observation = text(row.observation)
      if (!observation) return null
      return {
        ref: text(row.ref),
        article: text(row.article),
        observation,
        severity: readSeverity(row.severity),
        source: text(row.source),
        state: readLiftState(row.state),
        note: text(row.note)
      }
    })
    .filter((one): one is CarriedObservation => !!one && one.state !== 'lifted')
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
export function readVisaReply(reply: string, previous: CarriedObservation[] = []): VisaSheet | null {
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
  // Each earlier observation where the reply says it stands, by its number; not said, still open.
  const followed = new Map<string, Record<string, unknown>>()
  for (const one of Array.isArray(record.previous) ? (record.previous as unknown[]) : []) {
    if (!one || typeof one !== 'object') continue
    const row = one as Record<string, unknown>
    const ref = text(row.ref ?? row.id ?? row.number).toUpperCase()
    if (ref) followed.set(ref, row)
  }
  const carried = previous.map((one): CarriedObservation => {
    const row = followed.get(one.ref.toUpperCase())
    return row
      ? { ...one, state: readLiftState(row.state ?? row.status), note: text(row.note ?? row.comment) }
      : { ...one, state: 'open', note: '' }
  })
  const said = readVerdict(record.verdict ?? record.avis)
  const owed = verdictFor(observations, carried)
  // Never kinder than its own observations; it may be sterner.
  const rank: Record<DocVerdict, number> = { approved: 0, observations: 1, rejected: 2 }
  const verdict = said && rank[said] >= rank[owed] ? said : owed
  return {
    verdict,
    summary: text(record.summary ?? record.synthese ?? record['synthèse']),
    observations,
    ...(previous.length ? { carried } : {})
  }
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
    requirementText || '(none given)',
    ...(input.previous?.observations.length
      ? [
          '',
          `# Observations still open on the review of issue ${input.previous.issue || '(previous)'}`,
          ...input.previous.observations.map(
            (one) =>
              `- ${one.ref} [${one.severity}]${one.article ? ` (${one.article})` : ''} : ${one.observation}${one.note ? ` — last follow-up: ${one.note}` : ''}`
          )
        ]
      : [])
  ].join('\n')
  const system = [
    'You review, for the client’s side, a document a contractor submitted for approval (« visa ») on a construction or engineering project: a drawing, a calculation note, a method statement, a data sheet.',
    'Read it against the reference documents (specifications such as a CCTP or CCTG, standards, the contract) and the project requirements given, and list your observations: a non-conformity, an omission, an inconsistency inside the document or with the references, a value out of the range required, a point to clarify.',
    'For each observation give: "article" — where it is in the document reviewed (section, article, sheet, detail), "observation" — one or two precise sentences quoting the figures concerned, "severity" — "minor" (form, clarification), "major" (to correct in the next issue) or "blocking" (a non-conformity that prevents executing the work), and "source" — the reference document and its article, or the requirement id, that it is checked against.',
    'Only raise what the texts given support: never invent a requirement, a standard or a value. A point the references do not cover is at most a minor request for clarification. A document that conforms gets no observation.',
    'Then propose the verdict: "approved" when there is no observation, "observations" when there are minor or major ones, "rejected" when at least one is blocking; and a two- or three-sentence "summary" of the review.',
    ...(input.previous?.observations.length
      ? [
          'This is a new issue of a document already reviewed. For each observation still open on the previous review, listed at the end, say whether this issue lifts it: "lifted" (corrected), "partial" (corrected in part) or "open" (not corrected), with a one-sentence "note" quoting what the new issue says. Do not repeat those observations among the new ones; list as new only what this issue newly gets wrong. Observations not lifted count in the verdict with their severity.'
        ]
      : []),
    `Write the observations, the notes and the summary in ${language}. Keep references, article numbers, values and units exactly as written.`,
    input.previous?.observations.length
      ? 'Answer with a JSON object only: {"verdict": "approved|observations|rejected", "summary": "…", "previous": [{"ref": "…", "state": "lifted|partial|open", "note": "…"}], "observations": [{"article": "…", "observation": "…", "severity": "minor|major|blocking", "source": "…"}]}'
      : 'Answer with a JSON object only: {"verdict": "approved|observations|rejected", "summary": "…", "observations": [{"article": "…", "observation": "…", "severity": "minor|major|blocking", "source": "…"}]}'
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
