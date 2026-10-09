import { Modal, Notice } from 'obsidian'
import type PMPlugin from '../../main'
import { makeTask, type Project, type Task } from '../../types'
import { changeOf, changeOwner } from '../../store/change'
import { implementationLines } from '../../store/changeFollowUp'
import { changesLot, ensureLot } from '../../store/projectLots'
import { ContactBook, readContacts } from '../../store/contacts'
import { refLink } from '../../store/refs'
import { attachComboList } from '../../ui/comboList'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

/**
 * The tickets an approved proposal is carried out by: one a line — the proposal's own
 * list offered first —, who carries them and by when, made in the « Modifications » lot
 * of one of the change's projects, each pointing back to the change, which keeps them.
 */
export class ImplementationModal extends Modal {
  constructor(
    private plugin: PMPlugin,
    private projects: Project[],
    private change: Task,
    private onCreated: (ids: string[]) => Promise<void>
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    const number = changeOf(this.change).number
    this.modalEl.addClass('pm-implementation-modal')
    this.setTitle(t('change.tasks.createTitle', { number: number || this.change.title }))
    const root = this.contentEl
    root.createDiv({ cls: 'pm-implementation-hint', text: t('change.tasks.createHint') })
    const lines = root.createEl('textarea', { cls: 'pm-implementation-lines', attr: { rows: '6' } })
    lines.value = implementationLines(this.change).join('\n')

    const row = root.createDiv('pm-implementation-row')
    // Several projects: the one the tickets are made in, chosen.
    let project = this.projects[0]
    if (this.projects.length > 1) {
      const where = row.createDiv('pm-implementation-field')
      where.createDiv({ cls: 'pm-change-label', text: t('change.tasks.project') })
      const select = where.createEl('select', { cls: 'dropdown' })
      for (const one of this.projects) select.createEl('option', { value: one.filePath, text: one.title })
      select.addEventListener('change', () => {
        project = this.projects.find((one) => one.filePath === select.value) ?? project
      })
    }
    const who = row.createDiv('pm-implementation-field')
    who.createDiv({ cls: 'pm-change-label', text: t('change.owner') })
    const owner = who.createEl('input', { attr: { type: 'text' } })
    owner.value = this.change.assignees[0] ?? ''
    owner.placeholder = changeOwner(this.change) || t('change.tasks.ownerPlaceholder')
    const names = new ContactBook(readContacts(this.app, this.plugin.settings.peopleFolder)).names()
    attachComboList(
      owner,
      () => names,
      () => owner.blur()
    )
    const when = row.createDiv('pm-implementation-field')
    when.createDiv({ cls: 'pm-change-label', text: t('change.sheet.due') })
    const due = when.createEl('input', { attr: { type: 'date' } })
    due.value = this.change.due

    const foot = root.createDiv('pm-board-foot')
    foot.createEl('button', { text: t('change.tasks.later') }).addEventListener('click', () => this.close())
    const create = foot.createEl('button', { cls: 'mod-cta', text: t('change.tasks.create') })
    create.addEventListener(
      'click',
      safeAsync(async () => {
        const titles = lines.value
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        if (!titles.length) {
          new Notice(t('change.tasks.noneGiven'))
          return
        }
        create.disabled = true
        try {
          await this.create(project, titles, owner.value.trim(), due.value)
        } finally {
          create.disabled = false
        }
      })
    )
  }

  private async create(project: Project, titles: string[], owner: string, due: string): Promise<void> {
    const store = this.plugin.store
    const lot = await ensureLot(store, project, changesLot())
    const number = changeOf(this.change).number || this.change.title
    const link = this.change.filePath ? refLink(this.app, this.change.filePath, number, '') : number
    const ids: string[] = []
    for (const title of titles) {
      const task = makeTask({
        title,
        start: '',
        due,
        assignees: owner ? [owner] : [],
        description: t('change.tasks.description', { change: link })
      })
      await store.insertTask(project, task, lot)
      ids.push(task.id)
    }
    await this.onCreated(ids)
    this.close()
    new Notice(t('change.tasks.created', { count: ids.length, number }))
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
