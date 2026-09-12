import { Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { FilterState, Task, ViewMode } from '../../types'
import { DOC_STATES, makeDefaultFilter } from '../../types'
import { personKeyer, type ProjectScope } from '../../store'
import { flattenTasks } from '../../store/TaskTreeOps'
import { matchesFilter } from '../../store/TaskFilter'
import { projectMetrics, type MetricSlice, type ProjectMetrics } from '../../store/Metrics'
import { isPhase } from '../../store/Phase'
import { findTaskById } from '../../store/TaskIndex'
import { today, formatDateShort } from '../../dates'
import { makeActivatable, safeAsync } from '../../utils'
import { openProjectCreate, openTaskModal } from '../../ui/ModalFactory'
import { Chip } from '../../ui/primitives/Chip'
import { ChipButton } from '../../ui/primitives/ChipButton'
import { docStateLabel } from '../library/docStateLabel'
import type { SubView } from '../SubView'
import { barList, burnChart, progressRing } from './charts'
import { writeStatusReport } from './statusReport'
import { t } from '../../i18n'

/** Where a click on a figure takes the reader, and what it narrows the views to. */
export type DrillHandler = (patch: Partial<FilterState>, view: ViewMode) => void

const HEALTH_ICON = { 'on-track': 'circle-check', 'at-risk': 'triangle-alert', late: 'circle-alert' } as const

/**
 * The project at a glance: where it stands, what is late, and what it adds up to.
 *
 * It computes nothing of its own — every figure comes from `projectMetrics`, which is
 * tested on its own — so this file is only ever about what is shown and in what order.
 * The figures are clickable where a figure raises a question the other views answer:
 * "eleven late" is not a number to look at, it is a list to open.
 */
export class ProjectDashboard implements SubView {
  private metrics: ProjectMetrics | null = null
  private observer: ResizeObserver | null = null
  private plotWidth = 0

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState,
    private drill: DrillHandler
  ) {}

  render(): void {
    this.container.empty()
    this.container.addClass('pm-kpi-view')
    const config = this.scope.config
    const tasks = this.visibleTasks()
    this.metrics = projectMetrics({
      tasks,
      statuses: config.statuses,
      priorities: config.priorities,
      today: today().toString(),
      keyOf: personKeyer(this.plugin.app)
    })

    const page = this.container.createDiv('pm-kpi-page')
    this.renderHeader(page, this.metrics)
    this.renderHero(page, this.metrics)
    const grid = page.createDiv('pm-kpi-grid')
    this.renderProjects(grid)
    this.renderBurn(grid, this.metrics)
    this.renderStatuses(grid, this.metrics)
    this.renderPhases(grid, this.metrics)
    this.renderPeople(grid, this.metrics)
    this.renderMilestones(grid, this.metrics)
    this.renderDocuments(grid, this.metrics)
  }

  refresh(): void {
    this.render()
  }

  destroy(): void {
    this.observer?.disconnect()
    this.observer = null
  }

  /** Every ticket the filter lets through, lots included — the metrics sort them out. */
  private visibleTasks(): Task[] {
    const config = this.scope.config
    const keyOf = personKeyer(this.plugin.app)
    return flattenTasks(this.scope.tasks())
      .map((flat) => flat.task)
      .filter((task) => isPhase(task) || matchesFilter(task, this.filter, config.statuses, keyOf))
  }

  /**
   * The one line to read first: is this project on time, and if not, on what.
   *
   * State is never colour alone — an icon and the words carry it, and the colour only
   * agrees with them.
   */
  private renderHeader(parent: HTMLElement, m: ProjectMetrics): void {
    const bar = parent.createDiv('pm-kpi-header')
    const title = bar.createDiv('pm-kpi-header-title')
    title.createSpan({ cls: 'pm-kpi-scopename', text: this.scope.primary?.title ?? t('view.library') })
    const span = m.span.start
      ? `${formatDateShort(m.span.start)} → ${formatDateShort(m.span.due || m.span.start)}`
      : t('kpi.noDates')
    title.createSpan({ cls: 'pm-kpi-window', text: span })

    const state = bar.createDiv(`pm-kpi-health pm-kpi-health--${m.health.level}`)
    setIcon(state.createSpan({ cls: 'pm-kpi-health-icon' }), HEALTH_ICON[m.health.level])
    state.createSpan({ cls: 'pm-kpi-health-text', text: t(`kpi.health.${m.health.level}`) })
    state.createSpan({ cls: 'pm-kpi-health-why', text: this.healthWhy(m) })

    new ChipButton(bar.createDiv('pm-kpi-header-actions'))
      .setLabel(t('kpi.report'))
      .setShape('pill')
      .onClick(
        safeAsync(async () => {
          const project = this.scope.primary
          if (!project || !this.metrics) return
          const path = await writeStatusReport(this.plugin, project, this.metrics)
          new Notice(t('kpi.reportWritten', { path }))
        })
      )
  }

  private healthWhy(m: ProjectMetrics): string {
    if (m.health.late) return t('kpi.whyLate', { count: m.health.late })
    if (m.health.overrunningPhases) return t('kpi.whyOverrun', { count: m.health.overrunningPhases })
    if (m.health.lateDocs) return t('kpi.whyDocs', { count: m.health.lateDocs })
    return t('kpi.whyFine', { count: m.open })
  }

  /** The advancement, then the handful of numbers a weekly review actually asks for. */
  private renderHero(parent: HTMLElement, m: ProjectMetrics): void {
    const hero = parent.createDiv('pm-kpi-hero')
    const meter = hero.createDiv('pm-kpi-meter')
    progressRing(meter, m.progress, t('common.progress'))
    meter.createDiv({ cls: 'pm-kpi-meter-caption', text: t('kpi.doneOf', { done: m.done, total: m.total }) })

    const tiles = hero.createDiv('pm-kpi-tiles')
    this.tile(tiles, t('kpi.late'), m.late, 'alarm-clock', m.late ? 'bad' : 'plain', () =>
      this.drill({ ...makeDefaultFilter(), dueDateFilter: 'overdue' }, 'table')
    )
    this.tile(tiles, t('kpi.dueSoon'), m.dueSoon, 'calendar-clock', 'plain', () =>
      this.drill({ ...makeDefaultFilter(), dueDateFilter: 'this-week' }, 'table')
    )
    this.tile(tiles, t('kpi.open'), m.open, 'circle-dashed', 'plain', () => this.drill(makeDefaultFilter(), 'table'))
    this.tile(tiles, t('kpi.undated'), m.undated, 'calendar-off', 'plain', () =>
      this.drill({ ...makeDefaultFilter(), dueDateFilter: 'no-date' }, 'table')
    )
    this.tile(tiles, t('kpi.awaitedDocs'), m.documents.awaited, 'file-clock', m.documents.late ? 'bad' : 'plain', () =>
      this.drill(makeDefaultFilter(), 'library')
    )
    this.tile(tiles, t('kpi.hours'), m.time.logged, 'clock', 'plain')
  }

  private tile(
    parent: HTMLElement,
    label: string,
    value: number,
    icon: string,
    tone: 'plain' | 'bad',
    onClick?: () => void
  ): void {
    const tile = parent.createDiv(`pm-kpi-tile pm-kpi-tile--${tone}`)
    if (onClick) {
      tile.addClass('pm-kpi-tile--link')
      tile.setAttr('role', 'button')
      tile.setAttr('tabindex', '0')
      tile.addEventListener('click', onClick)
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      })
    }
    const head = tile.createDiv('pm-kpi-tile-head')
    setIcon(head.createSpan({ cls: 'pm-kpi-tile-icon' }), icon)
    head.createSpan({ cls: 'pm-kpi-tile-label', text: label })
    tile.createDiv({ cls: 'pm-kpi-tile-value', text: String(value) })
  }

  private card(parent: HTMLElement, title: string, wide = false): HTMLElement {
    const card = parent.createDiv(`pm-kpi-card${wide ? ' pm-kpi-card--wide' : ''}`)
    card.createDiv({ cls: 'pm-kpi-card-title', text: title })
    return card.createDiv('pm-kpi-card-body')
  }

  /**
   * The curve, drawn at the width it will occupy and redrawn when that width changes.
   *
   * A chart stretched to fit its card is a chart whose round dots are ellipses and whose
   * dates are wide type, so the plot is built in real pixels instead — which means the
   * pane being resized is a reason to draw it again.
   */
  private renderBurn(parent: HTMLElement, m: ProjectMetrics): void {
    const body = this.card(parent, t('kpi.burnTitle'), true)
    const plot = body.createDiv('pm-kpi-plot')
    const draw = (width: number): void => {
      plot.empty()
      burnChart(plot, { points: m.burn.points, undatedDone: m.burn.undatedDone, width })
    }
    draw(plot.clientWidth || 640)
    this.observer?.disconnect()
    this.observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0)
      if (width && Math.abs(width - this.plotWidth) > 8) {
        this.plotWidth = width
        draw(width)
      }
    })
    this.observer.observe(plot)
    if (m.burn.unplanned) {
      body.createDiv({ cls: 'pm-kpi-note', text: t('kpi.unplanned', { count: m.burn.unplanned }) })
    }
  }

  /**
   * One line per project, when the view covers more than one — a programme above all,
   * but a folder or the whole vault read the same way.
   *
   * The figures are each project's own, computed by the same function that computed the
   * total above: a programme's dashboard is its projects' dashboards added up, and this
   * card is where they come back apart. A line says where that project stands and opens
   * it, because the answer to "which one is late" is that project's own page.
   */
  private renderProjects(parent: HTMLElement): void {
    const projects = this.scope.projects.filter((project) => !project.program)
    if (this.scope.isProgram && !projects.length) {
      const empty = this.card(parent, t('program.projects'), true)
      empty.createDiv({ cls: 'pm-kpi-empty', text: t('program.noProjects') })
      empty.createDiv({ cls: 'pm-kpi-note', text: t('program.holdsNoTasks') })
      const host = this.scope.primary
      if (host) {
        new ChipButton(empty.createDiv('pm-kpi-chips'))
          .setLabel(t('program.addProject'))
          .setShape('pill')
          .onClick(() => openProjectCreate(this.plugin, false, host.filePath))
      }
      return
    }
    if (projects.length < 2) return
    const body = this.card(parent, this.scope.isProgram ? t('program.projects') : t('kpi.projects'), true)
    const at = today().toString()
    const keyOf = personKeyer(this.plugin.app)
    const rows = projects.map((project) => {
      const config = this.plugin.store.configFor(project)
      const tasks = flattenTasks(project.tasks)
        .map((flat) => flat.task)
        .filter((task) => isPhase(task) || matchesFilter(task, this.filter, config.statuses, keyOf))
      return {
        project,
        m: projectMetrics({ tasks, statuses: config.statuses, priorities: config.priorities, today: at, keyOf })
      }
    })

    const list = body.createDiv('pm-kpi-projects')
    for (const { project, m } of rows) {
      const row = list.createDiv(`pm-kpi-project pm-kpi-project--${m.health.level}`)
      makeActivatable(row, () => void this.plugin.router.openProjectLink(project.filePath))
      const head = row.createDiv('pm-kpi-project-head')
      setIcon(head.createSpan({ cls: 'pm-kpi-project-state' }), HEALTH_ICON[m.health.level])
      head.createSpan({ cls: 'pm-kpi-project-title', text: project.title })
      head.createSpan({ cls: 'pm-kpi-project-count', text: t('kpi.doneOf', { done: m.done, total: m.total }) })
      if (m.late) head.createSpan({ cls: 'pm-kpi-project-late', text: t('kpi.lateCount', { count: m.late }) })
      head.createSpan({ cls: 'pm-kpi-project-value', text: `${m.progress} %` })
      const track = row.createDiv('pm-kpi-bar-track')
      track.createDiv('pm-kpi-bar-fill').setCssProps({ '--pm-kpi-share': `${m.progress}%` })
    }
  }

  private renderStatuses(parent: HTMLElement, m: ProjectMetrics): void {
    const body = this.card(parent, t('kpi.breakdown'))
    this.sliceBars(body, m.byStatus, m.total, (slice) =>
      this.drill({ ...makeDefaultFilter(), statuses: [slice.id] }, 'table')
    )
    if (m.byPriority.length) {
      body.createDiv({ cls: 'pm-kpi-subtitle', text: t('common.priority') })
      this.sliceBars(body, m.byPriority, m.total, (slice) =>
        this.drill({ ...makeDefaultFilter(), priorities: [slice.id] }, 'table')
      )
    }
  }

  private sliceBars(parent: HTMLElement, slices: MetricSlice[], total: number, onPick: (s: MetricSlice) => void): void {
    if (!slices.length) {
      parent.createDiv({ cls: 'pm-kpi-empty', text: t('kpi.nothing') })
      return
    }
    barList(
      parent,
      slices.map((slice) => ({
        label: slice.label,
        value: String(slice.count),
        share: total ? (slice.count / total) * 100 : 0,
        color: slice.color,
        onClick: () => onPick(slice)
      }))
    )
  }

  private renderPhases(parent: HTMLElement, m: ProjectMetrics): void {
    if (!m.phases.length) return
    const body = this.card(parent, t('kpi.phases'))
    barList(
      body,
      m.phases.map((phase) => ({
        label: phase.title,
        value: `${phase.progress} %`,
        share: phase.progress,
        detail: phase.overruns ? t('kpi.overruns') : phase.due ? formatDateShort(phase.due) : '',
        onClick: () => this.openTask(phase.id)
      }))
    )
    const late = m.phases.filter((phase) => phase.overruns).length
    if (late) body.createDiv({ cls: 'pm-kpi-note', text: t('kpi.overrunCount', { count: late }) })
  }

  private renderPeople(parent: HTMLElement, m: ProjectMetrics): void {
    if (!m.byAssignee.length) return
    const body = this.card(parent, t('kpi.workload'))
    const busiest = Math.max(...m.byAssignee.map((row) => row.total), 1)
    barList(
      body,
      m.byAssignee.map((row) => ({
        label: row.name || t('kpi.unassigned'),
        value: String(row.total),
        share: (row.total / busiest) * 100,
        detail: row.late ? t('kpi.lateCount', { count: row.late }) : t('kpi.doneCount', { count: row.done }),
        onClick: row.name ? () => this.drill({ ...makeDefaultFilter(), assignees: [row.name] }, 'table') : undefined
      }))
    )
  }

  private renderMilestones(parent: HTMLElement, m: ProjectMetrics): void {
    if (!m.milestones.length) return
    const body = this.card(parent, t('kpi.milestones'))
    const list = body.createDiv('pm-kpi-milestones')
    for (const milestone of m.milestones) {
      const row = list.createDiv(`pm-kpi-milestone pm-kpi-milestone--${milestone.state}`)
      row.setAttr('role', 'button')
      row.setAttr('tabindex', '0')
      const open = (): void => this.openTask(milestone.id)
      row.addEventListener('click', open)
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      })
      setIcon(row.createSpan({ cls: 'pm-kpi-milestone-icon' }), milestone.state === 'done' ? 'check' : 'diamond')
      row.createSpan({ cls: 'pm-kpi-milestone-title', text: milestone.title })
      row.createSpan({
        cls: 'pm-kpi-milestone-date',
        text: milestone.date ? formatDateShort(milestone.date) : t('kpi.noDate')
      })
      row.createSpan({ cls: 'pm-kpi-milestone-state', text: t(`kpi.milestone.${milestone.state}`) })
    }
  }

  private renderDocuments(parent: HTMLElement, m: ProjectMetrics): void {
    if (!m.documents.total) return
    const body = this.card(parent, t('view.library'))
    barList(
      body,
      m.documents.byState.map((slice) => ({
        // Narrowed rather than cast: the metrics hand back the state's id as a string,
        // and only a value the lifecycle still knows gets its localized name.
        label: docStateName(slice.id),
        value: String(slice.count),
        share: (slice.count / m.documents.total) * 100,
        color: slice.color,
        onClick: () => this.drill(makeDefaultFilter(), 'library')
      }))
    )
    if (m.documents.late) {
      new Chip(body.createDiv('pm-kpi-chips'))
        .setLabel(t('kpi.lateDocs', { count: m.documents.late }))
        .setLeadingIcon('alarm-clock')
        .setVariant('solid')
        .setColor('var(--text-error, var(--color-red))')
    }
  }

  private openTask(taskId: string): void {
    const project = this.scope.projectOf(taskId)
    if (!project) return
    const task = findTaskById(project, taskId)
    if (!task) return
    openTaskModal(this.plugin, project, { task, onSave: () => this.onRefresh() })
  }
}

/** The state's own name when the lifecycle knows it, its raw id when it does not. */
function docStateName(id: string): string {
  const state = DOC_STATES.find((known) => known === id)
  return state ? docStateLabel(state) : id
}
