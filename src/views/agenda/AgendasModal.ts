import { Modal, setIcon, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project } from '../../types'
import { agendasByState, COMING_DAYS, type AgendaNote, type AgendaState } from '../../store/agenda/agendaList'
import { formatDate, today } from '../../dates'
import { confirmDialog } from '../../ui/ModalFactory'
import { displayName, safeAsync } from '../../utils'
import { t } from '../../i18n'
import { openAgenda } from './AgendaModal'
import { openAgendaTemplates } from './AgendaTemplatesModal'
import { projectAgendas } from './projectAgendas'

/** A project's agendas managed: prepared, found again by where they stand, opened, thrown away. */
export function openAgendas(plugin: PMPlugin, project: Project): void {
  new AgendasModal(plugin, project).open()
}

function stateIcon(state: AgendaState): string {
  switch (state) {
    case 'coming':
      return 'calendar-clock'
    case 'preparing':
      return 'pencil-ruler'
    case 'held':
      return 'calendar-check'
  }
}

function stateLabel(state: AgendaState): string {
  switch (state) {
    case 'coming':
      return t('agendas.state.coming')
    case 'preparing':
      return t('agendas.state.preparing')
    case 'held':
      return t('agendas.state.held')
  }
}

function sectionLabel(state: AgendaState, count: number): string {
  switch (state) {
    case 'coming':
      return t('agendas.section.coming', { count, days: COMING_DAYS })
    case 'preparing':
      return t('agendas.section.preparing', { count })
    case 'held':
      return t('agendas.section.held', { count })
  }
}

class AgendasModal extends Modal {
  constructor(
    private plugin: PMPlugin,
    private project: Project
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.modalEl.addClass('pm-agenda-modal')
    this.setTitle(t('agendas.title', { project: this.project.title }))
    this.render()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    const head = root.createDiv('pm-agenda-foot pm-agendas-head')
    const prepare = head.createEl('button', { cls: 'mod-cta' })
    setIcon(prepare.createSpan({ cls: 'pm-agenda-template-icon' }), 'list-plus')
    prepare.createSpan({ text: t('agendas.prepare') })
    prepare.addEventListener('click', () => {
      this.close()
      openAgenda(this.plugin, this.project)
    })
    const manage = head.createEl('button', { text: t('agenda.manage') })
    manage.addEventListener('click', () => openAgendaTemplates(this.plugin, () => this.render()))

    const notes = projectAgendas(this.app, this.project.filePath)
    if (!notes.length) {
      root.createDiv({ cls: 'pm-agenda-empty pm-agendas-none', text: t('agendas.none') })
      return
    }
    const groups = agendasByState(notes, today().toString())
    for (const state of ['coming', 'preparing', 'held'] as AgendaState[]) {
      const list = groups[state]
      const section = root.createDiv(`pm-agendas-section pm-agendas-section--${state}`)
      section.createEl('h4', { cls: 'pm-agendas-heading', text: sectionLabel(state, list.length) })
      if (!list.length) {
        section.createDiv({ cls: 'pm-agenda-empty', text: t('agendas.sectionEmpty') })
        continue
      }
      for (const note of list) this.renderRow(section, note, state)
    }
  }

  private renderRow(parent: HTMLElement, note: AgendaNote, state: AgendaState): void {
    const row = parent.createDiv(`pm-agenda-template pm-agendas-row is-${state}`)
    row.setAttr('role', 'link')
    row.setAttr('tabindex', '0')
    const chip = row.createSpan({ cls: `pm-agendas-state is-${state}` })
    setIcon(chip.createSpan({ cls: 'pm-agendas-state-icon' }), stateIcon(state))
    chip.createSpan({ text: stateLabel(state) })
    const text = row.createDiv('pm-agenda-template-text')
    text.createDiv({ cls: 'pm-agenda-template-name', text: note.name })
    const about = [
      note.date ? formatDate(note.date) : t('agendas.noDate'),
      note.template ? t('agendas.template', { template: note.template }) : '',
      note.meeting ? t('agendas.meeting', { meeting: displayName(note.meeting) }) : ''
    ].filter(Boolean)
    text.createDiv({ cls: 'pm-agenda-template-desc', text: about.join(' · ') })
    const actions = row.createDiv('pm-agenda-template-actions')
    const remove = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('agendas.delete') } })
    setIcon(remove, 'trash-2')
    remove.addEventListener(
      'click',
      safeAsync(async (event: MouseEvent) => {
        event.stopPropagation()
        const ok = await confirmDialog(this.app, t('agendas.deleteConfirm', { name: note.name }), t('common.delete'))
        if (!ok) return
        const file = this.app.vault.getAbstractFileByPath(note.path)
        if (file instanceof TFile) await this.app.fileManager.trashFile(file)
        this.render()
      })
    )
    const open = (): void => {
      const file = this.app.vault.getAbstractFileByPath(note.path)
      if (!(file instanceof TFile)) return
      this.close()
      void this.app.workspace.getLeaf('tab').openFile(file)
    }
    row.addEventListener('click', open)
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    })
  }
}
