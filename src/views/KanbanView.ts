import { Menu } from 'obsidian'
import type PMPlugin from '../main'
import type { Task, TaskStatus, FilterState, ResolvedProjectConfig } from '../types'
import { personKeyer, type ProjectScope } from '../store'
import { flattenTasks, totalLoggedHours, type FlatTask } from '../store/TaskTreeOps'
import { matchesFilter } from '../store/TaskFilter'
import { displayName, dueUrgency, getPriorityConfig, safeAsync } from '../utils'
import { openTaskModal } from '../ui/ModalFactory'
import { buildTaskContextMenu } from '../ui/TaskContextMenu'
import { KanbanColumn, renderColumnHeader, type KanbanCardData } from '../ui/composites/KanbanColumn'
import { renderProjectChip } from '../ui/composites/projectChip'
import { linkedRefs } from './linkedRefs'
import { collectionBlocks, headingHandlers, phaseHeading, renderHeadingRow, type HeadingRow } from './headings'
import { isPhase } from '../store/Phase'
import type { SubView } from './SubView'
import { t } from '../i18n'

/** A band across the board: one lot, one project in a collection, or what is in neither. */
interface Lane {
  /** A phase id, a project path, or '' for the lane of what belongs to no lot. */
  key: string
  heading: HeadingRow | null
  tasks: Task[]
}

export class KanbanView implements SubView {
  private dragTask: Task | null = null
  /** Resolved once per board render. */
  private config!: ResolvedProjectConfig
  private personKey: (raw: string) => string = displayName
  /** What the lanes stand for, which decides what dropping a card across them means. */
  private laneKind: 'phase' | 'project' | null = null

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
    const lanes = this.lanes()
    if (lanes) this.renderLanes(board, lanes)
    else this.renderColumns(board, this.visibleTasks(), true, null)
  }

  /** The ordinary board: one full-height column per status, each carrying its own header. */
  private renderColumns(parent: HTMLElement, tasks: Task[], header: boolean, laneKey: string | null): void {
    for (const status of this.config.statuses) {
      new KanbanColumn(parent, {
        status,
        cards: tasks.filter((task) => task.status === status.id).map((task) => this.buildCardData(task)),
        header,
        laneKey,
        onCardClick: (task) => this.openTask(task),
        onCardContextMenu: (task, e) => this.openContextMenu(task, e),
        onCardDragStart: (task) => {
          this.dragTask = task
        },
        onCardDragEnd: () => {
          this.dragTask = null
        },
        onDrop: (taskId, newStatus, lane) => this.handleDrop(taskId, newStatus, lane)
      })
    }
  }

  /**
   * A board split into swimlanes: the statuses named once across the top, then a band
   * per lot — or per project in a collection — holding that lot's cards in every column
   * at once. Everything about a lot is then on one line of the board, which a heading
   * repeated inside each column could never show.
   */
  private renderLanes(board: HTMLElement, lanes: Lane[]): void {
    board.addClass('pm-kanban-board--lanes')

    const headRow = board.createDiv('pm-kanban-headrow')
    for (const status of this.config.statuses) {
      const cell = headRow.createDiv('pm-kanban-headcell')
      renderColumnHeader(cell, status, this.visibleTasks().filter((task) => task.status === status.id).length)
    }

    for (const lane of lanes) {
      const laneEl = board.createDiv('pm-kanban-lane')
      const head = laneEl.createDiv('pm-kanban-lane-head')
      // Sticky inside its own band, so the name stays put as the board scrolls sideways.
      const headInner = head.createDiv('pm-kanban-lane-head-inner')
      if (lane.heading) {
        renderHeadingRow(
          headInner,
          lane.heading,
          headingHandlers(lane.heading, this.scope, this.plugin, () => this.render())
        )
      } else {
        headInner.createSpan({ cls: 'pm-group-title pm-kanban-lane-loose', text: t('view.noPhaseLane') })
      }
      if (lane.heading?.collapsed) {
        laneEl.addClass('is-collapsed')
        continue
      }
      this.renderColumns(laneEl.createDiv('pm-kanban-lane-cols'), lane.tasks, false, lane.key)
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

  /**
   * The lanes to draw, or null to leave the board as one plain row of columns — a
   * project with no lot has nothing to split, and a lane over everything would only
   * take up room.
   */
  private lanes(): Lane[] | null {
    const tasks = this.visibleTasks()
    const byProject = collectionBlocks(tasks, (task) => task.id, this.scope, this.plugin)
    if (byProject) {
      this.laneKind = 'project'
      return byProject.map(({ heading, rows }) => ({ key: heading.key, heading, tasks: rows }))
    }
    const phases = this.phases()
    if (!phases.length) return null
    this.laneKind = 'phase'

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

    const lanes: Lane[] = []
    // The lane for what is in no lot leads, and is a real drop target: dragging a card
    // into it is how a task leaves its lot.
    if (loose.length || byPhase.size) lanes.push({ key: '', heading: null, tasks: loose })
    for (const { task: phase, depth } of phases) {
      const rows = byPhase.get(phase.id) ?? []
      lanes.push({ key: phase.id, heading: phaseHeading(phase, this.config.statuses, depth), tasks: rows })
    }
    return lanes
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

  /** Every card the board will show, before it is split by status or by lane. */
  private visibleTasks(): Task[] {
    const candidates = this.config.kanbanShowSubtasks
      ? flattenTasks(this.scope.tasks()).map((ft) => ft.task)
      : this.scope.tasks()
    // A phase is never a card: it holds cards, and says so as the lane they sit in.
    return candidates.filter(
      (task) => !isPhase(task) && matchesFilter(task, this.filter, this.config.statuses, this.personKey)
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

  /**
   * A card dropped on a lane board answers two questions at once: the column it landed
   * in is its status, and the lane is the lot it belongs to. Both are applied, either
   * alone if only one of them changed.
   *
   * Only lots are moved this way. A collection's lanes are projects, and dragging a task
   * between them would move its note to another project's folder — too much to happen
   * from a drag, so there the lane is read as scenery and only the status changes.
   */
  private async handleDrop(taskId: string, newStatus: TaskStatus, laneKey: string | null): Promise<void> {
    if (!this.dragTask || this.dragTask.id !== taskId) return
    const task = this.dragTask
    const owner = this.scope.projectOf(taskId)
    if (!owner) return

    const movesLot = this.laneKind === 'phase' && laneKey !== null && laneKey !== (this.phaseOf().get(taskId)?.id ?? '')
    if (newStatus === task.status && !movesLot) return

    if (newStatus !== task.status) await this.plugin.store.updateTask(owner, task.id, { status: newStatus })
    if (movesLot) await this.plugin.store.moveTask(owner, task.id, laneKey || null)
    await this.onRefresh()
  }
}
