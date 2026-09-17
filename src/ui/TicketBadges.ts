import type { Task } from '../types'
import { documentOf, isDocument } from '../store/Document'
import { docStateConfigOf, meetingKindConfigOf, showsTypeBadge, typeConfigOf } from '../store/TicketPalette'
import { taskTimeRange } from '../store/Meeting'
import { isIconName } from '../utils'
import { Chip } from './primitives/Chip'

/**
 * The mark a ticket carries for its kind: outlined and glyph-led, where a status is
 * filled. Two tickets can share a hue without being confused for one another, which
 * matters because the status palette got to the colour wheel first.
 */
export function renderTypeBadge(parent: HTMLElement, task: Task): void {
  if (!showsTypeBadge(task)) return
  const config = typeConfigOf(task.type)
  const chip = new Chip(parent).setLabel(config.label).setVariant('outline').setSize('sm').setColor(config.color)
  if (isIconName(config.icon)) chip.setLeadingIcon(config.icon)
  chip.setTooltip(config.label)
}

/**
 * The mark a document carries wherever it shows up as a ticket. It says the state rather
 * than just the kind: in a plan, "expected" and "approved" are the difference between
 * something to chase and something to forget about.
 */
export function renderDocumentBadge(parent: HTMLElement, task: Task): void {
  if (!isDocument(task)) return
  const meta = documentOf(task)
  const state = docStateConfigOf(meta.state)
  const chip = new Chip(parent)
    .setLabel(state.label)
    .setVariant('solid')
    .setSize('sm')
    .setColor(state.color)
    .setTooltip(`${typeConfigOf('document').label} · ${state.label}${meta.reference ? ` · ${meta.reference}` : ''}`)
  if (isIconName(state.icon)) chip.setLeadingIcon(state.icon)
}

/**
 * What a meeting is about, wherever it shows up as a ticket.
 *
 * It says the kind rather than just "meeting", for the same reason a document says its
 * state: in a plan full of meetings, technical and financial are the difference between
 * one to attend and one to send someone else to. It replaces the type badge rather than
 * joining it — twice-marked is no clearer than unmarked.
 */
export function renderMeetingBadge(parent: HTMLElement, task: Task): void {
  const kind = meetingKindConfigOf(task)
  if (!kind) return
  const chip = new Chip(parent)
    .setLabel(kind.label)
    .setVariant('solid')
    .setSize('sm')
    .setColor(kind.color)
    .setTooltip(`${typeConfigOf('meeting').label} · ${kind.label}`)
  if (isIconName(kind.icon)) chip.setLeadingIcon(kind.icon)
}

/**
 * The hours a ticket keeps, when it keeps any.
 *
 * On every kind, not only meetings: the plugin works in whole days, and the one thing a
 * day cannot say is when in it. Outlined and clock-led, so it reads as a detail of the
 * date rather than as another thing the ticket is.
 */
export function renderTimeBadge(parent: HTMLElement, task: Task): void {
  const range = taskTimeRange(task)
  if (!range) return
  new Chip(parent).setLabel(range).setVariant('outline').setSize('sm').setLeadingIcon('clock').setTooltip(range)
}
