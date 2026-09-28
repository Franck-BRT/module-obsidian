import { Modal, Setting, type App } from 'obsidian'
import type { PromptParam } from '../../store/chat/promptParams'
import { t } from '../../i18n'

/**
 * The blanks of a ready question, asked for before it is sent.
 *
 * One field a blank, of the kind it takes: a date picker for a date, the people the vault
 * knows for a person, the library's languages for a language, the list it gives for a
 * choice, a line of text otherwise. Enter sends, Escape gives up.
 */
export function askParams(
  app: App,
  title: string,
  params: PromptParam[],
  lists: { people: string[]; languages: string[] }
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => new ParamModal(app, title, params, lists, resolve).open())
}

class ParamModal extends Modal {
  private values: Record<string, string> = {}
  private done = false

  constructor(
    app: App,
    private heading: string,
    private params: PromptParam[],
    private lists: { people: string[]; languages: string[] },
    private resolve: (values: Record<string, string> | null) => void
  ) {
    super(app)
  }

  onOpen(): void {
    this.setTitle(this.heading)
    this.modalEl.addClass('pm-param-modal')
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    let first: HTMLElement | null = null
    for (const param of this.params) {
      const setting = new Setting(this.contentEl).setName(param.label || t('chat.paramChoose'))
      const list =
        param.kind === 'person'
          ? this.lists.people
          : param.kind === 'language'
            ? this.lists.languages
            : param.kind === 'choice'
              ? param.choices
              : []
      if (list.length) {
        this.values[param.raw] = list[0]
        setting.addDropdown((dropdown) => {
          for (const entry of list) dropdown.addOption(entry, entry)
          dropdown.setValue(list[0]).onChange((value) => {
            this.values[param.raw] = value
          })
          first ??= dropdown.selectEl
        })
        continue
      }
      setting.addText((text) => {
        if (param.kind === 'date') {
          text.inputEl.type = 'date'
          text.setValue(iso)
          this.values[param.raw] = iso
        }
        text.onChange((value) => {
          this.values[param.raw] = value
        })
        text.inputEl.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault()
            this.submit()
          }
        })
        first ??= text.inputEl
      })
    }
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(t('chat.send'))
        .setCta()
        .onClick(() => this.submit())
    )
    window.setTimeout(() => first?.focus(), 0)
  }

  /** Sent once every blank has something in it; the empty ones are pointed out. */
  private submit(): void {
    const missing = this.params.filter((param) => !this.values[param.raw]?.trim())
    if (missing.length) {
      this.contentEl.querySelector('.pm-param-missing')?.remove()
      this.contentEl.createDiv({
        cls: 'pm-param-missing',
        text: t('chat.paramMissing', { list: missing.map((param) => param.label || '…').join(', ') })
      })
      return
    }
    this.done = true
    this.resolve(this.values)
    this.close()
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.done) this.resolve(null)
  }
}
