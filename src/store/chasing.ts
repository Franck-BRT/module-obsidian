import type { DocumentMeta, Task } from '../types'
import { documentOf, isAwaited } from './Document'
import { fold } from './library/libraryDoc'
import { addDays } from './Metrics'

/**
 * Chasing what a project still waits for: the documents expected and not received by
 * their date, gathered by who owes them — one reminder each —, with what was asked, when,
 * and how often they were chased already. The list is the plugin's, read off the
 * register: a reminder that names a document nobody owes, or a date nobody set, is worse
 * than none.
 */

export interface ChaseItem {
  id: string
  title: string
  reference: string
  issue: string
  /** The date it was expected by. */
  due: string
  daysLate: number
  issuer: string
  /** The days it was chased on, the latest last. */
  chases: string[]
}

export interface ChaseGroup {
  /** Who owes them, as the register names them; '' when it does not. */
  issuer: string
  items: ChaseItem[]
  /** The latest day any of them was chased; '' when never. */
  lastChase: string
  /** How many times the most chased of them was. */
  chaseCount: number
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000)
}

/** The documents of `tasks` still expected past their date, the latest overdue first. */
export function awaitedDocuments(tasks: Task[], today: string): ChaseItem[] {
  return tasks
    .filter((task) => !task.archived && isAwaited(task, today))
    .map((task) => {
      const meta = documentOf(task)
      return {
        id: task.id,
        title: task.title,
        reference: meta.reference,
        issue: meta.issue,
        due: task.due,
        daysLate: daysBetween(task.due, today),
        issuer: meta.issuer.trim(),
        chases: meta.chases ?? []
      }
    })
    .sort((a, b) => b.daysLate - a.daysLate || a.title.localeCompare(b.title))
}

/** The documents gathered by who owes them: the one owing the oldest first, the unnamed last. */
export function chaseGroups(items: ChaseItem[]): ChaseGroup[] {
  const groups = new Map<string, ChaseGroup>()
  for (const item of items) {
    const key = fold(item.issuer).replace(/\s+/g, ' ')
    let group = groups.get(key)
    if (!group) {
      group = { issuer: item.issuer, items: [], lastChase: '', chaseCount: 0 }
      groups.set(key, group)
    }
    group.items.push(item)
    const last = item.chases[item.chases.length - 1] ?? ''
    if (last > group.lastChase) group.lastChase = last
    group.chaseCount = Math.max(group.chaseCount, item.chases.length)
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.issuer !== !b.issuer) return a.issuer ? -1 : 1
    return (b.items[0]?.daysLate ?? 0) - (a.items[0]?.daysLate ?? 0) || a.issuer.localeCompare(b.issuer)
  })
}

/** The date to ask them by: `days` from today, moved to the Monday when it falls on a weekend. */
export function askedBy(today: string, days: number): string {
  const at = addDays(today, Math.max(1, Math.round(days)))
  const weekday = new Date(`${at}T00:00:00Z`).getUTCDay()
  return weekday === 6 ? addDays(at, 2) : weekday === 0 ? addDays(at, 1) : at
}

/** A document chased today: the day added once, whatever else it holds kept. */
export function recordChase(meta: DocumentMeta, day: string): DocumentMeta {
  const chases = meta.chases ?? []
  return chases.includes(day) ? meta : { ...meta, chases: [...chases, day].sort() }
}

export interface ChaseWords {
  /** A date as a letter writes it: « 14 octobre 2026 ». */
  date: (iso: string) => string
  subject: (project: string) => string
  greeting: string
  intro: (project: string) => string
  /** A document's line, its reference and issue only when it has them. */
  line: (item: { reference: string; title: string; issue: string; due: string }) => string
  already: (last: string, count: number) => string
  ask: (date: string) => string
  closing: string
}

/** The reminder to one who owes documents, ready to send: its subject and its body. */
export function chaseMail(
  group: ChaseGroup,
  context: { project: string; askedBy: string },
  words: ChaseWords
): { subject: string; body: string } {
  const lines = group.items.map((item) => `- ${words.line({ ...item, due: words.date(item.due) })}`)
  const body = [
    words.greeting,
    '',
    words.intro(context.project),
    '',
    ...lines,
    '',
    ...(group.lastChase ? [words.already(words.date(group.lastChase), group.chaseCount), ''] : []),
    words.ask(words.date(context.askedBy)),
    '',
    words.closing
  ]
  return { subject: words.subject(context.project), body: body.join('\n') }
}

export interface ChaseBlockWords {
  intro: string
  project: (title: string) => string
  issuer: (name: string) => string
  unnamed: string
  late: (days: number) => string
  chased: (dates: string) => string
  never: string
  none: string
}

/** The documents to chase, as the model is given them: by project, by who owes them, a line each. */
export function chaseBlock(projects: { title: string; groups: ChaseGroup[] }[], words: ChaseBlockWords): string {
  const out = [words.intro]
  for (const project of projects) {
    out.push(`## ${words.project(project.title)}`)
    if (!project.groups.length) out.push(words.none)
    for (const group of project.groups) {
      out.push(`### ${group.issuer ? words.issuer(group.issuer) : words.unnamed}`)
      for (const item of group.items) {
        const name = [item.reference, item.title, item.issue ? `ind. ${item.issue}` : ''].filter(Boolean).join(' — ')
        const chased = item.chases.length ? words.chased(item.chases.join(', ')) : words.never
        out.push(`- ${name} — ${item.due} (${words.late(item.daysLate)}) — ${chased}`)
      }
    }
  }
  return out.join('\n')
}

/** Whether a question asks to chase documents, in either language. */
export function asksForChase(question: string): boolean {
  return /relanc|pieces? manquantes?|documents? (?:attendus?|en retard|manquants?|non recus?)|chase|remind|missing documents?|overdue documents?/.test(
    fold(question)
  )
}
