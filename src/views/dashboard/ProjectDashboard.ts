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
import { displayName, makeActivatable, safeAsync } from '../../utils'
import { openProjectCreate, openTaskModal } from '../../ui/ModalFactory'
import { Chip } from '../../ui/primitives/Chip'
import { ChipButton } from '../../ui/primitives/ChipButton'
import { docStateLabel } from '../library/docStateLabel'
import { RISK_LEVELS, riskBand, type RiskBand } from '../../store/risk'
import { BAND_COLOR, bandLabel, impactLabel, probabilityLabel } from '../risks/riskLabels'
import { focusRiskCell } from '../risks/RisksView'
import { openChase } from '../chase/ChaseModal'
import type { SubView } from '../SubView'
import { barList, burnChart, progressRing } from './charts'
import { writeStatusReport, writeStatusReportPdf } from './statusReport'
import { SUBVIEW_CLASS } from '../subviewClasses'
import { t } from '../../i18n'
import { explain } from '../../ui/explain'

/** Where a click on a figure takes the reader, and what it narrows the views to. */
export type DrillHandler = (patch: Partial<FilterState>, view: ViewMode) => void

const HEALTH_ICON = { 'on-track': 'circle-check', 'at-risk': 'triangle-alert', late: 'circle-alert' } as const

/** The risks named on the card, the worst first; the register holds the rest. */
const RISKS_SHOWN = 5

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
    this.container.addClass(SUBVIEW_CLASS.dashboard)
    const config = this.scope.config
    const tasks = this.visibleTasks()
    this.metrics = projectMetrics({
      tasks,
      statuses: config.statuses,
      priorities: config.priorities,
      today: today().toString(),
      keyOf: personKeyer(this.plugin.app),
      // Every open risk, for the status report; the card names the first few.
      topRisks: Number.MAX_SAFE_INTEGER
    })

    const page = this.container.createDiv('pm-kpi-page')
    this.renderHeader(page, this.metrics)
    this.renderHero(page, this.metrics)
    const grid = page.createDiv('pm-kpi-grid')
    this.renderProjects(grid)
    this.renderBurn(grid, this.metrics)
    this.renderRisks(grid, this.metrics)
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
      .explain(t('kpi.report'), t('tip.kpi.report'))
    new ChipButton(bar.querySelector<HTMLElement>('.pm-kpi-header-actions') ?? bar)
      .setLabel(t('report.pdf'))
      .setShape('pill')
      .onClick(
        safeAsync(async () => {
          if (!this.metrics) return
          const path = await writeStatusReportPdf(this.plugin, this.scope, this.metrics)
          new Notice(t('report.pdfWritten', { path }))
        })
      )
      .explain(t('report.pdf'), t('tip.report.pdf'))
  }

  private healthWhy(m: ProjectMetrics): string {
    if (m.health.late) return t('kpi.whyLate', { count: m.health.late })
    if (m.health.overrunningPhases) return t('kpi.whyOverrun', { count: m.health.overrunningPhases })
    if (m.health.lateDocs) return t('kpi.whyDocs', { count: m.health.lateDocs })
    if (m.health.criticalRisks) return t('kpi.whyRisks', { count: m.health.criticalRisks })
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
    if (m.risks.open + m.risks.closed) {
      this.tile(tiles, t('kpi.risks'), m.risks.open, 'shield-alert', m.risks.byBand.critical ? 'bad' : 'plain', () =>
        this.drill(makeDefaultFilter(), 'risks')
      )
    }
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
    explain(tile, label, tileHelp(icon))
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
          .explain(t('program.addProject'), t('tip.program.addProject'))
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
      makeActivatable(
        row,
        safeAsync(() => this.plugin.router.openProjectLink(project.filePath))
      )
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

  /**
   * The open risks at a glance: the matrix, small, whose cells open the register narrowed
   * to them, and beside it the worst risks by name — who answers for each, and whether
   * anything counters it yet. Absent from a project that has never recorded a risk.
   */
  private renderRisks(parent: HTMLElement, m: ProjectMetrics): void {
    const risks = m.risks
    if (!risks.open && !risks.closed) return
    const body = this.card(parent, t('kpi.risksTitle'), true)
    const openRegister = (): void => this.drill(makeDefaultFilter(), 'risks')
    if (!risks.open) {
      body.createDiv({ cls: 'pm-kpi-empty', text: t('kpi.risksNoneOpen', { count: risks.closed }) })
      new ChipButton(body.createDiv('pm-kpi-chips'))
        .setLabel(t('kpi.risksOpen'))
        .setShape('pill')
        .onClick(openRegister)
        .explain(t('kpi.risksOpen'), t('tip.kpi.risksOpen'))
      return
    }
    const layout = body.createDiv('pm-kpi-risks')
    const matrix = layout.createDiv('pm-kpi-riskmatrix')
    const grid = matrix.createDiv('pm-kpi-riskgrid')
    for (const probability of [...RISK_LEVELS].reverse()) {
      grid.createDiv({
        cls: 'pm-kpi-risklevel',
        text: String(probability),
        attr: { title: probabilityLabel(probability) }
      })
      for (const impact of RISK_LEVELS) {
        const count = risks.matrix[probability - 1][impact - 1]
        const band = riskBand(probability * impact)
        const cell = grid.createDiv({
          cls: `pm-kpi-riskcell${count ? '' : ' is-empty'}`,
          text: count ? String(count) : '',
          attr: { title: `${probabilityLabel(probability)} × ${impactLabel(impact)} · ${bandLabel(band)}` }
        })
        cell.style.setProperty('--pm-risk-color', BAND_COLOR[band])
        if (count) {
          explain(
            cell,
            `${probabilityLabel(probability)} × ${impactLabel(impact)} · ${bandLabel(band)}`,
            t('tip.kpi.riskCell')
          )
          makeActivatable(cell, () => {
            focusRiskCell({ probability, impact })
            openRegister()
          })
        }
      }
    }
    grid.createDiv()
    for (const impact of RISK_LEVELS) {
      grid.createDiv({ cls: 'pm-kpi-risklevel', text: String(impact), attr: { title: impactLabel(impact) } })
    }
    matrix.createDiv({ cls: 'pm-kpi-riskaxes', text: `${t('risk.probability')} ↑ · ${t('risk.impact')} →` })

    const side = layout.createDiv('pm-kpi-riskside')
    const bands = side.createDiv('pm-kpi-chips')
    for (const band of ['critical', 'high', 'medium', 'low'] as RiskBand[]) {
      const chip = bands.createSpan({ cls: 'pm-risk-badge', text: `${risks.byBand[band]} · ${bandLabel(band)}` })
      chip.style.setProperty('--pm-risk-color', BAND_COLOR[band])
      chip.toggleClass('is-zero', risks.byBand[band] === 0)
    }
    const list = side.createDiv('pm-kpi-risklist')
    for (const risk of risks.top.slice(0, RISKS_SHOWN)) {
      const row = list.createDiv('pm-kpi-risk')
      makeActivatable(row, () => this.openTask(risk.id))
      explain(row, risk.title, t('tip.kpi.riskRow'))
      const score = row.createSpan({ cls: 'pm-kpi-risk-score', text: String(risk.score) })
      score.style.setProperty('--pm-risk-color', BAND_COLOR[risk.band])
      score.setAttr('title', bandLabel(risk.band))
      row.createSpan({ cls: 'pm-kpi-risk-title', text: risk.title })
      if (!risk.mitigation) {
        setIcon(row.createSpan({ cls: 'pm-kpi-risk-warn', attr: { title: t('risk.noMitigation') } }), 'shield-off')
      }
      row.createSpan({
        cls: 'pm-kpi-risk-owner',
        text: risk.assignees.length ? risk.assignees.map(displayName).join(', ') : t('kpi.unassigned')
      })
    }
    if (risks.open > RISKS_SHOWN) {
      list.createDiv({ cls: 'pm-kpi-note', text: t('kpi.risksMore', { count: risks.open - RISKS_SHOWN }) })
    }
    const foot = side.createDiv('pm-kpi-chips')
    if (risks.unmitigated) {
      new Chip(foot)
        .setLabel(t('kpi.risksUnmitigated', { count: risks.unmitigated }))
        .setLeadingIcon('shield-off')
        .setVariant('solid')
        .setColor('var(--color-orange, #b8a06b)')
    }
    if (risks.reviewLate) {
      new Chip(foot)
        .setLabel(t('kpi.risksReviewLate', { count: risks.reviewLate }))
        .setLeadingIcon('alarm-clock')
        .setVariant('solid')
        .setColor('var(--text-error, var(--color-red))')
    }
    new ChipButton(foot)
      .setLabel(t('kpi.risksOpen'))
      .setShape('pill')
      .onClick(openRegister)
      .explain(t('kpi.risksOpen'), t('tip.kpi.risksOpen'))
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
      const chips = body.createDiv('pm-kpi-chips')
      new Chip(chips)
        .setLabel(t('kpi.lateDocs', { count: m.documents.late }))
        .setLeadingIcon('alarm-clock')
        .setVariant('solid')
        .setColor('var(--text-error, var(--color-red))')
      new ChipButton(chips)
        .setLabel(t('chase.button'))
        .setShape('pill')
        .onClick(() => openChase(this.plugin, this.scope.projects, this.onRefresh))
        .explain(t('chase.button'), t('tip.chase.button'))
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

/** What a tile counts, and where a click on it leads; by the icon it wears. */
function tileHelp(icon: string): string {
  switch (icon) {
    case 'alarm-clock':
      return t('tip.kpi.late')
    case 'calendar-clock':
      return t('tip.kpi.dueSoon')
    case 'circle-dashed':
      return t('tip.kpi.open')
    case 'calendar-off':
      return t('tip.kpi.undated')
    case 'file-clock':
      return t('tip.kpi.awaitedDocs')
    case 'shield-alert':
      return t('tip.kpi.risks')
    case 'clock':
      return t('tip.kpi.hours')
    default:
      return ''
  }
}

/** The state's own name when the lifecycle knows it, its raw id when it does not. */
function docStateName(id: string): string {
  const state = DOC_STATES.find((known) => known === id)
  return state ? docStateLabel(state) : id
}
