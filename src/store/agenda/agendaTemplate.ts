import { fold } from '../library/libraryDoc'

/**
 * An agenda template: a note the reader writes as they want the agenda to read — its
 * headings, its order, its timings, its free sections — with, where the project's state
 * belongs, a block named between double braces: `{{retards}}`, `{{risques-critiques}}`,
 * `{{documents-en-retard}}`. Filled, each block becomes the list or table it names, read
 * off the project on the meeting's day; a name it does not know is left as written, for
 * another tool to fill.
 */

/** The blocks a template may name, by their French name and their English one. */
export const AGENDA_BLOCKS = [
  ['projet', 'project'],
  ['réunion', 'meeting'],
  ['date', 'date'],
  ['heure', 'time'],
  ['horizon', 'horizon'],
  ['participants', 'attendees'],
  ['intervenants', 'contacts'],
  ['avancement', 'progress'],
  ['jalons', 'milestones'],
  ['chemin-critique', 'critical-path'],
  ['lots', 'phases'],
  ['retards', 'late'],
  ['à-venir', 'upcoming'],
  ['décalages', 'slips'],
  ['charge', 'workload'],
  ['risques', 'risks'],
  ['risques-critiques', 'critical-risks'],
  ['risques-à-revoir', 'risks-to-review'],
  ['matrice-risques', 'risk-matrix'],
  ['décisions-à-prendre', 'pending-decisions'],
  ['décisions-récentes', 'recent-decisions'],
  ['visas-en-attente', 'pending-visas'],
  ['réserves', 'reserves'],
  ['budget', 'budget'],
  ['documents-en-retard', 'late-documents'],
  ['documents-attendus', 'expected-documents'],
  ['documents-en-revue', 'documents-in-review'],
  ['réunion-précédente', 'previous-meeting'],
  ['actions-précédentes', 'previous-actions']
] as const

/** A block, by its English name: what the code calls it. */
export type AgendaBlock = (typeof AGENDA_BLOCKS)[number][1]

/** A name as it is compared: accents, case, spaces and underscores aside. */
function keyOf(name: string): string {
  return fold(name)
    .trim()
    .replace(/[\s_]+/g, '-')
}

const BY_NAME = new Map<string, AgendaBlock>(
  AGENDA_BLOCKS.flatMap(([fr, en]) => [
    [keyOf(fr), en],
    [keyOf(en), en]
  ])
)

/** The block a name stands for, in either language; null when it names none. */
export function agendaBlock(name: string): AgendaBlock | null {
  return BY_NAME.get(keyOf(name)) ?? null
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g

/** The blocks a template names, each once, in the order they come. */
export function blocksIn(body: string): AgendaBlock[] {
  const out: AgendaBlock[] = []
  for (const found of body.matchAll(PLACEHOLDER)) {
    const block = agendaBlock(found[1])
    if (block && !out.includes(block)) out.push(block)
  }
  return out
}

/** The template filled: each block it names replaced by what `render` gives for it. */
export function fillAgenda(body: string, render: (block: AgendaBlock) => string): string {
  const cache = new Map<AgendaBlock, string>()
  return body.replace(PLACEHOLDER, (whole, name: string) => {
    const block = agendaBlock(name)
    if (!block) return whole
    let value = cache.get(block)
    if (value === undefined) {
      value = render(block)
      cache.set(block, value)
    }
    return value
  })
}

export interface AgendaTemplate {
  path: string
  name: string
  description: string
  /** The meeting kinds it is offered first for. */
  kinds: string[]
  /** Days ahead the agenda looks at: what is due, what is coming. */
  horizon: number
  /** The text to fill, its properties taken off. */
  body: string
}

/** Days ahead an agenda looks at when its template does not say. */
export const DEFAULT_HORIZON = 14

/** A template as its note says: its properties, and the text below them. */
export function readTemplate(
  path: string,
  name: string,
  frontmatter: Record<string, unknown> | null,
  body: string
): AgendaTemplate {
  const fm = frontmatter ?? {}
  const string = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
  const kinds = (Array.isArray(fm.meetingKind) ? fm.meetingKind : [fm.meetingKind]).map(string).filter(Boolean)
  const horizon = Number(fm.horizon)
  return {
    path,
    name: string(fm.name) || name,
    description: string(fm.description),
    kinds,
    horizon: Number.isFinite(horizon) && horizon > 0 ? Math.min(365, Math.round(horizon)) : DEFAULT_HORIZON,
    body
  }
}

/**
 * The template to offer first for a meeting: one made for its kind, else the first. The
 * templates are given in the order they are listed.
 */
export function templateFor(templates: AgendaTemplate[], kind: string | undefined): AgendaTemplate | null {
  if (kind) {
    const made = templates.find((one) => one.kinds.includes(kind))
    if (made) return made
  }
  return templates[0] ?? null
}

/** A block's name as a template in the reader's language writes it. */
export function blockName(block: AgendaBlock, french: boolean): string {
  return (french ? AGENDA_BLOCKS.find(([, en]) => en === block)?.[0] : undefined) ?? block
}
