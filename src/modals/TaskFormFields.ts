import type PMPlugin from '../main'
import type { Project, Task, TaskType, Recurrence } from '../types'
import { DEFAULT_DEPENDENCY_OPTION, TASK_TYPES } from '../types'
import { typeConfigOf } from '../store/TicketPalette'
import { formatDuration, minutesBetween, parseTime } from '../store/Clock'
import { collectAllAssignees, collectAllTags, findTask, flattenTasks } from '../store/TaskTreeOps'
import { isPhase } from '../store/Phase'
import { reaches } from '../store/Scheduler'
import { renderPropRow } from '../ui/FormField'
import { isTerminalStatus, priorityIcon, stringToColor } from '../utils'
import { completionOutcome, relativeDue } from '../dates'
import { renderCustomFieldInput } from './CustomFieldInputs'
import { renderPersonPicker } from '../ui/PersonPicker'
import { DependencyPickerModal } from './DependencyPickerModal'
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

/**
 * The kinds of ticket, from the palette rather than from a list written here.
 *
 * The add menu already reads the palette, so a kind renamed or re-iconed in the settings
 * changed there and not in this dropdown — the same vocabulary under two names. Reading
 * the same place is what stops them drifting apart again.
 */
function typeOptions(): SelectItem[] {
  return TASK_TYPES.map((type) => {
    const config = typeConfigOf(type)
    return { id: config.id, label: config.label, icon: config.icon }
  })
}

/** What a meeting can be about, plus whatever this one already says it is. */
function meetingKindOptions(plugin: PMPlugin, current: string | undefined): SelectItem[] {
  const kinds = plugin.settings.meetingKinds
  const options: SelectItem[] = kinds.map((kind) => ({ id: kind.id, label: kind.label, icon: kind.icon }))
  // A kind deleted from the settings would otherwise take every meeting that used it down
  // with it on the next save. It is kept, and marked, so the loss is a decision.
  if (current && !kinds.some((kind) => kind.id === current)) {
    options.push({ id: current, label: t('meeting.kindGone', { id: current }), icon: 'circle-help' })
  }
  return options
}

/** What "every 2" is counting, in the plural the number needs. Exhaustive by design. */
function repeatUnitLabel(rec: Recurrence): string {
  const count = Math.max(1, Math.floor(rec.every || 1))
  switch (rec.interval) {
    case 'daily':
      return t('task.repeatUnit.day', { count })
    case 'weekly':
      return t('task.repeatUnit.week', { count })
    case 'monthly':
      return t('task.repeatUnit.month', { count })
    case 'yearly':
      return t('task.repeatUnit.year', { count })
  }
}

/** Never, a last day, or a number of times. Exhaustive, so a new ending needs a name. */
function repeatEndOptions(): SelectItem[] {
  return [
    { id: 'never', label: t('task.repeatEnd.never'), icon: 'infinity' },
    { id: 'date', label: t('task.repeatEnd.date'), icon: 'calendar' },
    { id: 'count', label: t('task.repeatEnd.count'), icon: 'hash' }
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
 * One end of an hour range.
 *
 * A plain text box rather than `<input type="time">`: the native one renders as a
 * different control in every theme and refuses anything it does not like without saying
 * so, whereas what a reader types — `9`, `9h30`, `14:05` — is all perfectly clear. It is
 * read on the way out, and an unreadable value clears rather than being kept as junk.
 */
function renderTimeInput(cell: HTMLElement, value: string, placeholder: string, onChange: (v: string) => void): void {
  const input = cell.createEl('input', { type: 'text', cls: 'pm-prop-text pm-prop-time' })
  input.value = value
  input.placeholder = placeholder
  input.addEventListener('change', () => {
    onChange(parseTime(input.value))
  })
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
            // Its day moves to the due date rather than being thrown away with the start:
            // a milestone marks a day, and a task being turned into one already had it.
            task.due = task.due || task.start
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

  // What the meeting is about. Only a meeting has one, and it says so right under the
  // kind of ticket it is, because the two answer the same question at two depths.
  if (task.type === 'meeting') {
    renderPropRow(
      grid,
      t('meeting.kindField'),
      () => {
        const cell = createDiv('pm-prop-value')
        renderSelectControl({
          container: cell,
          value: task.meetingKind ?? '',
          options: meetingKindOptions(plugin, task.meetingKind),
          placeholder: t('meeting.kindNone'),
          onChange: (id) => {
            task.meetingKind = id || undefined
            rerender()
          }
        })
        return cell
      },
      'users'
    )
  }

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

  // A template is written before anyone knows when the project runs, so the honest thing
  // it can say about a ticket is how long it takes. It shares the dates row's place in the
  // grid, and appears nowhere else: in a real project the dates are the answer.
  if (project.template && task.type !== 'milestone') {
    renderPropRow(
      grid,
      t('field.duration'),
      () => {
        const cell = createDiv('pm-prop-value')
        const input = cell.createEl('input', { type: 'number', cls: 'pm-prop-text pm-prop-duration' })
        input.value = task.duration !== undefined && task.duration > 0 ? String(task.duration) : ''
        input.placeholder = t('field.durationDays')
        input.min = '1'
        input.step = '1'
        input.addEventListener('change', () => {
          const days = Math.round(parseFloat(input.value))
          task.duration = Number.isNaN(days) || days <= 0 ? undefined : days
        })
        return cell
      },
      'ruler'
    )
  }

  // Hours, for the tickets that have them. A meeting always shows the row — an hour is
  // most of what a meeting is — and any other ticket can be given one from "Add property",
  // because a deadline at five in the afternoon is a real thing to want to write down.
  if (task.type === 'meeting' || task.startTime || task.endTime || shownExtras.has('hours')) {
    renderPropRow(
      grid,
      t('field.timeRange'),
      () => {
        const cell = createDiv('pm-prop-value pm-prop-hours')
        renderTimeInput(cell, task.startTime ?? '', t('field.startTime'), (value) => {
          task.startTime = value || undefined
          rerender()
        })
        cell.createSpan({ cls: 'pm-prop-hours-sep', text: '–' })
        renderTimeInput(cell, task.endTime ?? '', t('field.endTime'), (value) => {
          task.endTime = value || undefined
          rerender()
        })
        const length = minutesBetween(task.startTime ?? '', task.endTime ?? '')
        if (length !== null) {
          cell.createSpan({
            cls: 'pm-prop-hint',
            text: formatDuration(length, { hours: t('unit.hourShort'), minutes: t('unit.minuteShort') })
          })
        } else if (task.startTime && task.endTime) {
          // Said out loud rather than quietly corrected: the reader typed one of them wrong.
          cell.createSpan({ cls: 'pm-prop-hint pm-prop-hint--warn', text: t('field.endBeforeStart') })
        }
        return cell
      },
      'clock'
    )
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
    const repeatRow = renderPropRow(
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
                ...task.recurrence,
                interval: id as Recurrence['interval'],
                every: task.recurrence?.every ?? 1
              }
            }
            rerender()
          }
        })
        // A repetition is worked out from the task's own dates, so one with neither has
        // nothing to count from and would quietly never happen. Said here, where the
        // repetition is set, rather than discovered weeks later.
        if (task.recurrence && !task.start && !task.due) {
          cell.createDiv({ cls: 'pm-prop-hint pm-prop-hint--warn', text: t('task.repeatNeedsDate') })
        }
        return cell
      },
      'repeat'
    )
    repeatRow.addClass('pm-prop-row--wide')
  }

  const recurrence = task.recurrence
  if (recurrence) {
    renderPropRow(
      grid,
      t('task.repeatEvery'),
      () => {
        const cell = createDiv('pm-prop-value pm-repeat-every')
        const input = cell.createEl('input', { type: 'number', cls: 'pm-prop-text pm-prop-duration' })
        input.value = String(Math.max(1, Math.floor(recurrence.every || 1)))
        input.min = '1'
        input.step = '1'
        input.addEventListener('change', () => {
          const every = Math.floor(parseFloat(input.value))
          recurrence.every = Number.isNaN(every) || every < 1 ? 1 : every
          rerender()
        })
        cell.createSpan({ cls: 'pm-prop-unit', text: repeatUnitLabel(recurrence) })
        return cell
      },
      'repeat-2'
    )

    renderPropRow(
      grid,
      t('task.repeatEndLabel'),
      () => {
        const cell = createDiv('pm-prop-value')
        const mode = recurrence.count !== undefined ? 'count' : recurrence.endDate ? 'date' : 'never'
        renderSelectControl({
          container: cell,
          value: mode,
          options: repeatEndOptions(),
          onChange: (id) => {
            // One ending at a time: choosing a date clears the count and the other way
            // round, so the note never carries two answers to the same question.
            recurrence.endDate = id === 'date' ? (recurrence.endDate ?? (task.due || task.start)) : undefined
            recurrence.count = id === 'count' ? (recurrence.count ?? 5) : undefined
            rerender()
          }
        })
        if (mode === 'date') {
          renderDateControl({
            container: cell,
            value: recurrence.endDate ?? '',
            emptyLabel: t('field.setDate'),
            onChange: (v) => {
              recurrence.endDate = v || undefined
              rerender()
            }
          })
        }
        if (mode === 'count') {
          const input = cell.createEl('input', { type: 'number', cls: 'pm-prop-text pm-prop-duration' })
          input.value = String(Math.max(1, Math.floor(recurrence.count ?? 1)))
          input.min = '1'
          input.step = '1'
          input.addEventListener('change', () => {
            const count = Math.floor(parseFloat(input.value))
            recurrence.count = Number.isNaN(count) || count < 1 ? 1 : count
            rerender()
          })
          cell.createDiv({ cls: 'pm-prop-hint', text: t('task.repeatCountHint') })
        }
        return cell
      },
      'circle-stop'
    )
  }

  // Where this ticket happens. Only offered once the reader has said what their zones
  // are: a picker over an empty palette teaches nothing, so it says where to make them.
  const zonesRow = renderPropRow(
    grid,
    t('zone.field'),
    () => {
      const cell = createDiv('pm-prop-value')
      const palette = plugin.settings.zones
      if (!palette.length) {
        cell.createSpan({ cls: 'pm-prop-hint', text: t('zone.needsPalette') })
        return cell
      }
      renderMultiSelect({
        container: cell,
        search: true,
        addLabel: t('zone.field'),
        placeholder: t('task.findOrCreate'),
        selected: () => task.zones ?? [],
        options: () => palette.map((zone) => ({ id: zone.id, label: zone.label, color: zone.color, icon: zone.icon })),
        labelFor: (id) => palette.find((zone) => zone.id === id)?.label ?? id,
        colorFor: (id) => palette.find((zone) => zone.id === id)?.color ?? 'var(--text-muted)',
        add: (id) => {
          const held = task.zones ?? []
          if (!held.includes(id)) task.zones = [...held, id]
        },
        remove: (id) => {
          const left = (task.zones ?? []).filter((zone) => zone !== id)
          task.zones = left.length ? left : undefined
        }
      })
      // A ticket that names none stands where its project stands, and should be able to
      // see that rather than read an empty field as "nowhere".
      const inherited = (project.zones ?? []).map((id) => palette.find((z) => z.id === id)?.label ?? id)
      if (!(task.zones ?? []).length && inherited.length) {
        cell.createSpan({ cls: 'pm-prop-hint', text: t('zone.inherited', { zones: inherited.join(', ') }) })
      }
      return cell
    },
    'map-pin'
  )
  zonesRow.addClass('pm-prop-row--wide')

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
    // Dropping a link drops how it scheduled with it, wherever the drop came from.
    const dropDependency = (id: string): void => {
      task.dependencies = task.dependencies.filter((d) => d !== id)
      const options = withoutDependency(task.dependencyOptions, id)
      task.dependencyOptions = Object.keys(options).length ? options : undefined
    }
    const depRow = renderPropRow(
      grid,
      t('task.dependsOn'),
      () => {
        const cell = createDiv('pm-prop-value')
        renderMultiSelect({
          container: cell,
          addLabel: t('task.addDependency'),
          addLabelMore: t('task.addAnother'),
          depsList: true,
          // A drop-down listing every ticket in the vault by title cannot be searched by
          // eye, so the choosing happens in a window that shows the plan's own shape.
          openPicker: (refresh) => {
            new DependencyPickerModal(plugin.app, {
              plugin,
              taskId: task.id,
              homeProject: project.filePath,
              selected: [...task.dependencies],
              onConfirm: (ids) => {
                for (const id of task.dependencies) if (!ids.includes(id)) dropDependency(id)
                for (const id of ids) if (!task.dependencies.includes(id)) task.dependencies.push(id)
                refresh()
              }
            }).open()
          },
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
          remove: dropDependency
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
  if (task.type !== 'meeting' && !task.startTime && !task.endTime && !shownExtras.has('hours')) {
    hidden.push({ id: 'hours', label: t('field.timeRange'), icon: 'clock' })
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
