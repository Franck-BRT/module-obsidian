import type PMPlugin from '../main'
import type { ProjectScope } from '../store'
import type { StatusConfig, Task } from '../types'
import { groupRowsByProject } from '../store'
import { phaseSpan } from '../store/Phase'
import { findTaskById } from '../store/TaskIndex'
import { openTaskModal } from '../ui/ModalFactory'
import { formatDateShort } from '../dates'
import { CollapseToggle } from '../ui/primitives/CollapseToggle'
import { IconButton } from '../ui/primitives/IconButton'
import { renderGlyph } from '../ui/composites/properties'
import { safeAsync } from '../utils'
import { t } from '../i18n'

/**
 * What every view puts above a block of rows: a collection's project, or a phase inside
 * a project. `of` is what the block stands for and `key` names it — a project path or a
 * phase's task id — so a consumer can tell which it is holding.
 */
export interface HeadingRow {
  of: 'project' | 'phase'
  key: string
  title: string
  /** Both absent when there is nothing to draw: the glyph falls back to a dot. */
  icon?: string
  color?: string
  /** Everything the block holds, folded or not. */
  count: number
  collapsed: boolean
  /** Read after the count, muted: a phase's dates and progress. */
  detail?: string
  /** How deep the block sits. A lot inside a lot steps in, and so do its tasks. */
  depth?: number
}

export interface ProjectBlock<T> {
  heading: HeadingRow
  rows: T[]
}

/**
 * Splits a collection's rows into one block per owning project.
 *
 * Null for every other scope, which is the signal to render the rows as they are: a
 * project view has one project, and a folder or vault view says which project a row
 * belongs to in its own column. Only a collection gathers rows whose origin is
 * otherwise invisible.
 */
export function collectionBlocks<T>(
  rows: T[],
  taskIdOf: (row: T) => string,
  scope: ProjectScope,
  plugin: PMPlugin
): ProjectBlock<T>[] | null {
  if (scope.spec.kind !== 'collection') return null
  const folded = new Set(plugin.settings.collapsedCollectionGroups[scope.spec.path] ?? [])
  return groupRowsByProject(rows, (row) => scope.projectOf(taskIdOf(row))?.filePath ?? null).map((group) => {
    const ref = group.projectPath ? plugin.index.projectRef(group.projectPath) : null
    return {
      heading: {
        of: 'project',
        key: group.projectPath,
        title: ref?.title ?? t('collection.orphanGroup'),
        icon: ref?.icon,
        color: ref?.color,
        count: group.rows.length,
        collapsed: folded.has(group.projectPath)
      },
      rows: group.rows
    }
  })
}

/**
 * Folds a heading, in whichever view was clicked. The state is keyed by collection and
 * project rather than by view, so a project folded in the table is folded in the board
 * and the Gantt too — it is one collection either way.
 */
export function toggleProjectHeading(heading: HeadingRow, scope: ProjectScope, plugin: PMPlugin): Promise<void> {
  if (scope.spec.kind !== 'collection') return Promise.resolve()
  return plugin.toggleCollectionGroupCollapsed(scope.spec.path, heading.key)
}

export interface ProjectHeadingHandlers {
  onToggle: () => void | Promise<void>
  onOpen: () => void | Promise<void>
  /** Offered on a phase: the block is where its tasks go, so it can take a new one. */
  onAdd?: () => void
}

/** The heading itself, identical in every view: chevron, glyph, name, count. */
export function renderHeadingRow(parent: HTMLElement, heading: HeadingRow, handlers: ProjectHeadingHandlers): void {
  new CollapseToggle(parent, {
    collapsed: heading.collapsed,
    subject: heading.title,
    onToggle: safeAsync(async () => {
      await handlers.onToggle()
    })
  })

  const label = parent.createDiv({ cls: 'pm-group-label' })
  if (heading.color) label.setCssProps({ '--pm-group-color': heading.color })
  renderGlyph(label, { icon: heading.icon, color: heading.color })
  const title = label.createSpan({ cls: 'pm-group-title', text: heading.title })
  // A block whose project is gone has nothing to open.
  if (heading.key) {
    title.addClass('pm-group-title--link')
    title.addEventListener(
      'click',
      safeAsync(async () => {
        await handlers.onOpen()
      })
    )
  }
  label.createSpan({ cls: 'pm-group-count', text: t('common.taskCount', { count: heading.count }) })
  if (heading.detail) label.createSpan({ cls: 'pm-group-detail', text: heading.detail })
  if (handlers.onAdd) {
    new IconButton(parent)
      .setIcon('plus')
      .setTooltip(t('task.addToPhase'))
      .setRevealOnHover(true)
      .onClick((e) => {
        e.stopPropagation()
        handlers.onAdd?.()
      })
  }
}

/**
 * The heading a phase shows. Its count and progress are read from what it holds, and
 * its dates are whatever `phaseSpan` settles on — a declaration if it made one, the
 * roll-up otherwise — so the line always describes the work, never an intention alone.
 */
export function phaseHeading(phase: Task, statuses: StatusConfig[], depth = 0): HeadingRow {
  const span = phaseSpan(phase, statuses)
  const range =
    span.start === span.due
      ? formatDateShort(span.start)
      : `${formatDateShort(span.start)} → ${formatDateShort(span.due)}`
  const detail = [span.start ? range : '', span.count ? `${span.progress}%` : ''].filter(Boolean).join(' \u00b7 ')
  return {
    of: 'phase',
    key: phase.id,
    title: phase.title,
    icon: 'layers',
    count: span.count,
    collapsed: phase.collapsed,
    depth,
    ...(detail ? { detail } : {})
  }
}

/**
 * What clicking a heading does, which depends on what it stands for. A project heading
 * folds per collection and opens the project note; a phase folds like the task it is —
 * the same `collapsed` flag its chevron has always had — and opens its own editor,
 * which is where its title and its declared dates are changed.
 */
export function headingHandlers(
  heading: HeadingRow,
  scope: ProjectScope,
  plugin: PMPlugin,
  refresh: () => void | Promise<void>
): ProjectHeadingHandlers {
  if (heading.of === 'project') {
    return {
      onToggle: async () => {
        await toggleProjectHeading(heading, scope, plugin)
        await refresh()
      },
      onOpen: () => plugin.router.openProjectLink(heading.key)
    }
  }
  const project = scope.projectOf(heading.key)
  return {
    onToggle: async () => {
      if (!project) return
      await plugin.toggleTaskCollapsed(project, heading.key)
      await refresh()
    },
    onOpen: () => {
      const task = project ? findTaskById(project, heading.key) : null
      if (!project || !task) return
      openTaskModal(plugin, project, {
        task,
        onSave: async () => {
          await refresh()
        }
      })
    }
  }
}
