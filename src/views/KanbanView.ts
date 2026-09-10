import { Menu } from 'obsidian'
import type PMPlugin from '../main'
import type { Task, TaskStatus, FilterState, ResolvedProjectConfig } from '../types'
import { personKeyer, type ProjectScope } from '../store'
import { flattenTasks, totalLoggedHours, type FlatTask } from '../store/TaskTreeOps'
import { matchesFilter } from '../store/TaskFilter'
import { displayName, dueUrgency, getPriorityConfig, safeAsync } from '../utils'
import { openTaskModal } from '../ui/ModalFactory'
import { buildTaskContextMenu } from '../ui/TaskContextMenu'
import { KanbanColumn, type KanbanCardData, type KanbanEntry } from '../ui/composites/KanbanColumn'
import { renderProjectChip } from '../ui/composites/projectChip'
import { linkedRefs } from './linkedRefs'
import { collectionBlocks, headingHandlers, phaseHeading, renderHeadingRow, type HeadingRow } from './headings'
import { isPhase } from '../store/Phase'
import type { SubView } from './SubView'

/** A run of cards under one heading, or the leading run that has none. */
interface CardBlock {
  heading: HeadingRow | null
  rows: Task[]
}

export class KanbanView implements SubView {
  private dragTask: Task | null = null
  /** Resolved once per board render. */
  private config!: ResolvedProjectConfig
  private personKey: (raw: string) => string = displayName

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState
  ) {}

  render(): void {
    this.renderBoard()
    if (this.config.kanbanShowDescriptionPreview) {
      void this.hydrateDescriptions()
    }
  }

  private renderBoard(): void {
    this.config = this.scope.config
    this.personKey = personKeyer(this.plugin.app)
    this.container.empty()
    this.container.addClass('pm-kanban-view')

    const board = this.container.createDiv('pm-kanban-board')

    for (const status of this.config.statuses) {
      const tasks = this.getTasksForStatus(status.id)
      new KanbanColumn(board, {
        status,
        entries: this.entriesFor(tasks),
        count: tasks.length,
        onCardClick: (task) => this.openTask(task),
        onCardContextMenu: (task, e) => this.openContextMenu(task, e),
        onCardDragStart: (task) => {
          this.dragTask = task
        },
        onCardDragEnd: () => {
          this.dragTask = null
        },
        onDrop: (taskId, newStatus) => this.handleDrop(taskId, newStatus)
      })
    }
  }

  /**
   * Which phase each task sits in, innermost first — a task inside a sub-lot belongs to
   * the sub-lot. Empty when the project declares no phase at all, which is the ordinary
   * case: a board carrying one heading over everything would only take up room.
   */
  private phaseOf(): Map<string, Task> {
    const owner = new Map<string, Task>()
    const walk = (tasks: Task[], phase: Task | null): void => {
      for (const task of tasks) {
        if (isPhase(task)) {
          walk(task.subtasks, task)
          continue
        }
        if (phase) owner.set(task.id, phase)
        walk(task.subtasks, phase)
      }
    }
    walk(this.scope.tasks(), null)
    return owner
  }

  /** The phases a project declares, in the order it declares them. */
  private phases(): FlatTask[] {
    return flattenTasks(this.scope.tasks()).filter((ft) => isPhase(ft.task))
  }

  /** A column's cards, split into the blocks the headings sit above. */
  private phaseBlocks(tasks: Task[]): CardBlock[] | null {
    const phases = this.phases()
    if (!phases.length) return null
    const owner = this.phaseOf()
    const byPhase = new Map<string, Task[]>()
    const loose: Task[] = []
    for (const task of tasks) {
      const phase = owner.get(task.id)
      if (!phase) {
        loose.push(task)
        continue
      }
      const bucket = byPhase.get(phase.id)
      if (bucket) bucket.push(task)
      else byPhase.set(phase.id, [task])
    }
    const blocks: CardBlock[] = []
    // Tasks in no lot lead, unheaded: they are not a lot called "everything else".
    if (loose.length) blocks.push({ heading: null, rows: loose })
    for (const { task: phase, depth } of phases) {
      const rows = byPhase.get(phase.id)
      // Counted per column, not over the whole lot: the heading appears once in each
      // column, and "lot 1 · 12 tasks" above two cards would be counting elsewhere.
      if (rows) {
        blocks.push({
          heading: { ...phaseHeading(phase, this.config.statuses, depth), count: rows.length },
          rows
        })
      }
    }
    return blocks
  }

  /**
   * A column's contents. In a collection the cards are stacked under a heading per
   * project, folded with the same state the table and the Gantt use — one collection,
   * one answer to "is this project folded". Anywhere else the cards stand alone.
   */
  private entriesFor(tasks: Task[]): KanbanEntry[] {
    const blocks: CardBlock[] | null =
      collectionBlocks(tasks, (task) => task.id, this.scope, this.plugin) ?? this.phaseBlocks(tasks)
    if (!blocks) return tasks.map((task) => ({ kind: 'card', card: this.buildCardData(task) }))
    const entries: KanbanEntry[] = []
    for (const { heading, rows } of blocks) {
      if (heading) {
        entries.push({
          kind: 'group',
          collapsed: heading.collapsed,
          depth: heading.depth ?? 0,
          render: (parent) =>
            renderHeadingRow(
              parent,
              heading,
              headingHandlers(heading, this.scope, this.plugin, () => this.render())
            )
        })
        if (heading.collapsed) continue
      }
      for (const task of rows) entries.push({ kind: 'card', card: this.buildCardData(task) })
    }
    return entries
  }

  /** Descriptions load lazily from the note body, so previews fill in on a second render. */
  private async hydrateDescriptions(): Promise<void> {
    const candidates = this.config.kanbanShowSubtasks
      ? flattenTasks(this.scope.tasks()).map((ft) => ft.task)
      : this.scope.tasks()
    const pending = candidates.filter(
      (t) => t.filePath && !t.description && matchesFilter(t, this.filter, this.config.statuses, this.personKey)
    )
    if (!pending.length) return
    await Promise.all(pending.map((t) => this.plugin.store.loadTaskBody(t)))
    if (pending.some((t) => t.description)) this.renderBoard()
  }

  private getTasksForStatus(status: TaskStatus): Task[] {
    const candidates = this.config.kanbanShowSubtasks
      ? flattenTasks(this.scope.tasks()).map((ft) => ft.task)
      : this.scope.tasks()
    // A phase is never a card: it holds cards, and says so as a heading in each column.
    return candidates.filter(
      (t) => !isPhase(t) && t.status === status && matchesFilter(t, this.filter, this.config.statuses, this.personKey)
    )
  }

  private buildCardData(task: Task): KanbanCardData {
    const priorityConfig = getPriorityConfig(this.config.priorities, task.priority)
    const priorityColor =
      priorityConfig && task.priority !== 'medium' && task.priority !== 'low' ? priorityConfig.color : undefined

    let descriptionPreview: string | undefined
    if (this.config.kanbanShowDescriptionPreview && task.description.trim()) {
      const text = task.description
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^[ \t]*[#>\-*+]+[ \t]+/gm, '')
        .replace(/[*~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      descriptionPreview = text ? text.slice(0, 240) : undefined
    }

    let parentTitle: string | undefined
    if (this.config.kanbanShowSubtasks && task.type === 'subtask') {
      const parent = this.findParentTask(task.id)
      if (parent) parentTitle = parent.title
    }

    const owner = this.scope.isMulti ? this.scope.projectOf(task.id) : null

    return {
      task,
      people: linkedRefs(this.plugin.app, task.assignees, task.filePath ?? ''),
      priorityColor,
      descriptionPreview,
      parentTitle,
      renderSource: owner
        ? (el) =>
            renderProjectChip(el, {
              title: owner.title,
              color: owner.color,
              onClick: safeAsync(() => this.plugin.router.openProjectLink(owner.filePath))
            })
        : undefined,
      loggedHours: totalLoggedHours(task),
      overdue: dueUrgency(task, this.config.statuses) === 'overdue',
      showTagColors: this.plugin.settings.showTagColors
    }
  }

  private findParentTask(taskId: string): Task | null {
    for (const ft of flattenTasks(this.scope.tasks())) {
      const parent = ft.task
      if (parent.subtasks.some((s) => s.id === taskId)) return parent
    }
    return null
  }

  private openTask(task: Task): void {
    const owner = this.scope.projectOf(task.id)
    if (!owner) return
    openTaskModal(this.plugin, owner, {
      task,
      onSave: async () => {
        await this.onRefresh()
      }
    })
  }

  private openContextMenu(task: Task, e: MouseEvent): void {
    const owner = this.scope.projectOf(task.id)
    if (!owner) return
    const menu = new Menu()
    buildTaskContextMenu(menu, task, {
      plugin: this.plugin,
      project: owner,
      ...(this.scope.spec.kind === 'collection' ? { collectionPath: this.scope.spec.path } : {}),
      onRefresh: this.onRefresh
    })
    menu.showAtMouseEvent(e)
  }

  private async handleDrop(taskId: string, newStatus: TaskStatus): Promise<void> {
    if (!this.dragTask || this.dragTask.id !== taskId) return
    if (newStatus === this.dragTask.status) return
    const owner = this.scope.projectOf(taskId)
    if (!owner) return
    await this.plugin.store.updateTask(owner, this.dragTask.id, { status: newStatus })
    await this.onRefresh()
  }
}
