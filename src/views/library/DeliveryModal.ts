import { Modal, Notice, Setting, TFile, normalizePath, type App, type TextComponent } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { documentOf, isDocument } from '../../store/Document'
import {
  byReference,
  deliveryDocument,
  deliveryNote,
  deliveryRows,
  deliveryValues,
  fieldOf,
  fillDeliveryTemplate,
  isRowField,
  nextDeliveryNumber,
  type DeliveryContext,
  type DeliveryField,
  type DeliveryValues
} from '../../store/delivery'
import { DocxTemplateError, fillDocxTemplate } from '../../store/docxTemplate'
import { flattenTasks } from '../../store/TaskTreeOps'
import {
  deliveryTemplateFile,
  deliveryTemplateText,
  deliveryWordBytes,
  deliveryWordFile,
  deliveryWords,
  ensureDeliveryTemplate,
  ensureDeliveryWord,
  openTemplate
} from './deliveryTemplates'
import { buildDocx, type DocxDocument } from '../../store/docx'
import { buildPdf } from '../../store/pdf'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { formatDateLetter, today } from '../../dates'
import { displayName, safeAsync, sanitizeFileName } from '../../utils'
import { t } from '../../i18n'
import { docStateLabel } from './docStateLabel'
import { ContactBook, readContacts } from '../../store/contacts'
import { contactLabel, projectPeople } from '../../store/projectPeople'
import { PersonPicker } from '../contacts/PersonPicker'

/** Where a project's delivery notes are kept: a folder of its own beside it. */
function deliveryFolder(project: Project): string {
  const root = folderOf(project.filePath)
  return normalizePath(root ? `${root}/${t('delivery.folder')}` : t('delivery.folder'))
}

/** The numbers the project's delivery notes were given, from their properties. */
function givenNumbers(app: App, folder: string): string[] {
  return app.vault
    .getMarkdownFiles()
    .filter((file) => file.path.startsWith(`${folder}/`))
    .map((file): unknown => app.metadataCache.getFileCache(file)?.frontmatter?.number)
    .filter((number): number is string => typeof number === 'string')
}

function freePath(app: App, folder: string, base: string, ext: string): string {
  let path = normalizePath(`${folder}/${base}.${ext}`)
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} (${n}).${ext}`)
  return path
}

/**
 * A delivery note for a project's documents: which are sent — those ticked in the register,
 * else those it holds a file of —, under which number, when, by whom, to whom; then written
 * as a note, and in Word and PDF, the PDF opened.
 */
export class DeliveryModal extends Modal {
  private chosen: Set<string>
  private number: string
  private date = today().toString()
  private sender: string
  private recipient: string
  private note = ''
  private word = true
  private pdf = true
  private listEl!: HTMLElement
  private goEl: HTMLButtonElement | null = null

  constructor(
    private plugin: PMPlugin,
    private project: Project,
    private documents: Task[],
    picked: Set<string>
  ) {
    super(plugin.app)
    // In the order the note lists them: by reference, then by title.
    this.documents = documents
      .filter(isDocument)
      .sort((a, b) => byReference({ ...documentOf(a), title: a.title }, { ...documentOf(b), title: b.title }))
    const ticked = this.documents.filter((task) => picked.has(task.id))
    const withFile = this.documents.filter((task) => documentOf(task).file)
    this.chosen = new Set((ticked.length ? ticked : withFile).map((task) => task.id))
    this.number = nextDeliveryNumber(givenNumbers(plugin.app, deliveryFolder(project)), this.date.slice(0, 4))
    this.sender = displayName(project.teamMembers[0] ?? plugin.settings.globalTeamMembers[0] ?? '')
    // The recipient the documents chosen share, when they share one.
    const recipients = new Set(
      this.documents
        .filter((task) => this.chosen.has(task.id))
        .map((task) => documentOf(task).recipient.trim())
        .filter(Boolean)
    )
    this.recipient = recipients.size === 1 ? [...recipients][0] : ''
  }

  onOpen(): void {
    this.setTitle(t('delivery.modalTitle', { project: this.project.title }))
    this.modalEl.addClass('pm-delivery-modal')
    const root = this.contentEl
    new Setting(root)
      .setName(t('delivery.numberField'))
      .addText((text) => text.setValue(this.number).onChange((value) => (this.number = value.trim())))
    new Setting(root).setName(t('delivery.dateField')).addText((text) => {
      text.inputEl.type = 'date'
      text.setValue(this.date).onChange((value) => (this.date = value || today().toString()))
    })
    this.personField(root, t('delivery.senderField'), this.sender, (value) => (this.sender = value))
    this.personField(root, t('delivery.recipientField'), this.recipient, (value) => (this.recipient = value))
    new Setting(root).setName(t('delivery.noteField')).addTextArea((area) => {
      area.setPlaceholder(t('delivery.notePlaceholder')).onChange((value) => (this.note = value))
      area.inputEl.rows = 2
    })
    const head = root.createDiv('pm-delivery-head')
    head.createSpan({ cls: 'pm-delivery-head-title', text: t('delivery.documents') })
    const all = head.createEl('a', { href: '#', text: t('delivery.toggleAll') })
    all.addEventListener('click', (event) => {
      event.preventDefault()
      const every = this.documents.every((task) => this.chosen.has(task.id))
      this.chosen = every ? new Set() : new Set(this.documents.map((task) => task.id))
      this.renderList()
    })
    this.listEl = root.createDiv('pm-delivery-list')
    new Setting(root)
      .setName(t('delivery.word'))
      .setDesc(t('delivery.formats'))
      .addToggle((toggle) => toggle.setValue(this.word).onChange((value) => (this.word = value)))
    new Setting(root)
      .setName(t('delivery.pdf'))
      .addToggle((toggle) => toggle.setValue(this.pdf).onChange((value) => (this.pdf = value)))
    this.renderTemplates(root.createDiv('pm-delivery-templates'))
    new Setting(root)
      .addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((button) => {
        this.goEl = button.buttonEl
        button.setCta().onClick(safeAsync(() => this.write()))
      })
    this.renderList()
  }

  /** Which templates the note and the Word are written from, each to change from here. */
  private renderTemplates(box: HTMLElement): void {
    box.empty()
    const line = (label: string, current: string, action: string, run: () => Promise<void>): void => {
      const row = box.createDiv('pm-delivery-template')
      row.createSpan({ cls: 'pm-delivery-template-label', text: label })
      row.createSpan({ cls: 'pm-delivery-template-name', text: current })
      const link = row.createEl('a', { href: '#', text: action })
      link.addEventListener(
        'click',
        safeAsync(async (event: MouseEvent) => {
          event.preventDefault()
          await run()
        })
      )
    }
    const note = deliveryTemplateFile(this.plugin)
    line(
      t('delivery.templateNote'),
      note ? note.basename : t('delivery.templateShipped'),
      note ? t('delivery.templateEdit') : t('delivery.templateCustomize'),
      async () => {
        const file = await ensureDeliveryTemplate(this.plugin)
        this.close()
        await openTemplate(this.plugin, file)
      }
    )
    const word = deliveryWordFile(this.plugin)
    line(
      t('delivery.templateWord'),
      word ? word.name : t('delivery.templateWordNone'),
      word ? t('delivery.templateWordOpen') : t('delivery.templateWordCreate'),
      async () => {
        const file = await ensureDeliveryWord(this.plugin)
        if (!(await openTemplate(this.plugin, file))) new Notice(t('delivery.templateWordWhere', { path: file.path }))
        this.renderTemplates(box)
      }
    )
  }

  /** A field for someone, written by hand or found in the people folder — the project's own first. */
  private personField(root: HTMLElement, name: string, value: string, set: (value: string) => void): void {
    let input: TextComponent | null = null
    new Setting(root)
      .setName(name)
      .addText((text) => {
        input = text
        text.setValue(value).onChange(set)
      })
      .addExtraButton((button) =>
        button
          .setIcon('book-user')
          .setTooltip(t('person.pick'))
          .onClick(() => {
            const book = new ContactBook(readContacts(this.app, this.plugin.settings.peopleFolder))
            new PersonPicker(this.app, book, projectPeople(book, this.project), (choice) => {
              const label = choice.contact ? contactLabel(choice.contact) : choice.name
              input?.setValue(label)
              set(label)
            }).open()
          })
      )
  }

  private renderList(): void {
    this.listEl.empty()
    for (const task of this.documents) {
      const [row] = deliveryRows([task])
      if (!row) continue
      const line = this.listEl.createEl('label', { cls: 'pm-delivery-row' })
      const box = line.createEl('input', { attr: { type: 'checkbox' } })
      box.checked = this.chosen.has(task.id)
      box.addEventListener('change', () => {
        if (box.checked) this.chosen.add(task.id)
        else this.chosen.delete(task.id)
        this.renderCount()
      })
      line.createSpan({ cls: 'pm-delivery-ref', text: row.reference || '—' })
      line.createSpan({ cls: 'pm-delivery-title', text: row.title })
      line.createSpan({
        cls: 'pm-delivery-meta',
        text: [docStateLabel(row.state), row.version].filter(Boolean).join(' · ')
      })
    }
    this.renderCount()
  }

  private renderCount(): void {
    if (!this.goEl) return
    const count = this.documents.filter((task) => this.chosen.has(task.id)).length
    this.goEl.setText(t('delivery.write', { count }))
    this.goEl.disabled = count === 0
  }

  private async write(): Promise<void> {
    const tasks = this.documents.filter((task) => this.chosen.has(task.id))
    if (!tasks.length) {
      new Notice(t('view.bordereauEmpty'))
      return
    }
    const rows = deliveryRows(tasks, this.lotOf())
    const words = deliveryWords()
    const number = this.number || nextDeliveryNumber([], this.date.slice(0, 4))
    const context: DeliveryContext & { isoDate: string } = {
      project: this.project.title,
      number,
      date: formatDateLetter(this.date),
      isoDate: this.date,
      sender: this.sender.trim(),
      recipient: this.recipient.trim(),
      note: this.note
    }
    const values = deliveryValues(rows, context, words)
    const filled = fillDeliveryTemplate(await deliveryTemplateText(this.plugin), values)
    const folder = deliveryFolder(this.project)
    await ensureFolder(this.app, folder)
    const base = sanitizeFileName(`${number} ${this.project.title}`).trim()
    const document = deliveryDocument(filled, context, words)
    const files: string[] = []
    if (this.word) {
      const path = freePath(this.app, folder, base, 'docx')
      await this.app.vault.createBinary(path, (await this.wordOf(document, values)).slice().buffer)
      files.push(path)
    }
    let pdf = ''
    if (this.pdf) {
      pdf = freePath(this.app, folder, base, 'pdf')
      await this.app.vault.createBinary(pdf, buildPdf(document).slice().buffer)
      files.push(pdf)
    }
    const note = freePath(this.app, folder, base, 'md')
    await this.app.vault.create(note, deliveryNote(filled, context, rows.length, files))
    this.close()
    new Notice(t('view.bordereauCreated', { path: note }))
    const opened = this.app.vault.getAbstractFileByPath(pdf || note)
    if (opened instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(opened)
  }

  /** The Word: the reader's own filled, when they set one; else written from the note. */
  private async wordOf(document: DocxDocument, values: DeliveryValues): Promise<Uint8Array> {
    const bytes = await deliveryWordBytes(this.plugin)
    if (bytes) {
      try {
        return await fillDocxTemplate(bytes, {
          fieldOf: (name) => fieldOf(name),
          isRowField: (field) => isRowField(field as DeliveryField),
          ...values
        })
      } catch (error) {
        const reason = error instanceof DocxTemplateError ? error.message : String(error)
        new Notice(t('delivery.wordTemplateFailed', { reason }))
      }
    }
    return buildDocx(document)
  }

  /** The lot each document sits in: the top of its branch, when that is a lot. */
  private lotOf(): (task: Task) => string {
    const parents = new Map<string, string | null>()
    const byId = new Map<string, Task>()
    for (const { task, parentId } of flattenTasks(this.project.tasks)) {
      parents.set(task.id, parentId)
      byId.set(task.id, task)
    }
    return (task) => {
      let id: string | null | undefined = task.id
      let top: Task | undefined
      for (let guard = 0; id && guard < 64; guard++) {
        top = byId.get(id)
        id = parents.get(id)
      }
      return top && top.id !== task.id && top.type === 'phase' ? top.title : ''
    }
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
