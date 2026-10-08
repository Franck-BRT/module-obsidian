import { Modal, Notice, Setting, type App } from 'obsidian'
import type { PersonaDraft, PersonaNote } from '../../store/chat/personaLibrary'
import { attachComboList } from '../../ui/comboList'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

export interface PersonaEdit {
  name: string
  draft: PersonaDraft
}

/** A persona written or changed: its name, where it is filed, what it is for, and who it is. */
export class PersonaModal extends Modal {
  private name: string
  private draft: PersonaDraft

  constructor(
    app: App,
    private categories: string[],
    private onSave: (edit: PersonaEdit) => Promise<void>,
    persona?: Pick<PersonaNote, 'name' | 'instructions' | 'category' | 'description' | 'favorite'>,
    private editing = false
  ) {
    super(app)
    this.name = persona?.name ?? ''
    this.draft = {
      category: persona?.category ?? '',
      description: persona?.description ?? '',
      favorite: persona?.favorite ?? false,
      instructions: persona?.instructions ?? ''
    }
  }

  onOpen(): void {
    this.modalEl.addClass('pm-prompt-modal')
    this.setTitle(this.editing ? t('personas.edit') : t('personas.new'))
    const root = this.contentEl
    new Setting(root).setName(t('personas.field.name')).addText((text) => {
      text.setPlaceholder(t('personas.field.namePlaceholder')).setValue(this.name)
      text.onChange((value) => (this.name = value))
      window.setTimeout(() => text.inputEl.focus(), 0)
    })
    new Setting(root)
      .setName(t('personas.field.category'))
      .setDesc(t('personas.field.categoryDesc'))
      .addText((text) => {
        text.setPlaceholder(t('personas.field.categoryPlaceholder')).setValue(this.draft.category)
        text.onChange((value) => (this.draft.category = value))
        attachComboList(
          text.inputEl,
          () => this.categories,
          (value) => (this.draft.category = value)
        )
      })
    new Setting(root).setName(t('personas.field.description')).addText((text) => {
      text.setPlaceholder(t('personas.field.descriptionPlaceholder')).setValue(this.draft.description)
      text.onChange((value) => (this.draft.description = value))
    })
    new Setting(root)
      .setName(t('personas.field.favorite'))
      .setDesc(t('personas.field.favoriteDesc'))
      .addToggle((toggle) => toggle.setValue(this.draft.favorite).onChange((value) => (this.draft.favorite = value)))
    const area = root.createDiv('pm-prompt-question')
    area.createDiv({ cls: 'setting-item-name', text: t('personas.field.instructions') })
    area.createDiv({ cls: 'setting-item-description', text: t('personas.field.instructionsDesc') })
    const box = area.createEl('textarea', {
      cls: 'pm-prompt-question-box',
      attr: { rows: '12', placeholder: t('personas.field.instructionsPlaceholder') }
    })
    box.value = this.draft.instructions
    box.addEventListener('input', () => (this.draft.instructions = box.value))
    const foot = root.createDiv('pm-prompt-foot')
    foot.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close())
    const save = foot.createEl('button', { cls: 'mod-cta', text: t('dialog.save') })
    save.addEventListener(
      'click',
      safeAsync(async () => {
        if (!this.name.trim() || !this.draft.instructions.trim()) {
          new Notice(t('personas.missing'))
          return
        }
        save.disabled = true
        try {
          await this.onSave({ name: this.name.trim(), draft: this.draft })
          this.close()
        } finally {
          save.disabled = false
        }
      })
    )
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
