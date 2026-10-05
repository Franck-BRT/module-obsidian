import { ButtonComponent, Menu, Notice, type Scope } from 'obsidian'
import type PMPlugin from '../../main'
import type { Task, GanttGranularity, FilterState, Project } from '../../types'
import { personKeyer, type ProjectScope } from '../../store'
import { type FlatTask, flattenTasks } from '../../store/TaskTreeOps'
import { applyTaskFilterPromote } from '../../store/TaskFilter'
import { renderAddTicketButton } from '../../ui/composites/addTicketButton'
import { SegmentedControl } from '../../ui/primitives/SegmentedControl'
import type { SubView } from '../SubView'
import type { TimelineCfg } from './TimelineConfig'
import { buildTimelineConfig, dateToX, xToDate, HEADER_HEIGHT, ROW_HEIGHT, LABEL_WIDTH } from './TimelineConfig'
import { relativePlan } from '../../store/RelativePlan'
import { criticalPath, type CriticalPath } from '../../store/criticalPath'
import { projectOntoDays, realTasksById, relativeTimelineConfig, relativeWeek, RELATIVE_ANCHOR } from './relativeChart'
import { makeDragState } from './GanttDragHandler'
import type { DragState } from './GanttDragHandler'
import { makeLinkState, cancelLink } from './GanttLinkHandler'
import type { LinkState } from './GanttLinkHandler'
import {
  renderTimelineHeader,
  renderGridLines,
  renderTodayLine,
  renderTaskBar,
  renderDependencyArrows,
  renderMilestoneLabels
} from './GanttRenderer'
import { safeAsync, svgEl } from '../../utils'
import { formatDate, Temporal, today } from '../../dates'
import type { RendererContext } from './GanttRenderer'
import { renderTaskLabel } from './TaskLabelRenderer'
import { attachRowDragDrop } from './rowDragDrop'
import { collectionBlocks, headingHandlers, phaseHeading, renderHeadingRow, type HeadingRow } from '../headings'
import { TASK_SORT_KEYS, orderTasks, sortKeyLabel, type SortOrder } from '../sortOrder'
import { renderSortControl } from '../SortControl'
import { isPhase, phaseSpan } from '../../store/Phase'
import { phaseBracket } from './GanttPhaseBar'
import { SUBVIEW_CLASS } from '../subviewClasses'
import { t } from '../../i18n'
import { confirmDialog } from '../../ui/ModalFactory'
import { explain } from '../../ui/explain'

/**
 * One line of the chart. A project heading occupies a row of its own so the label
 * column and the bars stay on the same grid — the two are drawn from this one list.
 */
type GanttRow =
  | { kind: 'task'; task: Task; depth: number }
  | { kind: 'group'; heading: HeadingRow }
  | { kind: 'phase'; task: Task; heading: HeadingRow; depth: number }

export class GanttView implements SubView {
  private granularity: GanttGranularity
  private scrollEl!: HTMLElement
  private svgEl!: SVGSVGElement
  private headerSvgEl!: SVGSVGElement
  private flatTasks: FlatTask[] = []
  private rows: GanttRow[] = []
  private cfg!: TimelineCfg
  private drag: DragState = makeDragState()
  private link: LinkState = makeLinkState()
  private labelWidth: number = LABEL_WIDTH

  getLabelWidth(): number {
    return this.labelWidth
  }
  setLabelWidth(w: number): void {
    this.labelWidth = w
  }
  private cleanupFns: (() => void)[] = []
  private relative: RendererContext['relative'] = null
  private critical: CriticalPath | null = null
  private pendingScroll: { top: number; anchorDate: Temporal.PlainDate } | null = null

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState,
    private keyScope: Scope
  ) {
    this.granularity = plugin.settings.ganttGranularity
  }

  destroy(): void {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
  }

  getScrollPosition(): { top: number; anchorDate: Temporal.PlainDate } {
    const top = this.scrollEl?.scrollTop ?? 0
    const anchorDate = this.scrollEl ? xToDate(this.cfg, this.scrollEl.scrollLeft) : today()
    return { top, anchorDate }
  }

  setPendingScroll(pos: { top: number; anchorDate: Temporal.PlainDate }): void {
    this.pendingScroll = pos
  }

  refresh(): void {
    this.pendingScroll = this.getScrollPosition()
    this.render()
  }

  render(): void {
    this.cleanupFns.forEach((fn) => fn())
    this.cleanupFns = []
    cancelLink(this.link)
    this.container.empty()
    this.container.addClass(SUBVIEW_CLASS.gantt)

    const activeTasks = this.getVisibleTasks()
    // A template is written before anyone knows when the project will run, so its chart
    // is laid out from the links instead: the plan they imply, projected onto days from
    // an anchor the reader never sees, with the real tickets kept beside it for editing.
    const calendar = this.scope.config.workCalendar
    const plan = this.scope.primary?.template ? relativePlan(activeTasks, calendar) : null
    this.relative = plan ? { realById: realTasksById(activeTasks), plan, week: relativeWeek(calendar) } : null
    const charted = plan ? projectOntoDays(activeTasks, plan, RELATIVE_ANCHOR) : activeTasks
    this.flatTasks = flattenTasks(charted).filter((f) => f.visible || f.depth === 0)
    // Read off the whole plan, not what the filter leaves: a hidden ticket still holds the next up.
    this.critical = this.plugin.settings.ganttCritical ? this.criticalOf(plan ? charted : this.scope.tasks()) : null
    this.rows = this.buildRows(charted)
    // The ordinary axis reaches from today to the work and back; a template's counts
    // from its own day one, so it gets one built from the plan instead.
    this.cfg = plan
      ? relativeTimelineConfig(plan, this.chartGranularity(), calendar)
      : buildTimelineConfig(charted, this.granularity)

    this.renderGranularityControls()
    this.renderGantt()
  }

  /**
   * How wide a day is drawn. A template's axis only offers the two closest levels: with
   * no dates to reach, a plan is weeks long, and a month to the inch would leave it a
   * sliver — so a setting left on `year` by a project is read as the nearest one it has.
   */
  private chartGranularity(): GanttGranularity {
    if (!this.relative) return this.granularity
    return this.granularity === 'day' ? 'day' : 'week'
  }

  private renderGranularityControls(): void {
    const bar = this.container.createDiv('pm-gantt-controls')
    const levels: GanttGranularity[] = this.relative ? ['day', 'week'] : ['day', 'week', 'month', 'quarter', 'year']
    const labels: Record<GanttGranularity, string> = {
      day: t('settings.granularity.day'),
      week: t('settings.granularity.week'),
      month: t('settings.granularity.month'),
      quarter: t('settings.granularity.quarter'),
      year: t('settings.granularity.year')
    }

    new SegmentedControl<GanttGranularity>(bar, {
      options: levels.map((level) => ({ id: level, label: labels[level] })),
      active: this.chartGranularity(),
      onChange: (level) => {
        this.granularity = level
        this.plugin.settings.ganttGranularity = level
        void this.plugin.saveSettings()
        this.render()
      }
    })

    bar.createSpan({ cls: 'pm-gantt-sep' })
    // Manual is the order the project stores — the one the drag handle writes — and any
    // other is a reading order, applied at every level so a lot's tasks sort among
    // themselves rather than being scattered up the chart.
    renderSortControl(bar, {
      keys: TASK_SORT_KEYS,
      label: sortKeyLabel,
      unordered: 'manual',
      order: this.order(),
      onPick: async (order) => {
        this.plugin.settings.ganttSortKey = order.sortKey
        this.plugin.settings.ganttSortDir = order.sortDir
        await this.plugin.saveSettings()
        this.render()
      }
    })
    // A template has no today to scroll to: its plan is counted from its own day one.
    if (!this.relative) new ButtonComponent(bar).setButtonText(t('common.today')).onClick(() => this.scrollToToday())

    explain(
      new ButtonComponent(bar).setButtonText(t('gantt.expandAll')).onClick(() => this.setAllCollapsed(false)).buttonEl,
      t('gantt.expandAll'),
      t('tip.gantt.expandAll')
    )
    explain(
      new ButtonComponent(bar).setButtonText(t('gantt.collapseAll')).onClick(() => this.setAllCollapsed(true)).buttonEl,
      t('gantt.collapseAll'),
      t('tip.gantt.collapseAll')
    )
    if (!this.relative) this.renderBaselineControl(bar)
    this.renderCriticalControl(bar)
  }

  /** Each project's critical path, its own statuses and working days, side by side. */
  private criticalOf(tasks: Task[]): CriticalPath {
    const byProject = new Map<Project | null, Task[]>()
    for (const task of tasks) {
      const project = this.scope.projectOf(task.id)
      byProject.set(project, [...(byProject.get(project) ?? []), task])
    }
    const out: CriticalPath = { end: '', floats: new Map(), path: [] }
    for (const [project, list] of byProject) {
      const config = project ? this.plugin.store.configFor(project) : this.scope.config
      const one = criticalPath(list, config.statuses, config.workCalendar)
      for (const [id, float] of one.floats) out.floats.set(id, float)
      out.path.push(...one.path)
      if (one.end > out.end) out.end = one.end
    }
    return out
  }

  /** The critical path shown or not, and — shown — where the plan ends and how many tickets hold it. */
  private renderCriticalControl(bar: HTMLElement): void {
    const on = this.plugin.settings.ganttCritical
    const button = new ButtonComponent(bar).setButtonText(t('gantt.critical')).onClick(
      safeAsync(async () => {
        this.plugin.settings.ganttCritical = !on
        await this.plugin.saveSettings()
        this.refresh()
      })
    ).buttonEl
    button.toggleClass('is-active', on)
    button.setAttr('aria-pressed', String(on))
    explain(button, t('gantt.critical'), t('tip.gantt.critical'))
    const critical = this.critical
    if (!on || !critical) return
    bar.createSpan({
      cls: 'pm-gantt-critical-legend',
      text: critical.end
        ? this.relative
          ? t('gantt.criticalCount', { count: critical.path.length })
          : t('gantt.criticalLegend', { count: critical.path.length, date: formatDate(critical.end) })
        : t('gantt.criticalNone')
    })
  }

  /** The projects the chart draws, a ticket's own each: those a reference is frozen for. */
  private chartedProjects(): Project[] {
    const out = new Map<string, Project>()
    for (const { task } of flattenTasks(this.scope.tasks())) {
      const project = this.scope.projectOf(task.id)
      if (project && !project.template && !project.program) out.set(project.filePath, project)
    }
    return [...out.values()]
  }

  /**
   * The reference plan: frozen now, shown or not under the bars, forgotten — and, when one
   * is shown, the day it was frozen.
   */
  private renderBaselineControl(bar: HTMLElement): void {
    const projects = this.chartedProjects()
    if (!projects.length) return
    const frozen = [...new Set(projects.map((project) => project.baselineAt).filter((at): at is string => !!at))]
    const shown = this.plugin.settings.ganttBaseline
    explain(
      new ButtonComponent(bar)
        .setButtonText(t('gantt.baseline'))
        .setTooltip(t('gantt.baselineDesc'))
        .onClick((event) => {
          const menu = new Menu()
          menu.addItem((item) =>
            item
              .setTitle(frozen.length ? t('gantt.baselineRefreeze') : t('gantt.baselineFreeze'))
              .setIcon('flag')
              .onClick(safeAsync(() => this.freezeBaseline(projects)))
          )
          if (frozen.length) {
            menu.addItem((item) =>
              item
                .setTitle(t('gantt.baselineShow'))
                .setIcon('eye')
                .setChecked(shown)
                .onClick(
                  safeAsync(async () => {
                    this.plugin.settings.ganttBaseline = !shown
                    await this.plugin.saveSettings()
                    this.refresh()
                  })
                )
            )
            menu.addItem((item) =>
              item
                .setTitle(t('gantt.baselineClear'))
                .setIcon('trash-2')
                .onClick(safeAsync(() => this.clearBaseline(projects)))
            )
          }
          menu.showAtMouseEvent(event)
        }).buttonEl,
      t('gantt.baseline'),
      t('tip.gantt.baseline')
    )
    if (frozen.length && shown) {
      bar.createSpan({
        cls: 'pm-gantt-baseline-legend',
        text:
          frozen.length === 1
            ? t('gantt.baselineOf', { date: formatDate(frozen[0]) })
            : t('gantt.baselineSeveral', { count: frozen.length })
      })
    }
  }

  /** The plan of each project drawn frozen as its reference, one frozen before replaced once confirmed. */
  private async freezeBaseline(projects: Project[]): Promise<void> {
    const replaced = projects.filter((project) => project.baselineAt)
    if (
      replaced.length &&
      !(await confirmDialog(
        this.plugin.app,
        t('gantt.baselineReplace', { date: formatDate(replaced[0].baselineAt ?? '') }),
        t('gantt.baselineFreezeConfirm')
      ))
    ) {
      return
    }
    const day = today().toString()
    let count = 0
    for (const project of projects) count += await this.plugin.store.setBaseline(project, day)
    this.plugin.settings.ganttBaseline = true
    await this.plugin.saveSettings()
    new Notice(t('gantt.baselineFrozen', { count, date: formatDate(day) }))
    await this.onRefresh()
  }

  private async clearBaseline(projects: Project[]): Promise<void> {
    if (!(await confirmDialog(this.plugin.app, t('gantt.baselineClearConfirm')))) return
    for (const project of projects) if (project.baselineAt) await this.plugin.store.clearBaseline(project)
    await this.onRefresh()
  }

  private order(): SortOrder {
    return { sortKey: this.plugin.settings.ganttSortKey, sortDir: this.plugin.settings.ganttSortDir }
  }

  private renderGantt(): void {
    const wrapper = this.container.createDiv('pm-gantt-wrapper')

    const leftPanel = wrapper.createDiv('pm-gantt-left')
    const sizeLeftPanel = (width: number): void => {
      leftPanel.style.width = `${width}px`
      leftPanel.style.minWidth = `${width}px`
      // What a phase heading can spare, dropped whole rather than clipped letter by letter.
      leftPanel.toggleClass('pm-gantt-left--tight', width < 300)
      leftPanel.toggleClass('pm-gantt-left--cramped', width < 220)
    }
    sizeLeftPanel(this.labelWidth)
    const leftHeader = leftPanel.createDiv('pm-gantt-left-header')
    leftHeader.style.height = `${HEADER_HEIGHT}px`
    leftHeader.createSpan({ text: t('common.task'), cls: 'pm-gantt-left-header-label' })
    const leftBody = leftPanel.createDiv('pm-gantt-left-body')

    const resizeHandle = wrapper.createDiv('pm-gantt-resize-handle')
    let resizing = false
    let startX = 0
    let startWidth = 0
    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault()
      resizing = true
      startX = e.clientX
      startWidth = this.labelWidth
      activeDocument.body.addClass('pm-resize-active')
    })
    const onMouseMove = (e: MouseEvent) => {
      if (!resizing) return
      const newWidth = Math.max(150, Math.min(600, startWidth + (e.clientX - startX)))
      this.labelWidth = newWidth
      sizeLeftPanel(newWidth)
    }
    const onMouseUp = () => {
      if (!resizing) return
      resizing = false
      activeDocument.body.removeClass('pm-resize-active')
    }
    activeDocument.addEventListener('mousemove', onMouseMove)
    activeDocument.addEventListener('mouseup', onMouseUp)
    this.cleanupFns.push(() => {
      activeDocument.removeEventListener('mousemove', onMouseMove)
      activeDocument.removeEventListener('mouseup', onMouseUp)
    })

    const rightPanel = wrapper.createDiv('pm-gantt-right')
    this.scrollEl = rightPanel

    // The header has its own SVG in a sticky wrapper: it shares the body's horizontal
    // scroll but pins to the top, so the time period stays visible as rows scroll.
    const headerSticky = rightPanel.createDiv('pm-gantt-header-sticky')
    headerSticky.style.width = `${this.cfg.totalWidth}px`
    headerSticky.style.height = `${HEADER_HEIGHT}px`
    this.headerSvgEl = svgEl('svg', {
      width: this.cfg.totalWidth,
      height: HEADER_HEIGHT,
      class: 'pm-gantt-header-svg'
    })
    headerSticky.appendChild(this.headerSvgEl)

    const svgContainer = rightPanel.createDiv('pm-gantt-svg-container')
    svgContainer.style.width = `${this.cfg.totalWidth}px`
    // Tuck the body's top band (still drawn at y=HEADER_HEIGHT) under the sticky header.
    svgContainer.style.marginTop = `-${HEADER_HEIGHT}px`

    const svgHeight = HEADER_HEIGHT + (this.rows.length + 1) * ROW_HEIGHT // +1 for add-task row

    this.svgEl = svgEl('svg', {
      width: this.cfg.totalWidth,
      height: svgHeight,
      class: 'pm-gantt-svg'
    })
    svgContainer.appendChild(this.svgEl)

    const undo = () => {
      if (this.drag.isDragging) return
      void this.plugin.undoLastAction()
      return false
    }
    const redo = () => {
      if (this.drag.isDragging) return
      void this.plugin.redoLastAction()
      return false
    }
    const keyHandlers = [
      this.keyScope.register([], 'Escape', () => {
        if (this.link.active) cancelLink(this.link)
      }),
      this.keyScope.register(['Mod'], 'z', undo),
      this.keyScope.register(['Mod', 'Shift'], 'z', redo),
      this.keyScope.register(['Mod'], 'y', redo)
    ]
    this.cleanupFns.push(() => {
      for (const handler of keyHandlers) this.keyScope.unregister(handler)
    })

    const ctx = this.makeRendererContext()
    renderTimelineHeader(ctx)
    renderGridLines(ctx)
    renderTodayLine(ctx, svgHeight)
    this.renderTaskRows(leftBody, ctx)
    renderDependencyArrows(ctx)
    renderMilestoneLabels(ctx)

    // The left panel is overflow:hidden, so its wheel events would be swallowed.
    const onLeftWheel = (e: WheelEvent) => {
      rightPanel.scrollTop += e.deltaY
      rightPanel.scrollLeft += e.deltaX
      e.preventDefault()
    }
    leftPanel.addEventListener('wheel', onLeftWheel, { passive: false })
    this.cleanupFns.push(() => leftPanel.removeEventListener('wheel', onLeftWheel))

    if (this.scope.canAddTask) {
      const addRow = leftBody.createDiv('pm-gantt-label-row pm-gantt-add-row')
      addRow.style.height = `${ROW_HEIGHT}px`
      renderAddTicketButton(addRow, {
        plugin: this.plugin,
        scope: this.scope,
        onSave: () => this.onRefresh()
      })
    }

    // The right panel's horizontal scrollbar eats into its viewport height, letting it
    // scroll further than the left body; without this spacer the rows desync at the bottom.
    const leftSpacer = leftBody.createDiv()
    leftSpacer.addClass('pm-no-shrink')
    const syncSpacer = () => {
      const hScrollbarH = rightPanel.offsetHeight - rightPanel.clientHeight
      leftSpacer.style.height = `${hScrollbarH}px`
    }

    rightPanel.addEventListener('scroll', () => {
      syncSpacer()
      leftBody.scrollTop = rightPanel.scrollTop
    })

    window.requestAnimationFrame(() => {
      syncSpacer()
      if (this.pendingScroll) {
        this.scrollEl.scrollTop = this.pendingScroll.top
        this.scrollEl.scrollLeft = Math.max(0, dateToX(this.cfg, this.pendingScroll.anchorDate))
        this.pendingScroll = null
      } else {
        this.scrollToToday()
      }
    })
  }

  /**
   * The rows to draw, in order. For a collection that means a heading above each
   * project's block, folded ones keeping their tasks out; for every other scope it is
   * the visible tree, exactly as before.
   */
  private buildRows(roots: Task[]): GanttRow[] {
    const out: GanttRow[] = []
    const statuses = this.scope.config.statuses
    const walk = (tasks: Task[], depth: number) => {
      for (const task of orderTasks(tasks, this.order(), statuses, this.scope.config.priorities)) {
        if (isPhase(task)) {
          // A phase gets a row of its own with a summary bar, and what it holds steps in
          // under it — a lot inside a lot has to be readable as one.
          out.push({ kind: 'phase', task, heading: phaseHeading(task, statuses, depth), depth })
          if (!task.collapsed && task.subtasks.length) walk(task.subtasks, depth + 1)
          continue
        }
        out.push({ kind: 'task', task, depth })
        if (!task.collapsed && task.subtasks.length) walk(task.subtasks, depth + 1)
      }
    }
    const blocks = collectionBlocks(roots, (task) => task.id, this.scope, this.plugin)
    if (!blocks) {
      walk(roots, 0)
      return out
    }
    for (const { heading, rows } of blocks) {
      out.push({ kind: 'group', heading })
      if (!heading.collapsed) walk(rows, 0)
    }
    return out
  }

  private renderTaskRows(leftBody: HTMLElement, ctx: RendererContext): void {
    const barsGroup = svgEl('g', { class: 'pm-gantt-bars' })
    this.svgEl.appendChild(barsGroup)

    const labelCtx = {
      plugin: this.plugin,
      scope: this.scope,
      statuses: this.scope.config.statuses,
      onRefresh: this.onRefresh,
      // Dragging a row writes the project's own order, which a sort would then hide.
      reorderable: this.plugin.settings.ganttSortKey === 'manual',
      realById: this.relative?.realById ?? null
    }
    this.rows.forEach((row, rowIndex) => {
      if (row.kind === 'group') {
        this.renderGroupRow(leftBody, barsGroup, row.heading, rowIndex)
        return
      }
      if (row.kind === 'phase') {
        this.renderPhaseRow(leftBody, barsGroup, row.task, row.heading, row.depth, rowIndex)
        return
      }
      renderTaskLabel(leftBody, row.task, row.depth, rowIndex, labelCtx)
      renderTaskBar(barsGroup, row.task, rowIndex, row.depth, ctx)
    })
  }

  /**
   * A phase: its heading in the label column, and a summary bracket over the span of
   * what it holds. When the phase declares its own dates the bracket draws those, and
   * the work that falls outside them is drawn under it — the overrun is the reason to
   * have declared dates at all.
   */
  private renderPhaseRow(
    leftBody: HTMLElement,
    barsGroup: SVGGElement,
    phase: Task,
    heading: HeadingRow,
    depth: number,
    rowIndex: number
  ): void {
    const el = leftBody.createDiv('pm-gantt-label-row pm-gantt-phase-row')
    el.style.height = `${ROW_HEIGHT}px`
    el.style.paddingLeft = `${depth * 18 + 4}px`
    el.toggleClass('is-collapsed', phase.collapsed)
    el.dataset.taskId = phase.id
    // A lot is a row like any other as far as the drag is concerned: it can be picked up
    // whole, and dropped into. Drawing it as a heading is no reason to make it immovable.
    const owner = this.scope.projectOf(phase.id)
    if (owner) {
      attachRowDragDrop(el, phase, {
        plugin: this.plugin,
        project: owner,
        reorderable: this.plugin.settings.ganttSortKey === 'manual',
        onRefresh: this.onRefresh
      })
    }
    renderHeadingRow(
      el,
      heading,
      headingHandlers(heading, this.scope, this.plugin, () => this.refresh())
    )

    const span = phaseSpan(phase, this.scope.config.statuses)
    if (!span.start || !span.due) return
    const y = HEADER_HEIGHT + rowIndex * ROW_HEIGHT
    barsGroup.appendChild(phaseBracket(this.cfg, span, y))
  }

  /** The heading, plus a band across the timeline so the eye keeps the row. */
  private renderGroupRow(leftBody: HTMLElement, barsGroup: SVGGElement, heading: HeadingRow, rowIndex: number): void {
    const el = leftBody.createDiv('pm-gantt-label-row pm-gantt-group-row')
    el.style.height = `${ROW_HEIGHT}px`
    el.toggleClass('is-collapsed', heading.collapsed)
    renderHeadingRow(
      el,
      heading,
      headingHandlers(heading, this.scope, this.plugin, () => this.refresh())
    )

    barsGroup.appendChild(
      svgEl('rect', {
        x: 0,
        y: HEADER_HEIGHT + rowIndex * ROW_HEIGHT,
        width: this.cfg.totalWidth,
        height: ROW_HEIGHT,
        class: 'pm-gantt-group-band'
      })
    )
  }

  private makeRendererContext(): RendererContext {
    return {
      svgEl: this.svgEl,
      headerSvgEl: this.headerSvgEl,
      cfg: this.cfg,
      plugin: this.plugin,
      scope: this.scope,
      statuses: this.scope.config.statuses,
      flatTasks: this.flatTasks,
      rowOf: new Map(
        // Phases included: a dependency drawn to a lot should land on its summary bar.
        this.rows.flatMap((row, i) => (row.kind === 'group' ? [] : [[row.task.id, i] as [string, number]]))
      ),
      totalRows: this.rows.length,
      drag: this.drag,
      link: this.link,
      relative: this.relative,
      baseline: this.plugin.settings.ganttBaseline,
      critical: this.critical,
      onRefresh: this.onRefresh,
      cleanupFns: this.cleanupFns
    }
  }

  private getVisibleTasks(): Task[] {
    return applyTaskFilterPromote(
      this.scope.tasks(),
      this.filter,
      this.scope.config.statuses,
      personKeyer(this.plugin.app)
    )
  }

  private scrollToToday(): void {
    if (!this.scrollEl) return
    const x = dateToX(this.cfg, today())
    const center = x - this.scrollEl.clientWidth / 2
    this.scrollEl.scrollLeft = Math.max(0, center)
  }

  private setAllCollapsed(collapsed: boolean): void {
    for (const { task } of flattenTasks(this.scope.tasks())) {
      if (task.subtasks.length > 0) task.collapsed = collapsed
    }
    for (const project of this.scope.projects) void this.plugin.persistCollapsedState(project)
    this.render()
  }
}
