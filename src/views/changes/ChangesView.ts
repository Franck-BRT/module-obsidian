import { Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { FilterState, Project, Task } from '../../types'
import { makeTask } from '../../types'
import type { ProjectScope } from '../../store'
import { flattenTasks } from '../../store/TaskTreeOps'
import {
  changeCounts,
  changeOf,
  changeOwner,
  changeStage,
  emptyChange,
  isChange,
  isChangeOver,
  lastDecision,
  nextChangeNumber,
  orderChanges,
  type ChangeStage
} from '../../store/change'
import { openTaskModal, promptText } from '../../ui/ModalFactory'
import { formatDateShort } from '../../dates'
import { fold } from '../../store/library/libraryDoc'
import { displayName, safeAsync } from '../../utils'
import { explain } from '../../ui/explain'
import { t } from '../../i18n'
import { SUBVIEW_CLASS } from '../subviewClasses'
import type { SubView } from '../SubView'
import { classLabel, decisionLabel, roundLabel, STAGE_ICON, stageLabel } from './changeLabels'
import { BoardModal } from './BoardModal'

type StageFilter = 'open' | 'all' | ChangeStage

const FILTERS: StageFilter[] = ['open', 'draft', 'round0', 'round1', 'round2', 'closed', 'rejected', 'withdrawn', 'all']

/**
 * A project's configuration changes: each request (DM) and its proposal (PM), where it
 * stands before the local change board (CLM) — round 0, 1 or 2, closed, refused —, the
 * last decision taken; a new request a click away, and the board's sitting, which takes
 * every change waiting for a round, records what it decides and writes its minutes.
 */
export class ChangesView implements SubView {
  private stage: StageFilter = 'open'

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState
  ) {}

  private changes(): Task[] {
    const words = fold(this.filter.text)
    return flattenTasks(this.scope.tasks())
      .map((flat) => flat.task)
      .filter((task) => isChange(task) && !task.archived)
      .filter((task) => {
        if (!words) return true
        const change = changeOf(task)
        return fold(`${task.title} ${change.number} ${change.origin} ${changeOwner(task)}`).includes(words)
      })
  }

  render(): void {
    this.container.empty()
    this.container.addClass(SUBVIEW_CLASS.changes)
    const root = this.container.createDiv('pm-changes')
    const all = this.changes()
    this.renderHead(root, all)
    if (!all.length) {
      const empty = root.createDiv('pm-changes-empty')
      setIcon(empty.createDiv('pm-changes-empty-icon'), 'git-pull-request-arrow')
      empty.createDiv({ cls: 'pm-changes-empty-title', text: t('change.none') })
      empty.createDiv({ text: t('change.noneDesc') })
      return
    }
    this.renderFilters(root, all)
    const shown = orderChanges(
      all.filter((task) => {
        const stage = changeStage(changeOf(task))
        if (this.stage === 'all') return true
        if (this.stage === 'open') return !isChangeOver(changeOf(task))
        return stage === this.stage
      })
    )
    if (!shown.length) {
      root.createDiv({ cls: 'pm-changes-empty', text: t('change.nothingShown') })
      return
    }
    this.renderTable(root, shown)
  }

  private renderHead(root: HTMLElement, all: Task[]): void {
    const head = root.createDiv('pm-changes-head')
    const titles = head.createDiv('pm-changes-titles')
    titles.createEl('h3', { cls: 'pm-changes-title', text: t('change.register') })
    titles.createDiv({ cls: 'pm-changes-intro', text: t('change.registerIntro') })
    const actions = head.createDiv('pm-changes-actions')
    const project = this.scope.addableProjects[0]
    if (this.scope.canAddTask && project) {
      const add = actions.createEl('button', { cls: 'mod-cta' })
      setIcon(add.createSpan('pm-changes-button-icon'), 'plus')
      add.createSpan({ text: t('change.new') })
      explain(add, t('change.new'), t('tip.change.new'))
      add.addEventListener(
        'click',
        safeAsync(() => this.create(project))
      )
    }
    const waiting = all.filter((task) => {
      const stage = changeStage(changeOf(task))
      return stage === 'round0' || stage === 'round1' || stage === 'round2'
    }).length
    const board = actions.createEl('button')
    setIcon(board.createSpan('pm-changes-button-icon'), 'gavel')
    board.createSpan({ text: t('change.board.open', { count: waiting }) })
    explain(board, t('change.board.title'), t('tip.change.board'))
    board.disabled = !waiting
    board.addEventListener('click', () =>
      new BoardModal(this.plugin, this.scope, all, async () => {
        await this.onRefresh()
      }).open()
    )
  }

  private renderFilters(root: HTMLElement, all: Task[]): void {
    const counts = changeCounts(all)
    const open = all.filter((task) => !isChangeOver(changeOf(task))).length
    const bar = root.createDiv('pm-changes-filters')
    for (const filter of FILTERS) {
      const count = filter === 'all' ? all.length : filter === 'open' ? open : counts[filter]
      if (!count && filter !== 'open' && filter !== 'all' && this.stage !== filter) continue
      const chip = bar.createEl('button', {
        cls: `pm-changes-filter${this.stage === filter ? ' is-active' : ''}${filter !== 'open' && filter !== 'all' ? ` is-${filter}` : ''}`
      })
      if (filter !== 'open' && filter !== 'all') setIcon(chip.createSpan('pm-changes-filter-icon'), STAGE_ICON[filter])
      chip.createSpan({
        text:
          filter === 'open' ? t('change.filter.open') : filter === 'all' ? t('change.filter.all') : stageLabel(filter)
      })
      chip.createSpan({ cls: 'pm-changes-filter-count', text: String(count) })
      chip.addEventListener('click', () => {
        this.stage = filter
        this.render()
      })
    }
  }

  private renderTable(root: HTMLElement, shown: Task[]): void {
    const table = root.createEl('table', { cls: 'pm-changes-table' })
    const head = table.createEl('thead').createEl('tr')
    for (const label of [
      t('change.number'),
      t('change.subject'),
      t('change.class'),
      t('change.origin'),
      t('change.owner'),
      t('change.stageColumn'),
      t('change.lastDecision')
    ]) {
      head.createEl('th', { text: label })
    }
    const body = table.createEl('tbody')
    for (const task of shown) {
      const change = changeOf(task)
      const stage = changeStage(change)
      const row = body.createEl('tr', { cls: `pm-changes-row is-${stage}` })
      row.createEl('td', { cls: 'pm-changes-number', text: change.number || '—' })
      const subject = row.createEl('td', { cls: 'pm-changes-subject' })
      subject.createSpan({ text: task.title })
      if (change.reason) subject.createDiv({ cls: 'pm-changes-reason', text: change.reason })
      row.createEl('td', {
        cls: `pm-changes-class is-${change.class}`,
        text: classLabel(change.class)
      })
      row.createEl('td', { text: displayName(change.origin) || '—' })
      row.createEl('td', { text: changeOwner(task) || '—' })
      const badge = row.createEl('td').createSpan({ cls: `pm-change-stage is-${stage}` })
      setIcon(badge.createSpan('pm-change-stage-icon'), STAGE_ICON[stage])
      badge.createSpan({ text: stageLabel(stage) })
      const last = lastDecision(change)
      row.createEl('td', {
        cls: 'pm-changes-last',
        text: last
          ? `${roundLabel(last.round)} · ${decisionLabel(last.decision)}${last.date ? ` · ${formatDateShort(last.date)}` : ''}`
          : '—'
      })
      row.addEventListener('click', () => {
        const project = this.scope.projectOf(task.id)
        if (project) openTaskModal(this.plugin, project, { task, onSave: () => this.onRefresh() })
      })
    }
  }

  /** A new request: its subject asked, then its card opened to write the rest. */
  private async create(project: Project): Promise<void> {
    const title = await promptText(this.plugin.app, t('change.newTitle'), t('change.subjectPlaceholder'))
    if (!title?.trim()) return
    const tasks = flattenTasks(project.tasks).map((flat) => flat.task)
    const task = makeTask({
      title: title.trim(),
      type: 'change',
      start: '',
      due: '',
      change: emptyChange({ number: nextChangeNumber(tasks) })
    })
    await this.plugin.store.insertTask(project, task)
    new Notice(t('change.added', { number: changeOf(task).number }))
    await this.onRefresh()
    openTaskModal(this.plugin, project, { task, onSave: () => this.onRefresh() })
  }
}
