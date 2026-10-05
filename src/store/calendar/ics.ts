import type { StatusConfig, Task } from '../../types'
import { isTerminalStatus } from '../../utils'
import { flattenTasks } from '../TaskTreeOps'
import { isPhase, phaseSpan } from '../Phase'
import { addDays } from '../Metrics'
import { documentOf, isDocument } from '../Document'
import { isDecision, isPending } from '../decision'
import { isReserve, reserveOf } from '../reserve'
import { utf8 } from '../zip'

/**
 * A project's dates as a calendar file (RFC 5545) that Outlook, Thunderbird or any
 * calendar imports: its meetings at their hours, its milestones, the due dates of what
 * is still open — work, decisions, documents awaited, reserves to lift —, and its lots
 * as spans. Each event keeps the ticket's id in its UID, so importing the file again
 * updates the events rather than doubling them.
 */

export type IcsKind = 'meetings' | 'milestones' | 'dues' | 'decisions' | 'documents' | 'reserves' | 'phases'

export const ICS_KINDS: IcsKind[] = ['meetings', 'milestones', 'dues', 'decisions', 'documents', 'reserves', 'phases']

export interface IcsEvent {
  uid: string
  summary: string
  description: string
  /** YYYY-MM-DD for a whole day, or YYYY-MM-DDTHH:MM for a time. */
  start: string
  /** Exclusive for a whole day, as the format wants it. */
  end: string
  categories: string
}

export interface IcsWords {
  project: string
  meeting: (title: string) => string
  milestone: (title: string) => string
  due: (title: string) => string
  decision: (title: string) => string
  document: (title: string) => string
  reserve: (title: string) => string
  phase: (title: string) => string
  category: (kind: IcsKind) => string
  /** Who is on a ticket, as its description says it. */
  people: (names: string[]) => string
}

const PRODUCT = '-//Black Projects//Obsidian//FR'

/** Text as a property value carries it: backslashes, commas, semicolons and line breaks escaped. */
export function icsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

/** A line folded at 75 octets, as the format requires, never inside a character. */
export function foldLine(line: string): string {
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = utf8(char).length
    // The first line holds 75 octets; the next ones 74, after their leading space.
    if (size + bytes > (parts.length ? 74 : 75)) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += char
    size += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const compact = (date: string): string => date.replace(/-/g, '').replace(':', '')

function dateProperty(name: string, value: string): string {
  return value.includes('T') ? `${name}:${compact(value)}00` : `${name};VALUE=DATE:${compact(value)}`
}

/** The day's events of one ticket, by what it is. */
function eventsOf(task: Task, statuses: StatusConfig[], kinds: Set<IcsKind>, words: IcsWords): IcsEvent[] {
  const open = !isTerminalStatus(task.status, statuses)
  const people = task.assignees.length ? words.people(task.assignees) : ''
  const describe = (...parts: string[]): string =>
    [words.project, ...parts, task.description.trim()].filter(Boolean).join('\n')
  const day = (kind: IcsKind, date: string, summary: string, detail = ''): IcsEvent => ({
    uid: `${task.id}-${kind}@black-projects`,
    summary,
    description: describe(detail, people),
    start: date,
    end: addDays(date, 1),
    categories: words.category(kind)
  })
  if (task.type === 'meeting') {
    const date = task.due || task.start
    if (!kinds.has('meetings') || !date) return []
    if (task.startTime) {
      const end = task.endTime && task.endTime > task.startTime ? task.endTime : task.startTime
      return [
        {
          uid: `${task.id}-meetings@black-projects`,
          summary: words.meeting(task.title),
          description: describe(people),
          start: `${date}T${task.startTime}`,
          end: `${date}T${end === task.startTime ? addHour(end) : end}`,
          categories: words.category('meetings')
        }
      ]
    }
    return [day('meetings', date, words.meeting(task.title))]
  }
  if (task.type === 'milestone') {
    const date = task.due || task.start
    return kinds.has('milestones') && date ? [day('milestones', date, words.milestone(task.title))] : []
  }
  if (isPhase(task)) {
    if (!kinds.has('phases')) return []
    const span = phaseSpan(task, statuses)
    if (!span.start || !span.due) return []
    return [{ ...day('phases', span.start, words.phase(task.title)), end: addDays(span.due, 1) }]
  }
  if (!task.due || !open) return []
  if (isDecision(task)) {
    return kinds.has('decisions') && isPending(task) ? [day('decisions', task.due, words.decision(task.title))] : []
  }
  if (isDocument(task)) {
    const meta = documentOf(task)
    if (!kinds.has('documents') || meta.state !== 'expected') return []
    const name = [meta.reference, task.title].filter(Boolean).join(' — ')
    return [day('documents', task.due, words.document(name), meta.issuer)]
  }
  if (isReserve(task)) {
    const reserve = reserveOf(task)
    if (!kinds.has('reserves') || reserve.state === 'lifted') return []
    return [
      day('reserves', task.due, words.reserve([reserve.number, task.title].filter(Boolean).join(' ')), reserve.location)
    ]
  }
  if (task.type === 'risk') return []
  return kinds.has('dues') ? [day('dues', task.due, words.due(task.title))] : []
}

function addHour(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  return `${String(Math.min(23, hours + 1)).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** A project's events, by date. */
export function icsEvents(tasks: Task[], statuses: StatusConfig[], kinds: IcsKind[], words: IcsWords): IcsEvent[] {
  const wanted = new Set(kinds)
  const seen = new Set<string>()
  return flattenTasks(tasks)
    .map((flat) => flat.task)
    .filter((task) => !task.archived && !seen.has(task.id) && !!seen.add(task.id))
    .flatMap((task) => eventsOf(task, statuses, wanted, words))
    .sort((a, b) => a.start.localeCompare(b.start) || a.summary.localeCompare(b.summary))
}

/** The calendar file: its name, then each event, lines folded and ended as the format wants. */
export function icsCalendar(name: string, events: IcsEvent[], at = new Date()): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`
  ]
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      dateProperty('DTSTART', event.start),
      dateProperty('DTEND', event.end),
      `SUMMARY:${icsText(event.summary)}`,
      ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
      `CATEGORIES:${icsText(event.categories)}`,
      // A whole day is not time taken: the calendar shows its owner free.
      `TRANSP:${event.start.includes('T') ? 'OPAQUE' : 'TRANSPARENT'}`,
      'END:VEVENT'
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(foldLine).join('\r\n')}\r\n`
}
