import type { Task } from '../types'
import { otherSide, worstLevel, type ImpactLevel } from '../store/ZoneImpact'
import { impactLevelColor, impactLevelIcon, impactLevelLabel } from '../views/impacts/impactRole'
import { t } from '../i18n'
import { documentOf, isDocument } from '../store/Document'
import {
  docStateConfigOf,
  impactOpener,
  impactsOfTask,
  meetingKindConfigOf,
  showsTypeBadge,
  typeConfigOf,
  zoneLabelOf
} from '../store/TicketPalette'
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

/**
 * That this ticket meets another project in a zone.
 *
 * Marked where the work is looked at, not only in the view that lists crossings: a
 * reader moving a bar in the Gantt is exactly the reader who needs to know that the week
 * they are moving it into is the week the road is shut. The tooltip names who and when,
 * because a warning that does not say what it is warning about is only anxiety.
 */
export function renderImpactBadge(parent: HTMLElement, task: Task): void {
  const impacts = impactsOfTask(task.id)
  if (!impacts.length) return
  const lines = impacts.map((impact) => {
    const far = otherSide(impact, task.id)
    const when = impact.from === impact.to ? impact.from : `${impact.from} → ${impact.to}`
    return `${impactLevelLabel(impact.level)} · ${zoneLabelOf(impact.zone)} · ${far.projectTitle} · ${far.title} · ${when}`
  })
  // The badge speaks at the level of the gravest thing it stands in: a ticket blocked by
  // one crossing is blocked, whatever the other two amount to.
  const worst = impacts.reduce<ImpactLevel>((held, impact) => worstLevel(held, impact.level), 'info')
  const open = impactOpener()
  const chip = new Chip(parent)
    .setLabel(String(impacts.length))
    .setVariant('outline')
    .setSize('sm')
    .setLeadingIcon(impactLevelIcon(worst))
    .setColor(impactLevelColor(worst))
    .setTooltip(
      [t('impact.badge', { count: impacts.length }), ...lines, ...(open ? ['', t('impact.openLevel')] : [])].join('\n')
    )
  if (!open) return
  // The mark leads where it points: the crossings at the level it is showing, across
  // every zone. It is the same gesture as the level chip on the dashboard, offered here
  // because the reader moving a bar is the one who most needs the rest of the answer.
  chip.el.addClass('pm-clickable')
  chip.el.setAttr('role', 'button')
  chip.el.setAttr('tabindex', '0')
  chip.el.addEventListener('click', (event: MouseEvent) => {
    // The row underneath opens a ticket; this is its own thing.
    event.stopPropagation()
    open(worst)
  })
  chip.el.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    open(worst)
  })
}
