import type { Task } from '../types'
import { documentOf, isDocument } from '../store/Document'
import { docStateConfigOf, showsTypeBadge, typeConfigOf } from '../store/TicketPalette'
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
