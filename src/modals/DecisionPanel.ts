import { setIcon } from 'obsidian'
import type PMPlugin from '../main'
import type { DecisionState, Project, Task } from '../types'
import { DECISION_STATES, decisionOf, statusForDecision, withAffected } from '../store/decision'
import { flattenTasks } from '../store/TaskTreeOps'
import { ContactBook, readContacts } from '../store/contacts'
import { renderPropRow } from '../ui/FormField'
import { renderDateControl, renderInputControl, renderSelectControl } from '../ui/composites/properties'
import { openTaskModal } from '../ui/ModalFactory'
import { today } from '../dates'
import { safeAsync } from '../utils'
import { decisionStateLabel, DECISION_STATE_ICON } from '../views/decisions/decisionLabels'
import { openAffected, resolveAffected, showAffectedMenu } from '../views/decisions/decisionLinks'
import { explain } from '../ui/explain'
import { t } from '../i18n'

export interface DecisionPanelContext {
  task: Task
  project: Project
  plugin: PMPlugin
  rerender: () => void
}

/**
 * The decision half of a ticket's editor: where it stands, the day it was taken and by
 * whom, why, and what it bears on — tickets, requirements, documents, or a few words.
 * Taken, the ticket is done; dropped, cancelled: the register and the plan agree.
 */
export function renderDecisionPanel(container: HTMLElement, ctx: DecisionPanelContext): void {
  const { task, project, plugin, rerender } = ctx
  const decision = decisionOf(task)
  if (!task.decision) task.decision = decision
  const set = (patch: Partial<typeof decision>): void => {
    task.decision = { ...decisionOf(task), ...patch }
  }

  const section = container.createDiv('pm-modal-section pm-decision-panel')
  const header = section.createDiv('pm-modal-section-header')
  header.createEl('h4', { text: t('decision.section'), cls: 'pm-modal-section-title' })
  const grid = section.createDiv('pm-prop-grid')

  renderPropRow(
    grid,
    t('decision.state'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: decision.state,
        options: DECISION_STATES.map((state) => ({
          id: state,
          label: decisionStateLabel(state),
          icon: DECISION_STATE_ICON[state]
        })),
        onChange: (id) => {
          const state = id as DecisionState
          // Taken, it is dated today unless a day was given.
          set({ state, date: state === 'decided' && !decision.date ? today().toString() : decision.date })
          const status = statusForDecision(state, task.status, plugin.store.configFor(project).statuses)
          if (status) task.status = status
          rerender()
        }
      })
      return cell
    },
    'gavel'
  )

  renderPropRow(
    grid,
    t('decision.date'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderDateControl({
        container: cell,
        value: decision.date,
        emptyLabel: t('decision.notYet'),
        onChange: (value) => {
          set({ date: value })
          rerender()
        }
      })
      return cell
    },
    'calendar-check'
  )

  renderPropRow(
    grid,
    t('decision.decidedBy'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderInputControl({
        container: cell,
        value: decision.decidedBy,
        placeholder: t('decision.decidedByPlaceholder'),
        onChange: (value) => {
          set({ decidedBy: value.trim() })
          rerender()
        }
      })
      // The people and companies the contacts know, offered as it is typed.
      cell.addEventListener('focusin', () => {
        const input = cell.querySelector('input')
        if (!input || input.getAttr('list')) return
        const id = 'pm-decision-contacts'
        const list = cell.createEl('datalist', { attr: { id } })
        for (const name of new ContactBook(readContacts(plugin.app, plugin.settings.peopleFolder)).names()) {
          list.createEl('option', { value: name })
        }
        input.setAttr('list', id)
      })
      return cell
    },
    'user-check'
  )

  // Why: a few lines, kept as written.
  const why = section.createDiv('pm-decision-why')
  why.createDiv({ cls: 'pm-decision-label', text: t('decision.rationale') })
  const area = why.createEl('textarea', {
    cls: 'pm-decision-rationale',
    attr: { rows: '3', placeholder: t('decision.rationalePlaceholder') }
  })
  area.value = decision.rationale
  area.addEventListener('change', () => set({ rationale: area.value.trim() }))

  // What it bears on: each a chip that opens it, and the way to add one.
  const bears = section.createDiv('pm-decision-affects')
  bears.createDiv({ cls: 'pm-decision-label', text: t('decision.affects') })
  const chips = bears.createDiv('pm-decision-chips')
  const source = task.filePath ?? project.filePath
  const tasks = flattenTasks(project.tasks).map((flat) => flat.task)
  for (const raw of decision.affects) {
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
      set({ affects: decisionOf(task).affects.filter((one) => one !== raw) })
      rerender()
    })
  }
  const add = chips.createEl('button', { cls: 'pm-decision-add' })
  setIcon(add.createSpan({ cls: 'pm-decision-chip-icon' }), 'plus')
  add.createSpan({ text: t('decision.addAffected') })
  explain(add, t('decision.addAffected'), t('tip.decision.addAffected'))
  add.addEventListener('click', (event) =>
    showAffectedMenu(plugin, event, { sourcePath: source, tasks, self: task.id }, (entry) => {
      set({ affects: withAffected(decisionOf(task).affects, entry) })
      rerender()
    })
  )
}
