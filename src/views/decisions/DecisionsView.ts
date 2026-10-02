import { setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { DecisionState, FilterState, Task } from '../../types'
import type { ProjectScope } from '../../store'
import { flattenTasks } from '../../store/TaskTreeOps'
import {
  decisionDay,
  decisionMatches,
  decisionOf,
  emptyDecision,
  isDecision,
  orderDecisions
} from '../../store/decision'
import { openTaskModal } from '../../ui/ModalFactory'
import { formatDate, parsePlainDate, today } from '../../dates'
import { dateLocale, t } from '../../i18n'
import { displayName, safeAsync } from '../../utils'
import { explain } from '../../ui/explain'
import { SUBVIEW_CLASS } from '../subviewClasses'
import type { SubView } from '../SubView'
import { DECISION_STATE_COLOR, DECISION_STATE_ICON, decisionStateLabel } from './decisionLabels'
import { openAffected, resolveAffected } from './decisionLinks'

type StateFilter = 'all' | DecisionState

/** A month's name as a heading: « Octobre 2026 ». */
function monthHeading(day: string): string {
  const date = parsePlainDate(`${day.slice(0, 7)}-01`)
  const text = date ? date.toLocaleString(dateLocale(), { month: 'long', year: 'numeric' }) : day.slice(0, 7)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * A project's decisions as a register: those still to be taken on top, the soonest due
 * first and the late ones said so; then those taken, month by month, the latest first;
 * then those replaced or dropped. Each says who decided, why, and what it bears on — a
 * ticket, a requirement, a document —, which opens with a click. Narrowed by state, by
 * who decided, and by the view's search, which reads the reasons too.
 */
export class DecisionsView implements SubView {
  private state: StateFilter = 'all'
  private decider = ''

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState
  ) {}

  /** The decisions of what the view shows, archived ones aside. */
  private decisions(): Task[] {
    return flattenTasks(this.scope.tasks())
      .map((flat) => flat.task)
      .filter((task) => isDecision(task) && !task.archived)
  }

  render(): void {
    this.container.empty()
    this.container.addClass(SUBVIEW_CLASS.decisions)
    const root = this.container.createDiv('pm-decisions')
    const all = this.decisions()
    this.renderHead(root, all)
    if (!all.length) {
      const empty = root.createDiv('pm-decisions-empty')
      empty.createDiv({ cls: 'pm-decisions-empty-title', text: t('decision.none') })
      empty.createDiv({ cls: 'pm-decisions-empty-text', text: t('decision.noneDesc') })
      return
    }
    const shown = orderDecisions(
      all.filter(
        (task) =>
          (this.state === 'all' || decisionOf(task).state === this.state) &&
          (!this.decider || decisionOf(task).decidedBy === this.decider) &&
          decisionMatches(task, this.filter.text)
      )
    )
    if (!shown.length) {
      root.createDiv({ cls: 'pm-decisions-nothing', text: t('decision.nothingShown') })
      return
    }
    const list = root.createDiv('pm-decisions-list')
    let heading = ''
    for (const task of shown) {
      const decision = decisionOf(task)
      const group =
        decision.state === 'proposed'
          ? t('decision.group.pending')
          : decision.state === 'decided'
            ? monthHeading(decisionDay(task))
            : t('decision.group.closed')
      if (group !== heading) {
        heading = group
        list.createEl('h4', { cls: 'pm-decisions-group', text: group })
      }
      this.renderRow(list, task)
    }
  }

  private renderHead(root: HTMLElement, all: Task[]): void {
    const head = root.createDiv('pm-decisions-head')
    const titles = head.createDiv('pm-decisions-titles')
    titles.createEl('h3', { cls: 'pm-decisions-title', text: t('decision.register') })
    const taken = all.filter((task) => decisionOf(task).state === 'decided').length
    const pending = all.filter((task) => decisionOf(task).state === 'proposed').length
    titles.createDiv({ cls: 'pm-decisions-count', text: t('decision.count', { count: taken, pending }) })

    const filters = head.createDiv('pm-decisions-filters')
    const states: StateFilter[] = ['all', 'proposed', 'decided', 'superseded', 'cancelled']
    for (const state of states) {
      const count = state === 'all' ? all.length : all.filter((task) => decisionOf(task).state === state).length
      if (state !== 'all' && !count) continue
      const chip = filters.createEl('button', {
        cls: `pm-decisions-filter${this.state === state ? ' is-active' : ''}`,
        attr: { 'aria-pressed': String(this.state === state) }
      })
      if (state !== 'all') {
        const icon = chip.createSpan({ cls: 'pm-decision-state-icon' })
        setIcon(icon, DECISION_STATE_ICON[state])
        icon.style.setProperty('--pm-decision-color', DECISION_STATE_COLOR[state])
      }
      chip.createSpan({ text: `${state === 'all' ? t('decision.all') : decisionStateLabel(state)} · ${count}` })
      chip.addEventListener('click', () => {
        this.state = state
        this.render()
      })
    }
    // Who decided: every name the register holds.
    const deciders = [...new Set(all.map((task) => decisionOf(task).decidedBy).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    )
    if (deciders.length > 1) {
      const select = filters.createEl('select', { cls: 'dropdown pm-decisions-decider' })
      select.createEl('option', { value: '', text: t('decision.everyDecider') })
      for (const name of deciders) select.createEl('option', { value: name, text: displayName(name) })
      select.value = this.decider
      select.addEventListener('change', () => {
        this.decider = select.value
        this.render()
      })
    }

    const project = this.scope.addableProjects[0]
    if (this.scope.canAddTask && project) {
      const add = head.createEl('button', { cls: 'mod-cta pm-decisions-add' })
      setIcon(add.createSpan({ cls: 'pm-decisions-add-icon' }), 'gavel')
      add.createSpan({ text: t('decision.new') })
      explain(add, t('decision.new'), t('tip.decision.new'))
      add.addEventListener('click', () =>
        openTaskModal(this.plugin, project, {
          defaults: { type: 'decision', start: '', decision: emptyDecision() },
          onSave: () => this.onRefresh()
        })
      )
    }
  }

  private renderRow(list: HTMLElement, task: Task): void {
    const decision = decisionOf(task)
    const day = today().toString()
    const late = decision.state === 'proposed' && !!task.due && task.due < day
    const row = list.createDiv(`pm-decision-row is-${decision.state}${late ? ' is-late' : ''}`)
    const when = row.createDiv('pm-decision-when')
    const shownDay = decision.state === 'proposed' ? task.due : decisionDay(task)
    when.createDiv({ cls: 'pm-decision-day', text: shownDay ? formatDate(shownDay) : '—' })
    if (decision.state === 'proposed') {
      when.createDiv({
        cls: 'pm-decision-due',
        text: task.due ? (late ? t('decision.late') : t('decision.dueBy')) : t('decision.noDue')
      })
    }

    const main = row.createDiv('pm-decision-main')
    const top = main.createDiv('pm-decision-top')
    const badge = top.createSpan({ cls: 'pm-decision-state' })
    badge.style.setProperty('--pm-decision-color', DECISION_STATE_COLOR[decision.state])
    setIcon(badge.createSpan({ cls: 'pm-decision-state-icon' }), DECISION_STATE_ICON[decision.state])
    badge.createSpan({ text: decisionStateLabel(decision.state) })
    const title = top.createEl('a', { cls: 'pm-decision-title', href: '#', text: task.title })
    title.addEventListener('click', (event) => {
      event.preventDefault()
      this.openTicket(task)
    })

    const meta = main.createDiv('pm-decision-meta')
    if (decision.decidedBy) meta.createSpan({ text: t('decision.by', { name: displayName(decision.decidedBy) }) })
    else if (decision.state !== 'proposed') meta.createSpan({ cls: 'is-missing', text: t('decision.noDecider') })
    if (this.scope.projects.length > 1) {
      const owner = this.scope.projectOf(task.id)
      if (owner) meta.createSpan({ text: owner.title })
    }
    if (decision.rationale) main.createDiv({ cls: 'pm-decision-rationale-text', text: decision.rationale })

    if (decision.affects.length) {
      const owner = this.scope.projectOf(task.id)
      const source = task.filePath ?? owner?.filePath ?? ''
      const tasks = flattenTasks(this.scope.tasks()).map((flat) => flat.task)
      const chips = main.createDiv('pm-decision-chips')
      for (const raw of decision.affects) {
        const found = resolveAffected(this.plugin, raw, source, tasks)
        const chip = chips.createEl(found.kind === 'text' ? 'span' : 'a', {
          cls: `pm-decision-chip is-${found.kind}`,
          attr: found.kind === 'text' ? {} : { href: '#' }
        })
        setIcon(chip.createSpan({ cls: 'pm-decision-chip-icon' }), found.icon)
        chip.createSpan({ text: found.label })
        if (found.kind === 'text') continue
        chip.addEventListener(
          'click',
          safeAsync(async (event: Event) => {
            event.preventDefault()
            await openAffected(this.plugin, found, (other) => this.openTicket(other))
          })
        )
      }
    }
  }

  private openTicket(task: Task): void {
    const project = this.scope.projectOf(task.id)
    if (project) openTaskModal(this.plugin, project, { task, onSave: () => this.onRefresh() })
  }
}
