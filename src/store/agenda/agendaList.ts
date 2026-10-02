import { addDays } from '../Metrics'

/**
 * A project's agendas, as their notes say — the template they were made from, the day of
 * their meeting, the meeting itself — and where each stands: held, coming within the
 * rolling week, or further off and still being prepared.
 */

export type AgendaState = 'coming' | 'preparing' | 'held'

export interface AgendaNote {
  path: string
  /** The note's name. */
  name: string
  /** The meeting's day, YYYY-MM-DD; '' when the note does not say. */
  date: string
  template: string
  /** The meeting's link, as written; '' for none. */
  meeting: string
  /** The project's link, as written. */
  project: string
}

/** Days ahead that count as coming: the rolling week. */
export const COMING_DAYS = 7

/** Where an agenda stands on `today`: held before it, coming within the week, preparing after. */
export function agendaState(date: string, today: string): AgendaState {
  if (!date) return 'preparing'
  if (date < today) return 'held'
  return date <= addDays(today, COMING_DAYS) ? 'coming' : 'preparing'
}

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') return value.trim()
  return ''
}

/** An agenda as its note's properties say; null when the note is no agenda. */
export function readAgendaNote(
  path: string,
  name: string,
  fm: Record<string, unknown> | null | undefined
): AgendaNote | null {
  if (!fm || fm.agenda === undefined || fm.agenda === null) return null
  const date = text(fm.date).slice(0, 10)
  return {
    path,
    name,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    template: text(fm.agenda),
    meeting: text(fm.meeting),
    project: text(fm.project)
  }
}

/** The path a link points at, without its alias nor brackets: `[[A/B|b]]` is `A/B`. */
export function linkTarget(link: string): string {
  return (/^\[\[(.+?)\]\]$/.exec(link.trim())?.[1] ?? link.trim()).split('|')[0].trim()
}

/**
 * The agendas by state: those coming the soonest first, then those being prepared the
 * soonest first, then those held the latest first.
 */
export function agendasByState(notes: AgendaNote[], today: string): Record<AgendaState, AgendaNote[]> {
  const out: Record<AgendaState, AgendaNote[]> = { coming: [], preparing: [], held: [] }
  for (const note of notes) out[agendaState(note.date, today)].push(note)
  const soonest = (a: AgendaNote, b: AgendaNote): number =>
    (a.date || '9999').localeCompare(b.date || '9999') || a.name.localeCompare(b.name)
  out.coming.sort(soonest)
  out.preparing.sort(soonest)
  out.held.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
  return out
}
