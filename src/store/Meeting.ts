import type { MeetingKindConfig, Task } from '../types'
import { formatTimeRange } from './Clock'

/**
 * A meeting: a ticket that happens at an hour rather than over a stretch of days.
 *
 * It is a kind of ticket and not a thing of its own, for the same reason a document is:
 * everything a meeting needs — a date, people, a note, a place in a lot, something it
 * depends on — a ticket already has. What it adds is what it is about, and when in the
 * day it is.
 */
export function isMeeting(task: Pick<Task, 'type'>): boolean {
  return task.type === 'meeting'
}

/**
 * The kind this meeting is, or null when it does not say — which includes a kind the
 * reader has since deleted from their list. Null rather than a stand-in: naming it as
 * some other kind would be a claim about the meeting that nobody made.
 */
export function meetingKindOf(
  task: Pick<Task, 'type' | 'meetingKind'>,
  kinds: MeetingKindConfig[]
): MeetingKindConfig | null {
  if (!isMeeting(task)) return null
  const id = task.meetingKind
  if (!id) return null
  return kinds.find((kind) => kind.id === id) ?? null
}

/** The hours a ticket shows next to its date, empty when it keeps to whole days. */
export function taskTimeRange(task: Pick<Task, 'startTime' | 'endTime'>): string {
  return formatTimeRange(task.startTime ?? '', task.endTime ?? '')
}
