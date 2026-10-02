import { setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { FilterState, Task } from '../../types'
import type { ProjectScope } from '../../store'
import { flattenTasks } from '../../store/TaskTreeOps'
import { RISK_LEVELS, isRisk, orderRisks, riskBand, riskMatrix, riskScore, type RiskBand } from '../../store/risk'
import { openTaskModal } from '../../ui/ModalFactory'
import { displayName, getStatusConfig, isTerminalStatus } from '../../utils'
import { SUBVIEW_CLASS } from '../subviewClasses'
import type { SubView } from '../SubView'
import { BAND_COLOR, bandLabel, impactLabel, probabilityLabel } from './riskLabels'
import { t } from '../../i18n'

/**
 * A project's risks as a register: the 4 × 4 matrix of their probability and impact, each
 * cell coloured by its criticality and counting the risks still open in it, and beside it
 * the risks themselves, the most critical first — each with its levels, who answers for
 * it and how it is countered. A cell clicked narrows the list to it.
 */
export class RisksView implements SubView {
  /** The cell the list is narrowed to, by probability and impact; null for every risk. */
  private cell: { probability: number; impact: number } | null = null

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState
  ) {}

  render(): void {
    this.container.empty()
    this.container.addClass(SUBVIEW_CLASS.risks)
    const root = this.container.createDiv('pm-risks')
    const risks = this.risks()
    const open = risks.filter((risk) => this.isOpen(risk))
    this.renderHead(root, risks, open)
    if (!risks.length) {
      const empty = root.createDiv('pm-risks-empty')
      empty.createDiv({ cls: 'pm-risks-empty-title', text: t('risk.none') })
      empty.createDiv({ cls: 'pm-risks-empty-text', text: t('risk.noneDesc') })
      return
    }
    const body = root.createDiv('pm-risks-body')
    this.renderMatrix(body.createDiv('pm-risks-matrix-wrap'), open)
    this.renderList(body.createDiv('pm-risks-list-wrap'), risks)
  }

  /** The risks of what the view shows, archived ones aside, as the filter's search leaves them. */
  private risks(): Task[] {
    const words = this.filter.text.trim().toLowerCase()
    return flattenTasks(this.scope.tasks())
      .map((flat) => flat.task)
      .filter((task) => isRisk(task) && !task.archived)
      .filter((task) => !words || `${task.title} ${task.risk?.mitigation ?? ''}`.toLowerCase().includes(words))
  }

  /** A risk still to be watched: its status not a finished one — closed, or no longer feared. */
  private isOpen(task: Task): boolean {
    return !isTerminalStatus(task.status, this.scope.configOf(task.id).statuses)
  }

  private renderHead(root: HTMLElement, risks: Task[], open: Task[]): void {
    const head = root.createDiv('pm-risks-head')
    const titles = head.createDiv('pm-risks-titles')
    titles.createEl('h3', { cls: 'pm-risks-title', text: t('risk.register') })
    titles.createDiv({
      cls: 'pm-risks-count',
      text: t('risk.count', { count: open.length, total: risks.length })
    })
    // How many open risks in each band: the register's state in one line.
    const bands = head.createDiv('pm-risks-bands')
    for (const band of ['critical', 'high', 'medium', 'low'] as RiskBand[]) {
      const count = open.filter((risk) => riskBand(riskScore(risk).score) === band).length
      const chip = bands.createSpan({ cls: 'pm-risk-badge', text: `${count} · ${bandLabel(band)}` })
      chip.style.setProperty('--pm-risk-color', BAND_COLOR[band])
      chip.toggleClass('is-zero', count === 0)
    }
    const project = this.scope.addableProjects[0]
    if (this.scope.canAddTask && project) {
      const add = head.createEl('button', { cls: 'mod-cta pm-risks-add' })
      setIcon(add.createSpan({ cls: 'pm-risks-add-icon' }), 'shield-plus')
      add.createSpan({ text: t('risk.new') })
      add.addEventListener('click', () =>
        openTaskModal(this.plugin, project, {
          defaults: { type: 'risk', start: '', risk: { probability: 2, impact: 2, mitigation: '' } },
          onSave: () => this.onRefresh()
        })
      )
    }
  }

  /** The matrix: probability up the side, the likeliest on top; impact along the bottom. */
  private renderMatrix(wrap: HTMLElement, open: Task[]): void {
    const cells = riskMatrix(open)
    const grid = wrap.createDiv('pm-risks-matrix')
    grid.createDiv({ cls: 'pm-risks-axis pm-risks-axis--y', text: t('risk.probability') })
    for (const probability of [...RISK_LEVELS].reverse()) {
      grid.createDiv({
        cls: 'pm-risks-level',
        text: String(probability),
        attr: { title: probabilityLabel(probability) }
      })
      for (const impact of RISK_LEVELS) {
        const count = cells[probability - 1][impact - 1]
        const score = probability * impact
        const band = riskBand(score)
        const chosen = this.cell?.probability === probability && this.cell.impact === impact
        const cell = grid.createEl('button', {
          cls: `pm-risks-cell${count ? '' : ' is-empty'}${chosen ? ' is-chosen' : ''}`,
          text: count ? String(count) : '',
          attr: {
            title: `${probabilityLabel(probability)} × ${impactLabel(impact)} = ${score} · ${bandLabel(band)}`,
            'aria-pressed': String(chosen)
          }
        })
        cell.style.setProperty('--pm-risk-color', BAND_COLOR[band])
        cell.addEventListener('click', () => {
          this.cell = chosen ? null : { probability, impact }
          this.render()
        })
      }
    }
    grid.createDiv({ cls: 'pm-risks-corner' })
    grid.createDiv({ cls: 'pm-risks-corner' })
    for (const impact of RISK_LEVELS) {
      grid.createDiv({ cls: 'pm-risks-level', text: String(impact), attr: { title: impactLabel(impact) } })
    }
    wrap.createDiv({ cls: 'pm-risks-axis pm-risks-axis--x', text: t('risk.impact') })
  }

  private renderList(wrap: HTMLElement, risks: Task[]): void {
    const shown = this.cell
      ? risks.filter((risk) => {
          const { probability, impact } = riskScore(risk)
          return probability === this.cell?.probability && impact === this.cell.impact
        })
      : risks
    if (this.cell) {
      const narrowed = wrap.createDiv('pm-risks-narrowed')
      narrowed.createSpan({
        text: t('risk.narrowed', {
          probability: probabilityLabel(this.cell.probability),
          impact: impactLabel(this.cell.impact)
        })
      })
      const clear = narrowed.createEl('a', { href: '#', text: t('risk.showAll') })
      clear.addEventListener('click', (event) => {
        event.preventDefault()
        this.cell = null
        this.render()
      })
    }
    const list = wrap.createDiv('pm-risks-list')
    for (const risk of orderRisks(shown, (one) => this.isOpen(one))) this.renderRisk(list, risk)
  }

  private renderRisk(list: HTMLElement, risk: Task): void {
    const { probability, impact, score } = riskScore(risk)
    const band = riskBand(score)
    const open = this.isOpen(risk)
    const row = list.createDiv(`pm-risk-row${open ? '' : ' is-closed'}`)
    const badge = row.createDiv({ cls: 'pm-risk-score', text: String(score) })
    badge.style.setProperty('--pm-risk-color', BAND_COLOR[band])
    badge.setAttr('title', bandLabel(band))
    const main = row.createDiv('pm-risk-main')
    const title = main.createEl('a', { cls: 'pm-risk-title', href: '#', text: risk.title })
    title.addEventListener('click', (event) => {
      event.preventDefault()
      const project = this.scope.projectOf(risk.id)
      if (project) openTaskModal(this.plugin, project, { task: risk, onSave: () => this.onRefresh() })
    })
    const meta = main.createDiv('pm-risk-meta')
    meta.createSpan({ text: `${t('risk.probability')} ${probability} · ${probabilityLabel(probability)}` })
    meta.createSpan({ text: `${t('risk.impact')} ${impact} · ${impactLabel(impact)}` })
    if (risk.assignees.length) meta.createSpan({ text: risk.assignees.map(displayName).join(', ') })
    const status = getStatusConfig(this.scope.configOf(risk.id).statuses, risk.status)
    if (status) meta.createSpan({ cls: 'pm-risk-status', text: status.label })
    if (risk.due) meta.createSpan({ text: t('risk.reviewBy', { date: risk.due }) })
    main.createDiv({
      cls: `pm-risk-mitigation${risk.risk?.mitigation ? '' : ' is-missing'}`,
      text: risk.risk?.mitigation || t('risk.noMitigation')
    })
  }
}
