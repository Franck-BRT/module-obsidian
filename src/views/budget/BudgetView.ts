import { setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { BudgetLine, FilterState, Task, TaskBudget } from '../../types'
import type { ProjectScope } from '../../store'
import { fold } from '../../store/library/libraryDoc'
import {
  addFigures,
  budgetCurve,
  budgetFigures,
  budgetOf,
  projectBudget,
  type BudgetFigures,
  type LotBudget
} from '../../store/budget'
import { parseAmount } from '../../store/YamlHydrator'
import { ContactBook, readContacts } from '../../store/contacts'
import { formatDateShort, today } from '../../dates'
import { safeAsync } from '../../utils'
import { explain } from '../../ui/explain'
import { t } from '../../i18n'
import { SUBVIEW_CLASS } from '../subviewClasses'
import type { SubView } from '../SubView'
import { budgetChart } from './budgetChart'
import { formatAmount, formatMoney } from './money'

type LineKind = 'commitments' | 'invoices'

/** The lots opened for editing, kept across the re-renders a save brings. */
const opened = new Set<string>()

/**
 * A project's money, lot by lot: what each was given, what is committed, what is
 * invoiced, what remains to commit and where it will end against its budget — the
 * overruns in red —, over the curve of the money in time. A lot opens on its budget,
 * its estimate of what remains, and its lines: the contracts, amendments and orders
 * committed, the invoices paid. All amounts excluding tax.
 */
export class BudgetView implements SubView {
  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState
  ) {}

  render(): void {
    this.container.empty()
    this.container.addClass(SUBVIEW_CLASS.budget)
    const root = this.container.createDiv('pm-budget')
    const all = projectBudget(this.scope.tasks())
    const words = fold(this.filter.text)
    const budget = words
      ? (() => {
          const lots = all.lots.filter((lot) => fold(lot.task.title).includes(words))
          return { lots, total: addFigures(lots.map((lot) => lot.figures)) }
        })()
      : all
    const head = root.createDiv('pm-budget-head')
    head.createEl('h3', { cls: 'pm-budget-title', text: t('budget.title') })
    head.createSpan({ cls: 'pm-budget-note', text: t('budget.excludingTax') })
    if (!budget.lots.length) {
      const empty = root.createDiv('pm-budget-empty')
      empty.createDiv({ cls: 'pm-budget-empty-title', text: t('budget.noLot') })
      empty.createDiv({ text: t('budget.noLotDesc') })
      return
    }
    this.renderTiles(root, budget.total)
    const card = root.createDiv('pm-budget-card')
    card.createDiv({ cls: 'pm-budget-card-title', text: t('budget.curveTitle') })
    const points = budgetCurve(budget.lots, this.scope.config.statuses, today().toString())
    budgetChart(card, points, budget.total.forecast, card.clientWidth - 32 || 640)
    this.renderTable(root, budget.lots, budget.total)
  }

  private renderTiles(root: HTMLElement, total: BudgetFigures): void {
    const tiles = root.createDiv('pm-budget-tiles')
    const share = (part: number, whole: number): string => (whole ? `${Math.round((part / whole) * 100)} %` : '')
    const tile = (label: string, value: string, detail: string, tip: string, cls = ''): void => {
      const box = tiles.createDiv(`pm-budget-tile ${cls}`)
      box.createDiv({ cls: 'pm-budget-tile-label', text: label })
      box.createDiv({ cls: 'pm-budget-tile-value', text: value })
      if (detail) box.createDiv({ cls: 'pm-budget-tile-detail', text: detail })
      explain(box, label, tip)
    }
    tile(t('budget.budget'), formatMoney(total.budget), '', t('tip.budget.budget'))
    tile(
      t('budget.committed'),
      formatMoney(total.committed),
      total.budget ? t('budget.ofBudget', { share: share(total.committed, total.budget) }) : '',
      t('tip.budget.committed')
    )
    tile(
      t('budget.invoiced'),
      formatMoney(total.invoiced),
      total.committed ? t('budget.ofCommitted', { share: share(total.invoiced, total.committed) }) : '',
      t('tip.budget.invoiced')
    )
    tile(t('budget.toCommit'), formatMoney(total.toCommit), '', t('tip.budget.toCommit'))
    tile(t('budget.forecast'), formatMoney(total.forecast), '', t('tip.budget.forecast'))
    tile(
      t('budget.variance'),
      formatMoney(total.variance, true),
      varianceWords(total.variance),
      t('tip.budget.variance'),
      varianceClass(total.variance)
    )
  }

  private renderTable(root: HTMLElement, lots: LotBudget[], total: BudgetFigures): void {
    const table = root.createDiv('pm-budget-table')
    const several = this.scope.isMulti
    const row = (cls: string): HTMLElement => table.createDiv(`pm-budget-row ${cls}`)
    const head = row('is-head')
    for (const label of [
      t('budget.lot'),
      t('budget.budget'),
      t('budget.committed'),
      t('budget.invoiced'),
      t('budget.toCommit'),
      t('budget.forecast'),
      t('budget.variance')
    ]) {
      head.createSpan({ text: label })
    }
    for (const lot of lots) {
      const figures = lot.figures
      const line = row(`is-lot${opened.has(lot.task.id) ? ' is-open' : ''}`)
      const name = line.createEl('button', { cls: 'pm-budget-lot' })
      setIcon(name.createSpan({ cls: 'pm-budget-chevron' }), opened.has(lot.task.id) ? 'chevron-down' : 'chevron-right')
      name.createSpan({ text: lot.task.title })
      if (several) name.createSpan({ cls: 'pm-budget-project', text: this.scope.projectOf(lot.task.id)?.title ?? '' })
      name.setAttr('aria-expanded', String(opened.has(lot.task.id)))
      name.addEventListener('click', () => {
        if (opened.has(lot.task.id)) opened.delete(lot.task.id)
        else opened.add(lot.task.id)
        this.render()
      })
      this.figureCells(line, figures)
      // How far committed against its budget, as a bar under the lot's name.
      if (figures.budget > 0) {
        const track = name.createSpan({ cls: 'pm-budget-track' })
        const fill = track.createSpan({ cls: `pm-budget-fill${figures.committed > figures.budget ? ' is-over' : ''}` })
        fill.setCssProps({ '--pm-budget-share': `${Math.min(100, (figures.committed / figures.budget) * 100)}%` })
      }
      if (opened.has(lot.task.id)) this.renderLot(table, lot.task)
    }
    const sum = row('is-total')
    sum.createSpan({ text: t('budget.total') })
    this.figureCells(sum, total)
  }

  private figureCells(line: HTMLElement, figures: BudgetFigures): void {
    for (const value of [figures.budget, figures.committed, figures.invoiced, figures.toCommit, figures.forecast]) {
      line.createSpan({ cls: 'pm-budget-amount', text: formatMoney(value) })
    }
    line.createSpan({
      cls: `pm-budget-amount ${varianceClass(figures.variance)}`,
      text: figures.variance ? formatMoney(figures.variance, true) : '—'
    })
  }

  /** A lot opened: its budget, its estimate of what remains, and its lines. */
  private renderLot(table: HTMLElement, task: Task): void {
    const budget = budgetOf(task)
    const panel = table.createDiv('pm-budget-panel')
    const fields = panel.createDiv('pm-budget-fields')
    const amountField = (
      label: string,
      tip: string,
      value: string,
      placeholder: string,
      set: (raw: string) => Promise<void>
    ): void => {
      const field = fields.createEl('label', { cls: 'pm-budget-field' })
      field.createSpan({ text: label })
      const input = field.createEl('input', { attr: { type: 'text', inputmode: 'decimal', placeholder } })
      input.value = value
      explain(field, label, tip)
      input.addEventListener(
        'change',
        safeAsync(() => set(input.value))
      )
    }
    amountField(
      t('budget.budget'),
      t('tip.budget.budget'),
      budget.amount ? formatAmount(budget.amount) : '',
      '0',
      async (raw) => {
        const amount = parseAmount(raw)
        if (amount !== null || !raw.trim()) await this.save(task, { ...budgetOf(task), amount: amount ?? 0 })
      }
    )
    const automatic = Math.max(0, budget.amount - budgetFigures(budget).committed)
    amountField(
      t('budget.toCommitEstimate'),
      t('tip.budget.toCommitEstimate'),
      budget.toCommit === undefined ? '' : formatAmount(budget.toCommit),
      t('budget.automatic', { amount: formatMoney(automatic) }),
      async (raw) => {
        const amount = parseAmount(raw)
        const { amount: given, commitments, invoices } = budgetOf(task)
        const next: TaskBudget = { amount: given, commitments, invoices }
        if (amount !== null) next.toCommit = amount
        await this.save(task, next)
      }
    )
    this.renderLines(panel, task, 'commitments')
    this.renderLines(panel, task, 'invoices')
  }

  private renderLines(panel: HTMLElement, task: Task, kind: LineKind): void {
    const section = panel.createDiv('pm-budget-lines')
    const lines = budgetOf(task)[kind]
    section.createDiv({
      cls: 'pm-budget-lines-title',
      text: kind === 'commitments' ? t('budget.commitments') : t('budget.invoices')
    })
    const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date))
    for (const line of sorted) {
      const row = section.createDiv('pm-budget-line')
      row.createSpan({ cls: 'pm-budget-line-date', text: line.date ? formatDateShort(line.date) : '—' })
      row.createSpan({ cls: 'pm-budget-line-label', text: line.label || '—' })
      row.createSpan({ cls: 'pm-budget-line-company', text: line.company })
      row.createSpan({ cls: 'pm-budget-amount', text: formatMoney(line.amount) })
      const remove = row.createEl('button', {
        cls: 'pm-budget-line-remove',
        attr: { 'aria-label': t('budget.removeLine') }
      })
      setIcon(remove, 'x')
      remove.addEventListener(
        'click',
        safeAsync(() => {
          const budget = budgetOf(task)
          return this.save(task, { ...budget, [kind]: budget[kind].filter((one) => one !== line) })
        })
      )
    }
    if (!lines.length) section.createDiv({ cls: 'pm-budget-line-none', text: t('budget.noLine') })

    // A line to add one: the day, what it is, who, how much.
    const add = section.createDiv('pm-budget-line pm-budget-add')
    const date = add.createEl('input', { attr: { type: 'date' } })
    date.value = today().toString()
    const label = add.createEl('input', {
      attr: {
        type: 'text',
        placeholder: kind === 'commitments' ? t('budget.commitmentPlaceholder') : t('budget.invoicePlaceholder')
      }
    })
    const company = add.createEl('input', {
      attr: { type: 'text', placeholder: t('budget.company'), list: 'pm-budget-companies' }
    })
    const companies = budgetOf(task)
      .commitments.map((one) => one.company)
      .filter(Boolean)
    if (kind === 'invoices' && companies.length) company.value = companies[companies.length - 1]
    if (!this.container.querySelector('#pm-budget-companies')) {
      const list = this.container.createEl('datalist', { attr: { id: 'pm-budget-companies' } })
      for (const name of new ContactBook(readContacts(this.plugin.app, this.plugin.settings.peopleFolder)).names()) {
        list.createEl('option', { value: name })
      }
    }
    const amount = add.createEl('input', {
      attr: { type: 'text', inputmode: 'decimal', placeholder: t('budget.amount') }
    })
    const button = add.createEl('button', { cls: 'mod-cta', text: t('budget.addLine') })
    explain(
      button,
      t('budget.addLine'),
      kind === 'commitments' ? t('tip.budget.addCommitment') : t('tip.budget.addInvoice')
    )
    const submit = safeAsync(async () => {
      const value = parseAmount(amount.value)
      if (value === null) {
        amount.focus()
        return
      }
      const line: BudgetLine = {
        date: date.value,
        label: label.value.trim(),
        company: company.value.trim(),
        amount: value
      }
      const budget = budgetOf(task)
      await this.save(task, { ...budget, [kind]: [...budget[kind], line] })
    })
    button.addEventListener('click', submit)
    amount.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        submit()
      }
    })
  }

  private async save(task: Task, budget: TaskBudget): Promise<void> {
    const project = this.scope.projectOf(task.id)
    if (!project) return
    opened.add(task.id)
    await this.plugin.store.updateTask(project, task.id, { budget })
    await this.onRefresh()
  }
}

/** An overrun in red, a saving in green — and said in words, never colour alone. */
export function varianceClass(variance: number): string {
  return variance > 0 ? 'is-over' : variance < 0 ? 'is-under' : ''
}

function varianceWords(variance: number): string {
  if (variance > 0) return t('budget.overrun')
  if (variance < 0) return t('budget.saving')
  return t('budget.onBudget')
}
