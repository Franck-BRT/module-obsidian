import { setIcon } from 'obsidian'
import type PMPlugin from '../main'
import type { ChangeDecision, ChangeGroup, Project, Task, TaskChange } from '../types'
import {
  awaitedRound,
  CHANGE_CLASSES,
  CHANGE_GROUPS,
  CHANGE_DECISIONS,
  changeOf,
  changeStage,
  nextChangeNumber,
  recordDecision,
  statusForChange
} from '../store/change'
import { flattenTasks } from '../store/TaskTreeOps'
import { ContactBook, readContacts } from '../store/contacts'
import { renderPropRow } from '../ui/FormField'
import { renderInputControl, renderSelectControl } from '../ui/composites/properties'
import { attachComboList } from '../ui/comboList'
import { formatDate, today } from '../dates'
import { explain } from '../ui/explain'
import {
  classLabel,
  decisionLabel,
  groupLabel,
  roundHint,
  roundLabel,
  STAGE_ICON,
  stageLabel
} from '../views/changes/changeLabels'
import { t } from '../i18n'

export interface ChangePanelContext {
  task: Task
  project: Project
  plugin: PMPlugin
  rerender: () => void
}

/**
 * The change half of a ticket's editor: the request (DM) — its number, class, who asks,
 * why, what —, the proposal (PM) — how, and what it does to the design, the cost, the
 * schedule —, what it touches, then the board (CLM): where it stands, the decisions
 * taken round by round, and the way to record the next. Over, its ticket is done.
 */
export function renderChangePanel(container: HTMLElement, ctx: ChangePanelContext): void {
  const { task, project, plugin, rerender } = ctx
  if (!task.change) {
    const tasks = flattenTasks(project.tasks).map((flat) => flat.task)
    task.change = { ...changeOf(task), number: nextChangeNumber(tasks) }
  }
  const change = changeOf(task)
  const set = (patch: Partial<TaskChange>): void => {
    task.change = { ...changeOf(task), ...patch }
  }
  const syncStatus = (): void => {
    const status = statusForChange(changeOf(task), task.status, plugin.store.configFor(project).statuses)
    if (status) task.status = status
  }
  const area = (parent: HTMLElement, label: string, value: string, placeholder: string, save: (v: string) => void) => {
    const box = parent.createDiv('pm-change-field')
    box.createDiv({ cls: 'pm-change-label', text: label })
    const input = box.createEl('textarea', { cls: 'pm-change-text', attr: { rows: '3', placeholder } })
    input.value = value
    input.addEventListener('change', () => save(input.value.trim()))
  }

  // The request.
  const request = container.createDiv('pm-modal-section pm-change-panel')
  const head = request.createDiv('pm-modal-section-header')
  head.createEl('h4', { text: t('change.section.request'), cls: 'pm-modal-section-title' })
  const stage = changeStage(change)
  const badge = head.createSpan({ cls: `pm-change-stage is-${stage}` })
  setIcon(badge.createSpan('pm-change-stage-icon'), STAGE_ICON[stage])
  badge.createSpan({ text: stageLabel(stage) })
  const grid = request.createDiv('pm-prop-grid')
  renderPropRow(
    grid,
    t('change.number'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderInputControl({
        container: cell,
        value: change.number,
        placeholder: 'DM-001',
        onChange: (value) => {
          set({ number: value.trim() })
          rerender()
        }
      })
      return cell
    },
    'hash'
  )
  renderPropRow(
    grid,
    t('change.class'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: change.class,
        options: CHANGE_CLASSES.map((kind) => ({ id: kind, label: classLabel(kind) })),
        onChange: (id) => {
          set({ class: id as TaskChange['class'] })
          rerender()
        }
      })
      return cell
    },
    'gauge'
  )
  renderPropRow(
    grid,
    t('change.group'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: String(change.group),
        options: [0, ...CHANGE_GROUPS].map((group) => ({ id: String(group), label: groupLabel(group as ChangeGroup) })),
        onChange: (id) => {
          set({ group: Number(id) as ChangeGroup })
          rerender()
        }
      })
      return cell
    },
    'boxes'
  )
  renderPropRow(
    grid,
    t('change.origin'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderInputControl({
        container: cell,
        value: change.origin,
        placeholder: t('change.originPlaceholder'),
        onChange: (value) => {
          set({ origin: value.trim() })
          rerender()
        }
      })
      const input = cell.querySelector('input')
      if (input) {
        const names = new ContactBook(readContacts(plugin.app, plugin.settings.peopleFolder)).names()
        attachComboList(
          input,
          () => names,
          () => input.blur()
        )
      }
      return cell
    },
    'user'
  )
  renderPropRow(
    grid,
    t('change.submittedOn'),
    () => {
      const cell = createDiv('pm-prop-value')
      if (change.submittedOn) cell.createSpan({ text: formatDate(change.submittedOn) })
      else {
        const send = cell.createEl('button', { cls: 'mod-cta pm-change-submit', text: t('change.submit') })
        explain(send, t('change.submit'), t('tip.change.submit'))
        send.addEventListener('click', () => {
          set({ submittedOn: today().toString() })
          rerender()
        })
      }
      return cell
    },
    'send'
  )
  area(request, t('change.reason'), change.reason, t('change.reasonPlaceholder'), (value) => set({ reason: value }))
  area(request, t('change.request'), change.request, t('change.requestPlaceholder'), (value) => set({ request: value }))
  area(request, t('change.affected'), change.affected.join('\n'), t('change.affectedPlaceholder'), (value) =>
    set({
      affected: value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    })
  )

  // The proposal.
  const proposal = container.createDiv('pm-modal-section pm-change-panel')
  proposal
    .createDiv('pm-modal-section-header')
    .createEl('h4', { text: t('change.section.proposal'), cls: 'pm-modal-section-title' })
  proposal.createDiv({ cls: 'pm-change-hint', text: t('change.proposalHint') })
  area(proposal, t('change.proposal'), change.proposal, t('change.proposalPlaceholder'), (value) =>
    set({ proposal: value })
  )
  const impacts = proposal.createDiv('pm-change-impacts')
  area(impacts, t('change.impactTechnical'), change.impactTechnical, '', (value) => set({ impactTechnical: value }))
  area(impacts, t('change.impactCost'), change.impactCost, '', (value) => set({ impactCost: value }))
  area(impacts, t('change.impactSchedule'), change.impactSchedule, '', (value) => set({ impactSchedule: value }))

  // The board.
  const board = container.createDiv('pm-modal-section pm-change-panel')
  board
    .createDiv('pm-modal-section-header')
    .createEl('h4', { text: t('change.section.board'), cls: 'pm-modal-section-title' })
  const steps = board.createDiv('pm-change-steps')
  for (const round of [0, 1, 2] as const) {
    const decisions = change.rounds.filter((one) => one.round === round)
    const last = decisions[decisions.length - 1]
    const waiting = awaitedRound(change) === round
    const step = steps.createDiv(
      `pm-change-step${last?.decision === 'accepted' ? ' is-done' : ''}${waiting ? ' is-waiting' : ''}${last?.decision === 'rejected' ? ' is-rejected' : ''}`
    )
    step.createDiv({ cls: 'pm-change-step-title', text: roundLabel(round) })
    step.createDiv({ cls: 'pm-change-step-hint', text: roundHint(round) })
    for (const one of decisions) {
      const line = step.createDiv(`pm-change-decision is-${one.decision}`)
      line.createSpan({ cls: 'pm-change-decision-what', text: decisionLabel(one.decision) })
      if (one.date) line.createSpan({ cls: 'pm-change-decision-date', text: formatDate(one.date) })
      if (one.comment) line.createDiv({ cls: 'pm-change-decision-comment', text: one.comment })
    }
    if (waiting) step.createDiv({ cls: 'pm-change-step-wait', text: t('change.waiting') })
  }
  // The last decision taken back, a slip of the hand.
  if (change.rounds.length) {
    const undo = board.createEl('a', { cls: 'pm-change-undo', href: '#', text: t('change.undoDecision') })
    undo.addEventListener('click', (event) => {
      event.preventDefault()
      set({ rounds: changeOf(task).rounds.slice(0, -1) })
      syncStatus()
      rerender()
    })
  }

  const round = awaitedRound(change)
  if (round !== null) {
    const form = board.createDiv('pm-change-record')
    form.createDiv({ cls: 'pm-change-label', text: t('change.recordAt', { round: roundLabel(round) }) })
    const row = form.createDiv('pm-change-record-row')
    const date = row.createEl('input', { attr: { type: 'date' } })
    date.value = today().toString()
    const decision = row.createEl('select', { cls: 'dropdown' })
    for (const one of CHANGE_DECISIONS) decision.createEl('option', { value: one, text: decisionLabel(one) })
    const comment = form.createEl('textarea', {
      cls: 'pm-change-text',
      attr: { rows: '2', placeholder: t('change.commentPlaceholder') }
    })
    const save = row.createEl('button', { cls: 'mod-cta', text: t('change.record') })
    save.addEventListener('click', () => {
      task.change = recordDecision(
        changeOf(task),
        round,
        decision.value as ChangeDecision,
        date.value || today().toString(),
        comment.value
      )
      syncStatus()
      rerender()
    })
  } else if (stage === 'draft') {
    board.createDiv({ cls: 'pm-change-hint', text: t('change.draftHint') })
  }

  // Taken back by whoever asked, or brought back.
  const withdraw = board.createEl('a', {
    cls: 'pm-change-withdraw',
    href: '#',
    text: change.withdrawn ? t('change.restore') : t('change.withdraw')
  })
  withdraw.addEventListener('click', (event) => {
    event.preventDefault()
    set({ withdrawn: !changeOf(task).withdrawn })
    syncStatus()
    rerender()
  })
}
