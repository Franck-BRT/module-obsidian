import { Modal, Notice, setIcon, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { changeOf } from '../../store/change'
import { ContactBook, readContacts } from '../../store/contacts'
import { renderChangePanel } from '../../modals/ChangePanel'
import { attachComboList } from '../../ui/comboList'
import { explain } from '../../ui/explain'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

/**
 * A change of the library, in its own window: its subject, the projects it belongs to —
 * one, several, none, as a document's —, who carries its proposal and by when, then the
 * whole of the request, the proposal and the board. Saved, it is written back into its note.
 */
export class ChangeModal extends Modal {
  private task: Task
  private projectPaths: string[]
  private projects: Project[] = []

  constructor(
    private plugin: PMPlugin,
    task: Task,
    private onSaved: () => Promise<void> | void,
    /** The projects already at hand, used as they are rather than read again. */
    private known: Project[] = []
  ) {
    super(plugin.app)
    this.task = structuredClone(task)
    this.projectPaths = (task.filePath ? plugin.changes.at(task.filePath)?.doc.projects : undefined) ?? []
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass('pm-change-modal')
    await this.loadProjects()
    this.render()
  }

  private async loadProjects(): Promise<void> {
    const out: Project[] = []
    for (const path of this.projectPaths) {
      const project =
        this.known.find((one) => one.filePath === path) ?? (await this.plugin.store.loadProjectByPath(path))
      if (project) out.push(project)
    }
    this.projects = out
  }

  private render(): void {
    const change = changeOf(this.task)
    this.setTitle([change.number, this.task.title].filter(Boolean).join(' — '))
    const root = this.contentEl
    const scroll = root.scrollTop
    root.empty()

    // What it is, and where it belongs.
    const head = root.createDiv('pm-change-modal-head')
    const title = head.createEl('input', { cls: 'pm-change-modal-title', attr: { type: 'text' } })
    title.value = this.task.title
    title.placeholder = t('change.subjectPlaceholder')
    title.addEventListener('change', () => {
      this.task.title = title.value.trim() || this.task.title
      this.setTitle([changeOf(this.task).number, this.task.title].filter(Boolean).join(' — '))
    })

    const meta = root.createDiv('pm-change-modal-meta')
    const where = meta.createDiv('pm-change-modal-field pm-change-modal-projects')
    where.createDiv({ cls: 'pm-change-label', text: t('change.library.projects') })
    const chips = where.createDiv('pm-change-modal-chips')
    if (!this.projects.length) chips.createSpan({ cls: 'pm-change-modal-none', text: t('change.library.noProject') })
    for (const project of this.projects) chips.createSpan({ cls: 'pm-docs-chip', text: project.title })
    const edit = chips.createEl('button', { cls: 'pm-change-modal-edit' })
    setIcon(edit.createSpan('pm-change-sheet-icon'), 'folder-kanban')
    edit.createSpan({ text: t('change.library.editProjects') })
    explain(edit, t('change.library.editProjects'), t('tip.change.projects'))
    edit.addEventListener(
      'click',
      safeAsync(() => this.editProjects())
    )

    const who = meta.createDiv('pm-change-modal-field')
    who.createDiv({ cls: 'pm-change-label', text: t('change.owner') })
    const owner = who.createEl('input', { attr: { type: 'text', placeholder: t('change.tasks.ownerPlaceholder') } })
    owner.value = this.task.assignees[0] ?? ''
    const names = new ContactBook(readContacts(this.app, this.plugin.settings.peopleFolder)).names()
    attachComboList(
      owner,
      () => names,
      () => owner.blur()
    )
    owner.addEventListener('change', () => {
      this.task.assignees = owner.value.trim() ? [owner.value.trim()] : []
    })
    const when = meta.createDiv('pm-change-modal-field')
    when.createDiv({ cls: 'pm-change-label', text: t('change.sheet.due') })
    const due = when.createEl('input', { attr: { type: 'date' } })
    due.value = this.task.due
    due.addEventListener('change', () => (this.task.due = due.value))

    renderChangePanel(root, {
      task: this.task,
      projects: this.projects,
      plugin: this.plugin,
      rerender: () => this.render(),
      persist: () => this.plugin.changes.save(this.task)
    })

    const foot = root.createDiv('pm-board-foot pm-change-modal-foot')
    const note = foot.createEl('a', { cls: 'pm-change-modal-note', href: '#', text: t('change.library.openNote') })
    note.addEventListener(
      'click',
      safeAsync(async (event: MouseEvent) => {
        event.preventDefault()
        const file = this.task.filePath ? this.app.vault.getAbstractFileByPath(this.task.filePath) : null
        if (!(file instanceof TFile)) return
        await this.save(false)
        await this.app.workspace.getLeaf('tab').openFile(file)
      })
    )
    foot.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close())
    const save = foot.createEl('button', { cls: 'mod-cta', text: t('library.save') })
    save.addEventListener(
      'click',
      safeAsync(() => this.save(true))
    )
    root.scrollTop = scroll
  }

  /** The projects it belongs to, chosen the way a document's are. */
  private async editProjects(): Promise<void> {
    const record = this.task.filePath ? this.plugin.changes.at(this.task.filePath) : undefined
    if (!record) return
    const answer = await this.plugin.askLibraryProjects({
      heading: t('library.projectsOf', { title: this.task.title }),
      chosen: this.projectPaths,
      confirm: t('library.save')
    })
    if (!answer) return
    await this.plugin.changes.setProjects(record.doc, answer.projects)
    this.projectPaths = answer.projects
    await this.loadProjects()
    this.render()
  }

  private async save(close: boolean): Promise<void> {
    await this.plugin.changes.save(this.task)
    if (close) {
      this.close()
      new Notice(t('change.library.saved', { number: changeOf(this.task).number || this.task.title }))
    }
    await this.onSaved()
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
