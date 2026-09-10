import type PMPlugin from '../main'
import type { Project, Task, TaskType, Recurrence } from '../types'
import { DEFAULT_DEPENDENCY_OPTION } from '../types'
import { collectAllAssignees, collectAllTags, findTask, flattenTasks } from '../store/TaskTreeOps'
import { isPhase } from '../store/Phase'
import { reaches } from '../store/Scheduler'
import { renderPropRow } from '../ui/FormField'
import { isTerminalStatus, priorityIcon, stringToColor } from '../utils'
import { completionOutcome, relativeDue } from '../dates'
import { renderCustomFieldInput } from './CustomFieldInputs'
import { renderPersonPicker } from '../ui/PersonPicker'
import {
  renderSelectControl,
  renderDateControl,
  renderInputControl,
  renderMultiSelect,
  renderAddProperty,
  renderDepRow,
  type SelectItem,
  type HiddenProperty
} from '../ui/composites/properties'
import { t } from '../i18n'

/** A copy of the option map with one predecessor left out. */
function withoutDependency(options: Task['dependencyOptions'], id: string): NonNullable<Task['dependencyOptions']> {
  const out: NonNullable<Task['dependencyOptions']> = {}
  for (const [key, value] of Object.entries(options ?? {})) {
    if (key !== id) out[key] = value
  }
  return out
}

export interface TaskFormFieldsContext {
  task: Task
  project: Project
  plugin: PMPlugin
  parentId: string | null
  setParentId: (id: string | null) => void
  rerender: () => void
  shownExtras: Set<string>
  /** Leaves the editor for the task a dependency names. */
  openTask: (path: string) => void
}

/** Functions, not constants: a constant would freeze the locale at import time. */
function typeOptions(): SelectItem[] {
  return [
    { id: 'task', label: t('task.type.task'), icon: 'square-check-big' },
    { id: 'subtask', label: t('task.type.subtask'), icon: 'git-branch' },
    { id: 'milestone', label: t('task.type.milestone'), icon: 'diamond' },
    { id: 'phase', label: t('task.type.phase'), icon: 'layers' },
    { id: 'document', label: t('task.type.document'), icon: 'file-text' }
  ]
}

function repeatOptions(): SelectItem[] {
  return [
    { id: 'none', label: t('task.repeat.none'), icon: 'repeat' },
    { id: 'daily', label: t('task.repeat.daily'), icon: 'repeat' },
    { id: 'weekly', label: t('task.repeat.weekly'), icon: 'repeat' },
    { id: 'monthly', label: t('task.repeat.monthly'), icon: 'repeat' },
    { id: 'yearly', label: t('task.repeat.yearly'), icon: 'repeat' }
  ]
}

/**
 * The property grid. Core properties always show; the rest hide when empty behind "Add
 * property". Single-selects and dates re-render the form on change; multi-selects mutate
 * the task in place and refresh their own chips.
 */
export function renderTaskFormFields(container: HTMLElement, ctx: TaskFormFieldsContext): void {
  const { task, project, plugin, rerender, shownExtras } = ctx
  const { statuses, priorities, priorityIcons, customFields } = plugin.store.configFor(project)
  const grid = container.createDiv('pm-prop-grid')

  renderPropRow(
    grid,
    t('field.type'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.type,
        options: typeOptions(),
        onChange: (id) => {
          task.type = id as TaskType
          if (id === 'milestone') {
            task.start = ''
            task.progress = 0
          }
          // The two parents mean different things: a subtask hangs off a task, anything
          // else sits in a lot. Switching keeps the parent only if it still makes sense.
          const parent = ctx.parentId ? findTask(project.tasks, ctx.parentId) : null
          const inPhase = !!parent && isPhase(parent)
          if (id === 'subtask' ? inPhase : !inPhase) ctx.setParentId(null)
          rerender()
        }
      })
      return cell
    },
    'shapes'
  )

  const phases = flattenTasks(project.tasks)
    .map((f) => f.task)
    .filter((candidate) => isPhase(candidate) && candidate.id !== task.id)

  // The parent picker shares the type row: a subtask picks the task it hangs off, and
  // anything else picks the lot it sits in. An empty cell holds the column when there is
  // neither, so switching type never reflows the grid.
  if (task.type === 'subtask') {
    renderPropRow(
      grid,
      t('field.parentTask'),
      () => {
        const cell = createDiv('pm-prop-value')
        const parents = flattenTasks(project.tasks)
          .map((f) => f.task)
          .filter((candidate) => candidate.id !== task.id && !isPhase(candidate))
        renderSelectControl({
          container: cell,
          value: ctx.parentId,
          options: [{ id: '', label: t('common.noParent') }, ...parents.map((t) => ({ id: t.id, label: t.title }))],
          placeholder: t('task.selectParent'),
          search: true,
          searchPlaceholder: t('task.searchTasks'),
          width: 230,
          onChange: (id) => {
            ctx.setParentId(id || null)
            rerender()
          }
        })
        return cell
      },
      'corner-up-right'
    )
  } else if (phases.length) {
    renderPropRow(
      grid,
      t('field.phase'),
      () => {
        const cell = createDiv('pm-prop-value')
        renderSelectControl({
          container: cell,
          value: ctx.parentId,
          options: [{ id: '', label: t('task.noPhase') }, ...phases.map((p) => ({ id: p.id, label: p.title }))],
          placeholder: t('task.selectPhase'),
          search: true,
          searchPlaceholder: t('task.searchTasks'),
          width: 230,
          onChange: (id) => {
            ctx.setParentId(id || null)
            rerender()
          }
        })
        return cell
      },
      'layers'
    )
  } else {
    grid.createDiv()
  }

  renderPropRow(
    grid,
    t('common.status'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.status,
        options: statuses.map((s) => ({ id: s.id, label: s.label, color: s.color, icon: s.icon || undefined })),
        onChange: (id) => {
          task.status = id
          rerender()
        }
      })
      return cell
    },
    'circle-dot'
  )

  renderPropRow(
    grid,
    t('common.priority'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: task.priority,
        options: priorities.map((p) => ({
          id: p.id,
          label: p.label,
          color: p.color,
          icon: priorityIcon(priorities, p.id, priorityIcons)
        })),
        onChange: (id) => {
          task.priority = id
          rerender()
        }
      })
      return cell
    },
    'flag'
  )

  renderPropRow(
    grid,
    task.type === 'milestone' ? t('field.date') : 'Due',
    () => {
      const cell = createDiv('pm-prop-value')
      renderDateControl({
        container: cell,
        value: task.due,
        emptyLabel: t('field.setDueDate'),
        hint: isTerminalStatus(task.status, statuses) ? null : relativeDue(task.due),
        onChange: (v) => {
          task.due = v
          rerender()
        }
      })
      return cell
    },
    'calendar-clock'
  )

  // Start shares the dates row with Due. Milestones have no start, so an empty cell holds
  // the slot and Assignees still leads the next row.
  if (task.type !== 'milestone') {
    renderPropRow(
      grid,
      t('field.start'),
      () => {
        const cell = createDiv('pm-prop-value')
        renderDateControl({
          container: cell,
          value: task.start,
          emptyLabel: t('field.setStart'),
          onChange: (v) => {
            task.start = v
            rerender()
          }
        })
        return cell
      },
      'play'
    )
  } else {
    grid.createDiv()
  }

  renderPropRow(
    grid,
    t('task.assignees'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderPersonPicker({
        container: cell,
        plugin,
        sourcePath: task.filePath ?? project.filePath,
        extra: () => [...project.teamMembers, ...collectAllAssignees(project.tasks)],
        addLabel: t('task.assign'),
        selected: () => task.assignees,
        add: (value) => {
          if (!task.assignees.includes(value)) task.assignees.push(value)
        },
        remove: (value) => {
          task.assignees = task.assignees.filter((a) => a !== value)
        }
      })
      return cell
    },
    'users'
  )

  if (task.completed || isTerminalStatus(task.status, statuses)) {
    renderPropRow(
      grid,
      t('field.completed'),
      () => {
        const cell = createDiv('pm-prop-value')
        renderDateControl({
          container: cell,
          value: task.completed,
          emptyLabel: t('field.setDate'),
          hint: completionOutcome(task.due, task.completed),
          onChange: (v) => {
            task.completed = v
            rerender()
          }
        })
        return cell
      },
      'circle-check-big'
    )
  }

  if (task.type !== 'milestone' && (task.progress > 0 || shownExtras.has('progress'))) {
    renderPropRow(
      grid,
      t('common.progress'),
      () => {
        const cell = createDiv('pm-prop-value')
        renderInputControl({
          container: cell,
          value: String(task.progress),
          inputType: 'number',
          suffix: '%',
          number: { min: 0, max: 100 },
          onChange: (v) => {
            task.progress = Number(v)
            rerender()
          }
        })
        return cell
      },
      'percent'
    )
  }

  if (task.recurrence || shownExtras.has('repeat')) {
    renderPropRow(
      grid,
      t('task.repeat'),
      () => {
        const cell = createDiv('pm-prop-value')
        renderSelectControl({
          container: cell,
          value: task.recurrence?.interval ?? 'none',
          options: repeatOptions(),
          onChange: (id) => {
            if (id === 'none') {
              task.recurrence = undefined
            } else {
              task.recurrence = {
                interval: id as Recurrence['interval'],
                every: task.recurrence?.every ?? 1,
                endDate: task.recurrence?.endDate
              }
            }
            rerender()
          }
        })
        return cell
      },
      'repeat'
    )
  }

  const tagsRow = renderPropRow(
    grid,
    t('field.tags'),
    () => {
      const cell = createDiv('pm-prop-value')
      const projectTags = collectAllTags(project.tasks)
      renderMultiSelect({
        container: cell,
        search: true,
        addLabel: t('task.addTags'),
        placeholder: t('task.findOrCreate'),
        tag: true,
        colorFor: plugin.settings.showTagColors ? (t) => stringToColor(t) : undefined,
        selected: () => task.tags,
        options: () => projectTags.map((t) => ({ id: t, label: t })),
        add: (id) => {
          if (!task.tags.includes(id)) task.tags.push(id)
        },
        remove: (id) => {
          task.tags = task.tags.filter((t) => t !== id)
        },
        create: (label) => {
          if (!task.tags.includes(label)) task.tags.push(label)
        }
      })
      return cell
    },
    'tag'
  )
  tagsRow.addClass('pm-prop-row--wide')

  if (task.dependencies.length > 0 || shownExtras.has('depends')) {
    const ownTasks = flattenTasks(project.tasks)
      .map((f) => f.task)
      .filter((t) => t.id !== task.id)
    const ownIds = new Set(ownTasks.map((t) => t.id))
    // Tasks in other projects can be depended on too, so the picker offers the whole
    // vault, this project first and everything else labelled with its project.
    const foreign = plugin.index
      .allTaskRefs()
      .filter((ref) => ref.id !== task.id && !ownIds.has(ref.id))
      .map((ref) => ({
        id: ref.id,
        label: ref.projectPath
          ? `${ref.title}  ·  ${plugin.index.projectRef(ref.projectPath)?.title ?? ''}`.trimEnd()
          : ref.title
      }))
    const allTasks: { id: string; label: string }[] = [
      ...ownTasks.map((t) => ({ id: t.id, label: t.title })),
      ...foreign
    ]
    const titleOf = (id: string) => allTasks.find((t) => t.id === id)?.label ?? id
    const depRow = renderPropRow(
      grid,
      t('task.dependsOn'),
      () => {
        const cell = createDiv('pm-prop-value')
        renderMultiSelect({
          container: cell,
          search: true,
          addLabel: t('task.addDependency'),
          addLabelMore: t('task.addAnother'),
          placeholder: t('task.searchTasks'),
          depsList: true,
          labelFor: titleOf,
          linkFor: (id) => {
            const path = plugin.index.task(id)?.path
            return path ? { path, open: () => ctx.openTask(path) } : null
          },
          selected: () => task.dependencies.filter((id) => allTasks.some((t) => t.id === id)),
          options: () => {
            // Built once per open, not once per candidate. A predecessor chain can leave
            // this project and come back, so every candidate is checked against the vault.
            const edges = plugin.index.dependentsMap()
            return allTasks.filter((t) => task.dependencies.includes(t.id) || !reaches(edges, task.id, t.id))
          },
          optionFor: (id) => ({
            value: task.dependencyOptions?.[id] ?? DEFAULT_DEPENDENCY_OPTION,
            onChange: (next) => {
              // Back to the default means no entry at all, so the note stays clean.
              const isDefault =
                next.type === DEFAULT_DEPENDENCY_OPTION.type && next.lag === DEFAULT_DEPENDENCY_OPTION.lag
              const options = withoutDependency(task.dependencyOptions, id)
              if (!isDefault) options[id] = next
              task.dependencyOptions = Object.keys(options).length ? options : undefined
            }
          }),
          add: (id) => {
            if (!task.dependencies.includes(id)) task.dependencies.push(id)
          },
          remove: (id) => {
            task.dependencies = task.dependencies.filter((d) => d !== id)
            const options = withoutDependency(task.dependencyOptions, id)
            task.dependencyOptions = Object.keys(options).length ? options : undefined
          }
        })
        return cell
      },
      'link-2'
    )
    depRow.addClass('pm-prop-row--wide')
  }

  // The other side of a dependency, which is otherwise only visible from the task that
  // declared it, and invisible altogether when that task is in another project.
  const blocks = plugin.index.dependents(task.id)
  if (blocks.length) {
    const blocksRow = renderPropRow(
      grid,
      t('task.blocks'),
      () => {
        const cell = createDiv('pm-prop-value')
        const list = cell.createDiv('pm-prop-deps')
        for (const ref of blocks) {
          const owner = ref.projectPath ? plugin.index.projectRef(ref.projectPath) : null
          renderDepRow(list, {
            id: ref.id,
            title: ref.title,
            tooltip: owner ? `In ${owner.title}` : undefined,
            link: { path: ref.path, open: () => ctx.openTask(ref.path) }
          })
        }
        return cell
      },
      'link-2'
    )
    blocksRow.addClass('pm-prop-row--wide')
  }

  const hidden: HiddenProperty[] = []
  if (task.type !== 'milestone' && task.progress === 0 && !shownExtras.has('progress')) {
    hidden.push({ id: 'progress', label: t('common.progress'), icon: 'percent' })
  }
  if (!task.recurrence && !shownExtras.has('repeat')) {
    hidden.push({ id: 'repeat', label: t('task.repeat'), icon: 'repeat' })
  }
  if (task.dependencies.length === 0 && !shownExtras.has('depends')) {
    hidden.push({ id: 'depends', label: t('task.dependsOn'), icon: 'link-2' })
  }
  if (hidden.length > 0) {
    const addCell = grid.createDiv('pm-prop-add-cell')
    renderAddProperty(addCell, hidden, (id) => {
      shownExtras.add(id)
      rerender()
    })
  }

  if (customFields.length > 0) {
    const cfSection = container.createDiv('pm-modal-section')
    cfSection.createEl('h4', { text: t('task.customFields'), cls: 'pm-modal-section-title' })
    const cfGrid = cfSection.createDiv('pm-prop-grid')
    for (const cf of customFields) {
      renderPropRow(cfGrid, cf.name, () => renderCustomFieldInput(cf, task, project, plugin, rerender))
    }
  }
}
