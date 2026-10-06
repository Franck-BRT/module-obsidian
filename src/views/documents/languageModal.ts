import { Modal, Setting, type App } from 'obsidian'
import { t } from '../../i18n'

export interface LanguageRow {
  /** What the language is asked for: a document's title. */
  label: string
  value: string
  /** Said under it: that it was guessed from the text, say. */
  note?: string
}

/** The language of one document or of several, each picked from the list, or said to be unknown. */
export class LanguagesModal extends Modal {
  private values: string[]

  constructor(
    app: App,
    private heading: string,
    private rows: LanguageRow[],
    private options: [string, string][],
    private onDone: (values: string[]) => void,
    private confirm = t('dialog.save')
  ) {
    super(app)
    this.values = rows.map((row) => row.value)
  }

  onOpen(): void {
    this.setTitle(this.heading)
    this.rows.forEach((row, at) => {
      const setting = new Setting(this.contentEl).setName(row.label)
      if (row.note) setting.setDesc(row.note)
      setting.addDropdown((dropdown) => {
        dropdown.addOption('', t('library.langUnknown'))
        for (const [code, label] of this.options) dropdown.addOption(code, label)
        dropdown.setValue(this.values[at]).onChange((value) => (this.values[at] = value))
      })
    })
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(this.confirm)
          .setCta()
          .onClick(() => {
            this.close()
            this.onDone(this.values)
          })
      )
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
