import type { DecisionState, StatusConfig, Task, TaskDecision } from '../types'

/**
 * The decisions register: who decided what, when and why, and what it bears on. A
 * decision is a ticket of its own kind; the register lists those still to be taken
 * first — the one due soonest on top —, then those taken, the latest first, then those
 * replaced or dropped.
 */

export const DECISION_STATES: DecisionState[] = ['proposed', 'decided', 'superseded', 'cancelled']

export function isDecision(task: Pick<Task, 'type'>): boolean {
  return task.type === 'decision'
}

/** A decision as it starts: proposed, taken by nobody yet, bearing on nothing. */
export function emptyDecision(overrides: Partial<TaskDecision> = {}): TaskDecision {
  return { state: 'proposed', date: '', decidedBy: '', rationale: '', affects: [], ...overrides }
}

/** Its decision, or an empty one: what a reader of any ticket of the kind can count on. */
export function decisionOf(task: Pick<Task, 'decision'>): TaskDecision {
  return task.decision ?? emptyDecision()
}

const STATE_WORDS: [DecisionState, string[]][] = [
  ['proposed', ['proposed', 'proposee', 'propose', 'a prendre', 'a decider', 'en attente', 'pending', 'open', 'draft']],
  [
    'decided',
    [
      'decided',
      'decidee',
      'decide',
      'prise',
      'pris',
      'validee',
      'valide',
      'actee',
      'acte',
      'adoptee',
      'approved',
      'taken'
    ]
  ],
  ['superseded', ['superseded', 'remplacee', 'remplace', 'caduque', 'replaced', 'revised', 'revisee']],
  [
    'cancelled',
    ['cancelled', 'canceled', 'annulee', 'annule', 'abandonnee', 'abandonne', 'rejetee', 'rejected', 'dropped']
  ]
]

/** A state as the model, a note or the reader wrote it, in either language; null when it says none. */
export function readDecisionState(raw: unknown): DecisionState | null {
  if (typeof raw !== 'string') return null
  const folded = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .trim()
  for (const [state, words] of STATE_WORDS) if (words.includes(folded)) return state
  return null
}

/** Whether it still awaits taking. */
export function isPending(task: Pick<Task, 'decision'>): boolean {
  return decisionOf(task).state === 'proposed'
}

/**
 * The status a ticket takes with its decision's state, from the reader's statuses: a
 * decision taken or replaced is done, one dropped cancelled, one proposed back to the
 * first open status — and none to change when it already fits.
 */
export function statusForDecision(state: DecisionState, current: string, statuses: StatusConfig[]): string | null {
  const done = statuses.find((status) => status.complete && status.id === 'done') ?? statuses.find((s) => s.complete)
  const cancelled = statuses.find((status) => status.complete && status.id === 'cancelled') ?? done
  const open = statuses.find((status) => !status.complete)
  const want = state === 'proposed' ? open : state === 'cancelled' ? cancelled : done
  if (!want) return null
  const now = statuses.find((status) => status.id === current)
  // An open decision already in some open status — « en revue » — keeps it.
  if (state === 'proposed' && now && !now.complete) return null
  return want.id === current ? null : want.id
}

/** The date a decision is filed under: the day taken, else the day it is due, else the day it was written. */
export function decisionDay(task: Pick<Task, 'decision' | 'due' | 'createdAt'>): string {
  return decisionOf(task).date || task.due || task.createdAt.slice(0, 10)
}

const STATE_RANK: Record<DecisionState, number> = { proposed: 0, decided: 1, superseded: 2, cancelled: 3 }

/** The register's order: to take first, the soonest due on top; then taken, the latest first; then the rest. */
export function orderDecisions<T extends Pick<Task, 'decision' | 'due' | 'createdAt' | 'title'>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const sa = decisionOf(a).state
    const sb = decisionOf(b).state
    if (sa !== sb) return STATE_RANK[sa] - STATE_RANK[sb]
    if (sa === 'proposed') {
      const da = a.due || '9999'
      const db = b.due || '9999'
      return da.localeCompare(db) || a.title.localeCompare(b.title)
    }
    return decisionDay(b).localeCompare(decisionDay(a)) || a.title.localeCompare(b.title)
  })
}

/** What a decision bears on, as written: a note by its link, or words — a requirement's id among them. */
export type Affected = { kind: 'link'; link: string; target: string; label: string } | { kind: 'text'; text: string }

/** One entry of what a decision bears on, read: a link's target and label apart, or the words. */
export function readAffected(raw: string): Affected {
  const trimmed = raw.trim()
  const link = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(trimmed)
  if (link) {
    const target = link[1].trim()
    const label = (link[2] ?? '').trim() || target.replace(/^.*\//, '').replace(/\.md$/, '')
    return { kind: 'link', link: trimmed, target, label }
  }
  return { kind: 'text', text: trimmed }
}

/** An entry of what a decision bears on, as a reader names it: a link's label, or the words. */
export function affectedLabel(raw: string): string {
  const read = readAffected(raw)
  return read.kind === 'link' ? read.label : read.text
}

/** An entry added to what a decision bears on, once: the same link or words twice is one. */
export function withAffected(affects: string[], entry: string): string[] {
  const value = entry.trim()
  if (!value) return affects
  const key = (one: string): string => {
    const read = readAffected(one)
    return (read.kind === 'link' ? read.target : read.text).toLowerCase()
  }
  return affects.some((one) => key(one) === key(value)) ? affects : [...affects, value]
}

/** A note a decision can bear on, by the name the model or the reader gives it. */
export interface AffectedTarget {
  /** The names it answers to: a ticket's title, a requirement's id. */
  names: string[]
  path: string
  label: string
}

/**
 * What a decision bears on, its names made links where they name one note only — a
 * ticket by its title, a requirement by its id —, the rest kept as words.
 */
export function linkAffected(entries: string[], targets: AffectedTarget[]): string[] {
  return entries.map((entry) => {
    if (readAffected(entry).kind === 'link') return entry
    const wanted = fold(entry)
    const found = targets.filter((target) => target.names.some((name) => fold(name) === wanted))
    return found.length === 1 ? `[[${found[0].path}|${found[0].label}]]` : entry
  })
}

/** Whether a decision speaks of a word — in its title, its decider, its reasons or what it bears on. */
export function decisionMatches(task: Pick<Task, 'title' | 'description' | 'decision'>, words: string): boolean {
  const wanted = fold(words)
  if (!wanted) return true
  const decision = decisionOf(task)
  const affected = decision.affects.map((one) => {
    const read = readAffected(one)
    return read.kind === 'link' ? read.label : read.text
  })
  const haystack = fold([task.title, decision.decidedBy, decision.rationale, task.description, ...affected].join(' '))
  return wanted.split(/\s+/).every((word) => haystack.includes(word))
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** The decisions taken since a day, the latest first: what a status report says was decided. */
export function decidedSince<T extends Pick<Task, 'decision' | 'due' | 'createdAt' | 'title'>>(
  list: T[],
  since: string
): T[] {
  return orderDecisions(list.filter((task) => decisionOf(task).state === 'decided' && decisionDay(task) >= since))
}
