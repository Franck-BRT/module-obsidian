import { Notice, setIcon } from 'obsidian'
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
import { approvesProposal, closesChange } from '../store/changeFollowUp'
import { withAffected } from '../store/decision'
import { findTaskById } from '../store/TaskIndex'
import { flattenTasks } from '../store/TaskTreeOps'
import { ContactBook, readContacts } from '../store/contacts'
import { renderPropRow } from '../ui/FormField'
import { renderInputControl, renderSelectControl } from '../ui/composites/properties'
import { attachComboList } from '../ui/comboList'
import { formatDate, formatDateShort, today } from '../dates'
import { explain } from '../ui/explain'
import { openTaskModal } from '../ui/ModalFactory'
import { isTerminalStatus, safeAsync } from '../utils'
import { openAffected, resolveAffected, showAffectedMenu } from '../views/decisions/decisionLinks'
import { implementationTasks, writeChangeSheet } from '../views/changes/changeFiles'
import { ImplementationModal } from '../views/changes/ImplementationModal'
import { ReviseDocsModal, revisableDocs } from '../views/changes/ReviseDocsModal'
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
    const box = parent.createDiv('pm-dm-field')
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
  const sheet = head.createEl('button', { cls: 'pm-change-sheet' })
  setIcon(sheet.createSpan('pm-change-sheet-icon'), 'file-down')
  sheet.createSpan({ text: t('change.sheet.button') })
  explain(sheet, t('change.sheet.button'), t('tip.change.sheet'))
  sheet.addEventListener(
    'click',
    safeAsync(() => writeChangeSheet(plugin, project, task))
  )
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
  renderAffected(request, ctx, set)

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
      const before = { change: changeOf(task) }
      task.change = recordDecision(
        changeOf(task),
        round,
        decision.value as ChangeDecision,
        date.value || today().toString(),
        comment.value
      )
      syncStatus()
      rerender()
      // What the decision calls for next: the tickets to carry it out, the documents to issue again.
      if (approvesProposal(before, task)) openImplementation(ctx, set)
      else if (closesChange(before, task)) openRevision(ctx)
    })
  } else if (stage === 'draft') {
    board.createDiv({ cls: 'pm-change-hint', text: t('change.draftHint') })
  }

  renderImplementation(board, ctx, set)

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

/** What the change touches: each a chip that opens it — a document, a ticket, a requirement, words —, and the way to add one. */
function renderAffected(parent: HTMLElement, ctx: ChangePanelContext, set: (patch: Partial<TaskChange>) => void): void {
  const { task, project, plugin, rerender } = ctx
  const box = parent.createDiv('pm-dm-field pm-decision-affects')
  box.createDiv({ cls: 'pm-change-label', text: t('change.affected') })
  const chips = box.createDiv('pm-decision-chips')
  const source = task.filePath ?? project.filePath
  const tasks = flattenTasks(project.tasks).map((flat) => flat.task)
  for (const raw of changeOf(task).affected) {
    const found = resolveAffected(plugin, raw, source, tasks)
    const chip = chips.createSpan({ cls: `pm-decision-chip is-${found.kind}` })
    setIcon(chip.createSpan({ cls: 'pm-decision-chip-icon' }), found.icon)
    const label = chip.createEl('a', { href: '#', text: found.label })
    label.addEventListener(
      'click',
      safeAsync(async (event: MouseEvent) => {
        event.preventDefault()
        await openAffected(plugin, found, (other) =>
          openTaskModal(plugin, project, { task: other, onSave: async () => {} })
        )
      })
    )
    const remove = chip.createEl('button', {
      cls: 'pm-decision-chip-remove',
      attr: { 'aria-label': t('decision.removeAffected') }
    })
    setIcon(remove, 'x')
    remove.addEventListener('click', () => {
      set({ affected: changeOf(task).affected.filter((one) => one !== raw) })
      rerender()
    })
  }
  const add = chips.createEl('button', { cls: 'pm-decision-add' })
  setIcon(add.createSpan({ cls: 'pm-decision-chip-icon' }), 'plus')
  add.createSpan({ text: t('decision.addAffected') })
  explain(add, t('decision.addAffected'), t('tip.change.addAffected'))
  add.addEventListener('click', (event) =>
    showAffectedMenu(plugin, event, { sourcePath: source, tasks, self: task.id }, (entry) => {
      set({ affected: withAffected(changeOf(task).affected, entry) })
      rerender()
    })
  )
}

/**
 * The tickets carrying the change out, where each stands, and the way to make them once
 * the proposal is approved; when the change is closed, the way to issue again the
 * documents it touched.
 */
function renderImplementation(
  parent: HTMLElement,
  ctx: ChangePanelContext,
  set: (patch: Partial<TaskChange>) => void
): void {
  const { task, project, plugin } = ctx
  const stage = changeStage(changeOf(task))
  const made = implementationTasks(project, task)
  if (!made.length && stage !== 'round2' && stage !== 'closed') return
  const box = parent.createDiv('pm-change-tasks')
  const head = box.createDiv('pm-change-tasks-head')
  const statuses = plugin.store.configFor(project).statuses
  const done = made.filter((one) => isTerminalStatus(one.status, statuses)).length
  head.createSpan({ cls: 'pm-change-label', text: t('change.tasks.title') })
  const progress = t('change.tasks.done', { done, count: made.length })
  if (made.length) head.createSpan({ cls: 'pm-change-tasks-count', text: progress })
  for (const one of made) {
    const row = box.createDiv(`pm-change-task${isTerminalStatus(one.status, statuses) ? ' is-done' : ''}`)
    setIcon(row.createSpan('pm-change-task-icon'), isTerminalStatus(one.status, statuses) ? 'circle-check' : 'circle')
    const link = row.createEl('a', { href: '#', cls: 'pm-change-task-title', text: one.title })
    link.addEventListener('click', (event) => {
      event.preventDefault()
      openTaskModal(plugin, project, { task: one, onSave: async () => {} })
    })
    const status = statuses.find((config) => config.id === one.status)?.label ?? one.status
    row.createSpan({
      cls: 'pm-change-task-meta',
      text: [status, one.due ? formatDateShort(one.due) : ''].filter(Boolean).join(' · ')
    })
  }
  const actions = box.createDiv('pm-change-tasks-actions')
  if (stage === 'round2' || stage === 'closed') {
    const create = actions.createEl('button')
    setIcon(create.createSpan('pm-change-sheet-icon'), 'list-plus')
    create.createSpan({ text: t('change.tasks.open') })
    explain(create, t('change.tasks.open'), t('tip.change.tasks'))
    create.addEventListener('click', () => openImplementation(ctx, set))
  }
  if (stage === 'closed') {
    const revise = actions.createEl('button')
    setIcon(revise.createSpan('pm-change-sheet-icon'), 'file-pen-line')
    revise.createSpan({ text: t('change.revise.open') })
    explain(revise, t('change.revise.open'), t('tip.change.revise'))
    revise.addEventListener('click', () => openRevision(ctx, true))
  }
}

/** The tickets for an approved proposal asked for, then kept on the change — at once, when it is already saved. */
function openImplementation(ctx: ChangePanelContext, set: (patch: Partial<TaskChange>) => void): void {
  const { task, project, plugin, rerender } = ctx
  new ImplementationModal(plugin, project, task, async (ids) => {
    set({ tasks: [...changeOf(task).tasks, ...ids] })
    if (findTaskById(project, task.id)) await plugin.store.updateTask(project, task.id, { change: changeOf(task) })
    rerender()
  }).open()
}

/** The documents a closed change touched, offered to be issued again; said so when it touched none. */
function openRevision(ctx: ChangePanelContext, asked = false): void {
  const { task, project, plugin, rerender } = ctx
  const docs = revisableDocs(plugin, project, task)
  if (!docs.length) {
    if (asked) new Notice(t('change.revise.noDocs'))
    return
  }
  new ReviseDocsModal(plugin, project, task, docs, async () => rerender()).open()
}
