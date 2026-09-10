import type PMPlugin from '../main'
import type { ProjectScope } from '../store'
import { groupRowsByProject } from '../store'
import { CollapseToggle } from '../ui/primitives/CollapseToggle'
import { renderGlyph } from '../ui/composites/properties'
import { safeAsync } from '../utils'
import { t } from '../i18n'

/** What every view puts above a block of rows drawn from one project. */
export interface ProjectHeading {
  projectPath: string
  title: string
  /** Both absent when the project cannot be resolved: the glyph falls back to a dot. */
  icon?: string
  color?: string
  /** Everything the block holds, folded or not. */
  count: number
  collapsed: boolean
}

export interface ProjectBlock<T> {
  heading: ProjectHeading
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
        projectPath: group.projectPath,
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
export function toggleProjectHeading(heading: ProjectHeading, scope: ProjectScope, plugin: PMPlugin): Promise<void> {
  if (scope.spec.kind !== 'collection') return Promise.resolve()
  return plugin.toggleCollectionGroupCollapsed(scope.spec.path, heading.projectPath)
}

export interface ProjectHeadingHandlers {
  onToggle: () => void | Promise<void>
  onOpen: () => void | Promise<void>
}

/** The heading itself, identical in every view: chevron, glyph, name, count. */
export function renderProjectHeading(
  parent: HTMLElement,
  heading: ProjectHeading,
  handlers: ProjectHeadingHandlers
): void {
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
  if (heading.projectPath) {
    title.addClass('pm-group-title--link')
    title.addEventListener(
      'click',
      safeAsync(async () => {
        await handlers.onOpen()
      })
    )
  }
  label.createSpan({ cls: 'pm-group-count', text: t('common.taskCount', { count: heading.count }) })
}
