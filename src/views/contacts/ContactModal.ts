import { Modal, Notice, Setting, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import { ContactBook, readContacts, saveContact, type Contact, type ContactFields } from '../../store/contacts'
import { confirmDialog } from '../../ui/ModalFactory'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

export interface ContactModalOptions {
  /** The contact edited; none for a new one. */
  contact?: Contact
  /** What a new one starts with: a name the projects use, a kind guessed from it. */
  name?: string
  kind?: ContactFields['kind']
  company?: string
  /** Told the note's path once it is saved, or '' once it is deleted. */
  onDone?: (path: string) => void
}

/** A contact made or edited: its name, what it is, how to reach it. */
export function openContactModal(plugin: PMPlugin, options: ContactModalOptions = {}): void {
  new ContactModal(plugin, options).open()
}

class ContactModal extends Modal {
  private name: string
  private fields: ContactFields

  constructor(
    private plugin: PMPlugin,
    private options: ContactModalOptions
  ) {
    super(plugin.app)
    const contact = options.contact
    this.name = contact?.name ?? options.name ?? ''
    this.fields = {
      kind: contact?.kind ?? options.kind ?? 'person',
      company: contact?.company ?? options.company ?? '',
      role: contact?.role ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      lots: [...(contact?.lots ?? [])],
      capacity: contact?.capacity ?? 0
    }
  }

  onOpen(): void {
    this.modalEl.addClass('pm-contact-modal')
    this.setTitle(this.options.contact ? t('contact.edit') : t('contact.new'))
    this.render()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    new Setting(root).setName(t('contact.name')).addText((text) => {
      text.setPlaceholder(t('contact.namePlaceholder')).setValue(this.name)
      text.onChange((value) => {
        this.name = value
      })
      window.setTimeout(() => text.inputEl.focus(), 0)
    })
    new Setting(root).setName(t('contact.kind')).addDropdown((dropdown) =>
      dropdown
        .addOption('person', t('contact.kind.person'))
        .addOption('company', t('contact.kind.company'))
        .setValue(this.fields.kind)
        .onChange((value) => {
          this.fields.kind = value === 'company' ? 'company' : 'person'
          this.render()
        })
    )
    if (this.fields.kind === 'person') {
      new Setting(root).setName(t('contact.company')).addText((text) => {
        text.setPlaceholder(t('contact.companyPlaceholder')).setValue(this.fields.company)
        text.onChange((value) => {
          this.fields.company = value
        })
        const book = new ContactBook(readContacts(this.app, this.plugin.settings.peopleFolder))
        const id = 'pm-contact-companies'
        const list = root.createEl('datalist', { attr: { id } })
        for (const company of book.companies()) list.createEl('option', { value: company.name })
        text.inputEl.setAttr('list', id)
      })
    }
    new Setting(root)
      .setName(this.fields.kind === 'company' ? t('contact.activity') : t('contact.role'))
      .addText((text) =>
        text
          .setPlaceholder(
            this.fields.kind === 'company' ? t('contact.activityPlaceholder') : t('contact.rolePlaceholder')
          )
          .setValue(this.fields.role)
          .onChange((value) => {
            this.fields.role = value
          })
      )
    new Setting(root).setName(t('contact.email')).addText((text) => {
      text.inputEl.type = 'email'
      text
        .setPlaceholder('nom@entreprise.fr')
        .setValue(this.fields.email)
        .onChange((value) => {
          this.fields.email = value
        })
    })
    new Setting(root).setName(t('contact.phone')).addText((text) => {
      text.inputEl.type = 'tel'
      text.setValue(this.fields.phone).onChange((value) => {
        this.fields.phone = value
      })
    })
    new Setting(root)
      .setName(t('contact.lots'))
      .setDesc(t('contact.lotsDesc'))
      .addText((text) =>
        text
          .setPlaceholder(t('contact.lotsPlaceholder'))
          .setValue(this.fields.lots.join(', '))
          .onChange((value) => {
            this.fields.lots = value
              .split(/[,;]/)
              .map((one) => one.trim())
              .filter(Boolean)
          })
      )

    // What a person can give in a week: the load plan sets their work against it.
    if (this.fields.kind === 'person') {
      new Setting(root)
        .setName(t('contact.capacity'))
        .setDesc(t('contact.capacityDesc', { hours: this.plugin.settings.workloadCapacity }))
        .addText((text) => {
          text.inputEl.type = 'number'
          text.inputEl.min = '0'
          text.inputEl.step = '0.5'
          text
            .setPlaceholder(String(this.plugin.settings.workloadCapacity))
            .setValue(this.fields.capacity ? String(this.fields.capacity) : '')
            .onChange((value) => {
              const number = Number(value.replace(',', '.'))
              this.fields.capacity = Number.isFinite(number) && number > 0 ? number : 0
            })
        })
    }

    const foot = new Setting(root)
    const contact = this.options.contact
    if (contact) {
      foot.addButton((button) =>
        button
          .setButtonText(t('contact.delete'))
          .setDestructive()
          .onClick(safeAsync(() => this.remove(contact)))
      )
    }
    foot.addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
    foot.addButton((button) =>
      button
        .setButtonText(t('contact.save'))
        .setCta()
        .onClick(safeAsync(() => this.save()))
    )
  }

  private async save(): Promise<void> {
    const name = this.name.trim()
    if (!name) {
      new Notice(t('contact.nameNeeded'))
      return
    }
    let path: string
    try {
      path = await saveContact(
        this.app,
        this.plugin.settings.peopleFolder,
        this.options.contact?.path ?? null,
        name,
        this.fields
      )
    } catch (error) {
      new Notice(
        error instanceof Error && error.message === 'exists'
          ? t('contact.exists', { name })
          : error instanceof Error
            ? error.message
            : t('contact.nameNeeded')
      )
      return
    }
    this.close()
    this.options.onDone?.(path)
  }

  private async remove(contact: Contact): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(contact.path)
    if (!(file instanceof TFile)) return
    const ok = await confirmDialog(this.app, t('contact.deleteConfirm', { name: contact.name }), t('common.delete'))
    if (!ok) return
    await this.app.fileManager.trashFile(file)
    this.close()
    this.options.onDone?.('')
  }
}
