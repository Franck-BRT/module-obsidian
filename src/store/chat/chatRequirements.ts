import { isStale, isUnreviewedMachine, type Requirement } from '../requirements/Requirement'

/**
 * Requirements, written out for a model to read.
 *
 * Everything a reviewer would want in front of them to answer a question about a
 * requirement: its names, where it sits, its state, every wording it has with what is
 * known about each — which is the source, which has fallen behind, which a machine wrote
 * and nobody read — why it exists, where it comes from, and what it is linked to. A model
 * asked to reformulate a requirement and shown only its first language would reformulate
 * something narrower than what the library holds.
 */

/** The reader's words for what is written, so the model is spoken to in their language. */
export interface RequirementWords {
  /** The heading introducing the requirements to the model. */
  heading: (count: number) => string
  field: {
    aliases: string
    category: string
    type: string
    status: string
    criticality: string
    verification: string
    rationale: string
    source: string
    links: string
    text: string
  }
  /** A stored value — a status, a type — as the word the reader's palette gives it. */
  value: (field: 'type' | 'status' | 'criticality' | 'verification', value: string) => string
  source: string
  stale: string
  machine: string
  linkKind: (kind: string) => string
  /** What is said for the requirements that did not fit, by name. */
  left: (count: number, list: string) => string
}

/**
 * How much of the library goes with a question, in characters: room for fifteen or so
 * requirements written out whole, beside the note and the conversation.
 */
export const REQUIREMENTS_BUDGET = 16000

/** One requirement, written out. */
export function requirementText(requirement: Requirement, words: RequirementWords): string {
  const lines = [`### ${requirement.id}${requirement.title ? ` — ${requirement.title}` : ''}`]
  if (requirement.aliases.length) lines.push(`${words.field.aliases} : ${requirement.aliases.join(', ')}`)
  const facts: string[] = []
  if (requirement.category) facts.push(`${words.field.category} : ${requirement.category}`)
  for (const field of ['type', 'status', 'criticality', 'verification'] as const) {
    const value = requirement[field]
    if (value && value !== 'none') facts.push(`${words.field[field]} : ${words.value(field, value)}`)
  }
  if (facts.length) lines.push(facts.join(' · '))

  // The source first, then the translations: the source is what the others answer to.
  const langs = Object.keys(requirement.text).sort((a, b) =>
    a === requirement.sourceLang ? -1 : b === requirement.sourceLang ? 1 : a.localeCompare(b)
  )
  for (const lang of langs) {
    const notes = [lang.toUpperCase()]
    if (lang === requirement.sourceLang) notes.push(words.source)
    if (isStale(requirement, lang)) notes.push(words.stale)
    if (isUnreviewedMachine(requirement, lang)) notes.push(words.machine)
    lines.push(`${words.field.text} (${notes.join(', ')}) :`, requirement.text[lang].body)
  }
  if (requirement.rationale) lines.push(`${words.field.rationale} : ${requirement.rationale}`)
  if (requirement.source) lines.push(`${words.field.source} : ${requirement.source}`)
  if (requirement.links.length) {
    lines.push(
      `${words.field.links} : ${requirement.links.map((link) => `${words.linkKind(link.kind)} ${link.to}`).join(' ; ')}`
    )
  }
  return lines.join('\n')
}

/**
 * The requirements a question is asked about, as one block for the instructions.
 *
 * Whole requirements, in the order they were chosen, as many as fit; the ones that do not
 * are named, so the model can say it has not seen them rather than answer as if it had.
 */
export function requirementsContext(
  requirements: Requirement[],
  words: RequirementWords,
  budget = REQUIREMENTS_BUDGET
): string {
  if (!requirements.length) return ''
  const written: string[] = []
  let used = 0
  let at = 0
  for (; at < requirements.length; at++) {
    const text = requirementText(requirements[at], words)
    // The first always goes, cut or not: a question about one long requirement is still
    // a question about that requirement.
    if (written.length && used + text.length > budget) break
    written.push(text.length > budget ? `${text.slice(0, budget)}…` : text)
    used += text.length
  }
  const left = requirements.slice(at).map((requirement) => requirement.id)
  const tail = left.length ? `\n\n${words.left(left.length, left.join(', '))}` : ''
  return `${words.heading(requirements.length)}\n<requirements>\n${written.join('\n\n')}${tail}\n</requirements>`
}

/** The requirements the conversation's latest question was asked about, by identifier. */
export function currentRequirements(turns: { role: string; requirements?: string[] }[]): string[] {
  for (let at = turns.length - 1; at >= 0; at--) {
    if (turns[at].role === 'user') return turns[at].requirements ?? []
  }
  return []
}
