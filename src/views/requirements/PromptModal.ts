import { Modal, Notice, type App } from 'obsidian'
import type PMPlugin from '../../main'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'
import { promptDef, type PromptKey } from './promptDefs'

/**
 * An instruction, opened where it is used.
 *
 * The settings page is where a preference is set once; this is for the other half of the
 * job — reading a poor answer, seeing why the instruction produced it, changing a line
 * and asking again against the very requirement in front of you. Sending somebody to the
 * settings for that means losing the requirement, the answer and the thought.
 *
 * Which is why the second button exists: save and ask again, in one gesture, without
 * leaving the requirement.
 */
class PromptModal extends Modal {
  private draft: string

  constructor(
    app: App,
    private plugin: PMPlugin,
    private key: PromptKey,
    private onSaved: ((rerun: boolean) => void) | undefined
  ) {
    super(app)
    this.draft = plugin.settings.requirements[key]
  }

  onOpen(): void {
    const def = promptDef(this.key)
    const { contentEl } = this
    contentEl.empty()
    this.modalEl.addClass('pm-modal', 'pm-req-prompt-modal')
    contentEl.createEl('h2', { text: def.label() })
    contentEl.createDiv({ cls: 'pm-req-prompt-desc', text: def.desc() })

    const keys = contentEl.createDiv('pm-req-prompt-keys')
    keys.createSpan({ cls: 'pm-req-rev', text: t('settings.req.promptKeys') })
    for (const placeholder of def.keys) {
      const chip = keys.createSpan({ cls: 'pm-req-prompt-key', text: `{${placeholder}}` })
      // Inserted at the cursor rather than copied: the reader is writing a sentence, and
      // hunting for the right spelling of a placeholder is not part of writing it.
      chip.addEventListener('click', () => this.insert(`{${placeholder}}`))
    }

    this.area = contentEl.createEl('textarea', { cls: 'pm-req-prompt-area', attr: { rows: '16' } })
    this.area.value = this.draft
    this.area.placeholder = def.fallback
    this.area.addEventListener('input', () => {
      this.draft = this.area.value
    })

    const actions = contentEl.createDiv('pm-te-actions')
    const load = actions.createEl('button', { text: t('settings.req.promptLoad') })
    load.addEventListener('click', () => {
      this.draft = def.fallback
      this.area.value = def.fallback
    })
    const clear = actions.createEl('button', { text: t('settings.req.promptClear') })
    clear.addEventListener('click', () => {
      this.draft = ''
      this.area.value = ''
    })
    const spacer = actions.createDiv('pm-req-prompt-spacer')
    spacer.setText('')
    const cancel = actions.createEl('button', { text: t('common.cancel') })
    cancel.addEventListener('click', () => this.close())
    if (this.onSaved) {
      const again = actions.createEl('button', { text: t('req.promptSaveRun') })
      again.addEventListener(
        'click',
        safeAsync(() => this.save(true))
      )
    }
    const save = actions.createEl('button', { cls: 'mod-cta', text: t('req.promptSave') })
    save.addEventListener(
      'click',
      safeAsync(() => this.save(false))
    )
  }

  private area!: HTMLTextAreaElement

  private insert(text: string): void {
    const at = this.area.selectionStart
    const end = this.area.selectionEnd
    this.area.value = `${this.area.value.slice(0, at)}${text}${this.area.value.slice(end)}`
    this.draft = this.area.value
    this.area.focus()
    this.area.setSelectionRange(at + text.length, at + text.length)
  }

  private async save(rerun: boolean): Promise<void> {
    this.plugin.settings.requirements[this.key] = this.draft
    await this.plugin.saveSettings()
    this.close()
    new Notice(this.draft.trim() ? t('req.promptSaved') : t('req.promptCleared'))
    this.onSaved?.(rerun)
  }
}

/**
 * Opens an instruction for editing.
 *
 * `onSaved` is what makes the second button appear: a caller with something to re-run
 * offers it, and one without simply does not.
 */
export function openPromptModal(plugin: PMPlugin, key: PromptKey, onSaved?: (rerun: boolean) => void): void {
  new PromptModal(plugin.app, plugin, key, onSaved).open()
}
