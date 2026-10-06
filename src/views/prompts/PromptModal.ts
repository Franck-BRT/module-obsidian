import { Modal, Notice, Setting, type App } from 'obsidian'
import { SCOPE_ORDER, type PromptScope } from '../../store/chat/chatPrompts'
import type { PromptDraft, PromptNote } from '../../store/chat/promptLibrary'
import { scopeWord } from '../chat/chatPresets'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

/** What a question is about, said in full for the list it is picked from. */
export function scopeChoice(scope: PromptScope): string {
  switch (scope) {
    case 'any':
      return t('prompts.about.any')
    case 'project':
      return t('prompts.about.project')
    case 'note':
      return t('prompts.about.note')
    case 'requirements':
      return t('prompts.about.requirements')
    case 'file':
      return t('prompts.about.file')
    case 'planning':
      return t('prompts.about.planning')
    case 'selection':
      return t('prompts.about.selection')
  }
}

export interface PromptEdit {
  name: string
  draft: PromptDraft
}

/** A prompt written or changed: its name, what it is about, where it is filed, and the question. */
export class PromptModal extends Modal {
  private name: string
  private draft: PromptDraft

  constructor(
    app: App,
    private categories: string[],
    private onSave: (edit: PromptEdit) => Promise<void>,
    prompt?: Pick<PromptNote, 'name' | 'question' | 'scope' | 'category' | 'description' | 'favorite'>,
    private editing = false
  ) {
    super(app)
    this.name = prompt?.name ?? ''
    const scope = prompt?.scope ?? 'any'
    this.draft = {
      scope,
      scopeWord: scopeWord(scope),
      category: prompt?.category ?? '',
      description: prompt?.description ?? '',
      favorite: prompt?.favorite ?? false,
      question: prompt?.question ?? ''
    }
  }

  onOpen(): void {
    this.modalEl.addClass('pm-prompt-modal')
    this.setTitle(this.editing ? t('prompts.edit') : t('prompts.new'))
    const root = this.contentEl
    new Setting(root).setName(t('prompts.field.name')).addText((text) => {
      text.setPlaceholder(t('prompts.field.namePlaceholder')).setValue(this.name)
      text.onChange((value) => (this.name = value))
      window.setTimeout(() => text.inputEl.focus(), 0)
    })
    new Setting(root)
      .setName(t('prompts.field.category'))
      .setDesc(t('prompts.field.categoryDesc'))
      .addText((text) => {
        text.setPlaceholder(t('prompts.field.categoryPlaceholder')).setValue(this.draft.category)
        text.onChange((value) => (this.draft.category = value))
        // The categories in use, offered as they are typed.
        const list = root.createEl('datalist', { attr: { id: 'pm-prompt-categories' } })
        for (const category of this.categories) list.createEl('option', { attr: { value: category } })
        text.inputEl.setAttr('list', 'pm-prompt-categories')
      })
    new Setting(root)
      .setName(t('prompts.field.about'))
      .setDesc(t('prompts.field.aboutDesc'))
      .addDropdown((dropdown) => {
        for (const scope of [...SCOPE_ORDER].reverse()) dropdown.addOption(scope, scopeChoice(scope))
        dropdown.setValue(this.draft.scope)
        dropdown.onChange((value) => {
          this.draft.scope = value as PromptScope
          this.draft.scopeWord = scopeWord(this.draft.scope)
        })
      })
    new Setting(root).setName(t('prompts.field.description')).addText((text) => {
      text.setPlaceholder(t('prompts.field.descriptionPlaceholder')).setValue(this.draft.description)
      text.onChange((value) => (this.draft.description = value))
    })
    new Setting(root)
      .setName(t('prompts.field.favorite'))
      .setDesc(t('prompts.field.favoriteDesc'))
      .addToggle((toggle) => toggle.setValue(this.draft.favorite).onChange((value) => (this.draft.favorite = value)))
    const area = root.createDiv('pm-prompt-question')
    area.createDiv({ cls: 'setting-item-name', text: t('prompts.field.question') })
    area.createDiv({ cls: 'setting-item-description', text: t('prompts.field.questionDesc') })
    const box = area.createEl('textarea', {
      cls: 'pm-prompt-question-box',
      attr: { rows: '10', placeholder: t('prompts.field.questionPlaceholder') }
    })
    box.value = this.draft.question
    box.addEventListener('input', () => (this.draft.question = box.value))
    const foot = root.createDiv('pm-prompt-foot')
    foot.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close())
    const save = foot.createEl('button', { cls: 'mod-cta', text: t('dialog.save') })
    save.addEventListener(
      'click',
      safeAsync(async () => {
        if (!this.name.trim() || !this.draft.question.trim()) {
          new Notice(t('prompts.missing'))
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
