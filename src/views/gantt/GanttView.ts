import { ButtonComponent, type Scope } from 'obsidian'
import type PMPlugin from '../../main'
import type { Task, GanttGranularity, FilterState } from '../../types'
import { personKeyer, type ProjectScope } from '../../store'
import { type FlatTask, flattenTasks } from '../../store/TaskTreeOps'
import { applyTaskFilterPromote } from '../../store/TaskFilter'
import { openAddTask } from '../addTask'
import { renderAddButton } from '../../ui/composites/addButton'
import { SegmentedControl } from '../../ui/primitives/SegmentedControl'
import type { SubView } from '../SubView'
import type { TimelineCfg } from './TimelineConfig'
import { buildTimelineConfig, dateToX, xToDate, HEADER_HEIGHT, ROW_HEIGHT, LABEL_WIDTH } from './TimelineConfig'
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
import { svgEl } from '../../utils'
import { Temporal, today } from '../../dates'
import type { RendererContext } from './GanttRenderer'
import { renderTaskLabel } from './TaskLabelRenderer'
import { collectionBlocks, headingHandlers, phaseHeading, renderHeadingRow, type HeadingRow } from '../headings'
import { GANTT_SORT_KEYS, orderTasks, sortKeyLabel, type SortOrder } from '../sortOrder'
import { renderSortControl } from '../SortControl'
import { isPhase, phaseSpan } from '../../store/Phase'
import { phaseBracket } from './GanttPhaseBar'
import { t } from '../../i18n'

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
    this.container.addClass('pm-gantt-view')

    const activeTasks = this.getVisibleTasks()
    this.flatTasks = flattenTasks(activeTasks).filter((f) => f.visible || f.depth === 0)
    this.rows = this.buildRows(activeTasks)
    this.cfg = buildTimelineConfig(activeTasks, this.granularity)

    this.renderGranularityControls()
    this.renderGantt()
  }

  private renderGranularityControls(): void {
    const bar = this.container.createDiv('pm-gantt-controls')
    const levels: GanttGranularity[] = ['day', 'week', 'month', 'quarter', 'year']
    const labels: Record<GanttGranularity, string> = {
      day: t('settings.granularity.day'),
      week: t('settings.granularity.week'),
      month: t('settings.granularity.month'),
      quarter: t('settings.granularity.quarter'),
      year: t('settings.granularity.year')
    }

    new SegmentedControl<GanttGranularity>(bar, {
      options: levels.map((level) => ({ id: level, label: labels[level] })),
      active: this.granularity,
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
      keys: GANTT_SORT_KEYS,
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
    new ButtonComponent(bar).setButtonText(t('common.today')).onClick(() => this.scrollToToday())

    new ButtonComponent(bar).setButtonText(t('gantt.expandAll')).onClick(() => this.setAllCollapsed(false))
    new ButtonComponent(bar).setButtonText(t('gantt.collapseAll')).onClick(() => this.setAllCollapsed(true))
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
      renderAddButton(addRow, t('gantt.addTask'), (e) => {
        openAddTask(this.plugin, this.scope, { event: e, onSave: () => this.onRefresh() })
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
      reorderable: this.plugin.settings.ganttSortKey === 'manual'
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
