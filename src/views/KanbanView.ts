import { Menu } from 'obsidian'
import type PMPlugin from '../main'
import type { Task, TaskStatus, FilterState, ResolvedProjectConfig } from '../types'
import { personKeyer, type ProjectScope } from '../store'
import { flattenTasks, totalLoggedHours } from '../store/TaskTreeOps'
import { matchesFilter } from '../store/TaskFilter'
import { displayName, dueUrgency, getPriorityConfig, safeAsync } from '../utils'
import { openTaskModal } from '../ui/ModalFactory'
import { buildTaskContextMenu } from '../ui/TaskContextMenu'
import { KanbanColumn, type KanbanCardData, type KanbanEntry } from '../ui/composites/KanbanColumn'
import { renderProjectChip } from '../ui/composites/projectChip'
import { linkedRefs } from './linkedRefs'
import { collectionBlocks, renderProjectHeading, toggleProjectHeading } from './projectGroups'
import type { SubView } from './SubView'

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
   * A column's contents. In a collection the cards are stacked under a heading per
   * project, folded with the same state the table and the Gantt use — one collection,
   * one answer to "is this project folded". Anywhere else the cards stand alone.
   */
  private entriesFor(tasks: Task[]): KanbanEntry[] {
    const blocks = collectionBlocks(tasks, (task) => task.id, this.scope, this.plugin)
    if (!blocks) return tasks.map((task) => ({ kind: 'card', card: this.buildCardData(task) }))
    const entries: KanbanEntry[] = []
    for (const { heading, rows } of blocks) {
      entries.push({
        kind: 'group',
        collapsed: heading.collapsed,
        render: (parent) =>
          renderProjectHeading(parent, heading, {
            onToggle: async () => {
              await toggleProjectHeading(heading, this.scope, this.plugin)
              this.render()
            },
            onOpen: () => this.plugin.router.openProjectLink(heading.projectPath)
          })
      })
      if (heading.collapsed) continue
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
    return candidates.filter(
      (t) => t.status === status && matchesFilter(t, this.filter, this.config.statuses, this.personKey)
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
