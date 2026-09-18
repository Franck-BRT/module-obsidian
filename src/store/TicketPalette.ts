import type { DocState, DocStateConfig, MeetingKindConfig, Task, TaskType, TypeBadgeMode, TypeConfig } from '../types'
import { DEFAULT_DOC_STATES, DEFAULT_MEETING_KINDS, DEFAULT_TYPES } from '../types'
import { isDocument } from './Document'
import { meetingKindOf } from './Meeting'
import type { ZoneImpact } from './ZoneImpact'

/**
 * How tickets are marked, kept here rather than threaded through every row and card.
 *
 * Statuses and priorities are resolved per project, so they travel with the scope that
 * resolved them. A kind of ticket and a document's state are neither — they are the same
 * everywhere in the vault — and passing two palettes plus a display mode into every
 * composite that draws a ticket would be noise around a global. So the plugin sets this
 * once, on load and whenever the settings change, exactly as the locale is set.
 */
export interface TicketAppearance {
  types: TypeConfig[]
  docStates: DocStateConfig[]
  meetingKinds: MeetingKindConfig[]
  badges: TypeBadgeMode
}

let current: TicketAppearance = {
  types: DEFAULT_TYPES,
  docStates: DEFAULT_DOC_STATES,
  meetingKinds: DEFAULT_MEETING_KINDS,
  badges: 'distinct'
}

export function setTicketAppearance(appearance: TicketAppearance): void {
  current = appearance
}

/** Falls back to the built-in entry, so a settings file missing one still draws a badge. */
export function typeConfigOf(type: TaskType): TypeConfig {
  return (
    current.types.find((entry) => entry.id === type) ??
    DEFAULT_TYPES.find((entry) => entry.id === type) ??
    DEFAULT_TYPES[0]
  )
}

export function docStateConfigOf(state: DocState): DocStateConfig {
  return (
    current.docStates.find((entry) => entry.id === state) ??
    DEFAULT_DOC_STATES.find((entry) => entry.id === state) ??
    DEFAULT_DOC_STATES[0]
  )
}

/**
 * Whether this ticket says its kind on its own row.
 *
 * A document says so through its own badge, which carries its state as well, so it is
 * never marked twice. Under `distinct` a plain task says nothing either: it is the common
 * case, and a badge on every row is a badge on none.
 */
export function showsTypeBadge(task: Task): boolean {
  if (current.badges === 'none') return false
  if (isDocument(task)) return false
  // A meeting that says what it is about says it in its own badge, which names the kind
  // rather than just "meeting"; one that does not falls back to saying it is a meeting.
  if (meetingKindConfigOf(task)) return false
  return current.badges === 'all' || task.type !== 'task'
}

/** What this meeting is about, from the reader's own list. Null when it does not say. */
export function meetingKindConfigOf(task: Pick<Task, 'type' | 'meetingKind'>): MeetingKindConfig | null {
  return meetingKindOf(task, current.meetingKinds)
}

/**
 * Where the views ask whether a ticket meets another project.
 *
 * The same shape as the palette above and for the same reason: a row, a card and a bar
 * all want the answer, none of them holds the plugin, and threading it through every
 * composite that draws a ticket would be noise around what is effectively a global. The
 * plugin sets this once and clears it on unload.
 */
export interface ImpactLookup {
  forTask(taskId: string): ZoneImpact[]
  zoneLabel(zone: string): string
}

let impacts: ImpactLookup | null = null

export function setImpactLookup(lookup: ImpactLookup | null): void {
  impacts = lookup
}

export function impactsOfTask(taskId: string): ZoneImpact[] {
  return impacts?.forTask(taskId) ?? []
}

export function zoneLabelOf(zone: string): string {
  return impacts?.zoneLabel(zone) ?? zone
}
