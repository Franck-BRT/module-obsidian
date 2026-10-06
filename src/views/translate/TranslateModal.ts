import { Modal, Setting } from 'obsidian'
import type PMPlugin from '../../main'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import { languageLabel, languages } from './languages'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'
import { glossaryPath, openGlossary, translatable, translateDocuments } from './translateDocs'

/** Asks into which language, and with the glossary or not, then translates the documents. */
export function openTranslate(plugin: PMPlugin, docs: LibraryDoc[]): void {
  new TranslateModal(plugin, docs.filter(translatable)).open()
}

class TranslateModal extends Modal {
  private language: string
  private useGlossary = true
  /** A workbook's formulas' texts translated too: asked each time, off unless ticked. */
  private formulaTexts = false

  constructor(
    private plugin: PMPlugin,
    private docs: LibraryDoc[]
  ) {
    super(plugin.app)
    this.language = plugin.settings.translationLanguage || 'fr'
  }

  onOpen(): void {
    this.modalEl.addClass('pm-translate-modal')
    this.setTitle(
      this.docs.length === 1
        ? t('translate.titleOne', { title: this.docs[0].title })
        : t('translate.titleMany', { count: this.docs.length })
    )
    const root = this.contentEl
    root.createEl('p', { cls: 'pm-translate-intro', text: t('translate.intro') })
    if (this.docs.length > 1) {
      const list = root.createEl('ul', { cls: 'pm-translate-list' })
      for (const doc of this.docs) list.createEl('li', { text: doc.title })
    }
    new Setting(root).setName(t('translate.language')).addDropdown((dropdown) => {
      for (const code of languages(this.plugin)) dropdown.addOption(code, languageLabel(code))
      dropdown.setValue(this.language).onChange((value) => {
        this.language = value
      })
    })
    new Setting(root)
      .setName(t('translate.useGlossary'))
      .setDesc(t('translate.glossaryDesc', { path: glossaryPath(this.plugin) }))
      .addToggle((toggle) =>
        toggle.setValue(this.useGlossary).onChange((value) => {
          this.useGlossary = value
        })
      )
      .addButton((button) =>
        button.setButtonText(t('translate.openGlossary')).onClick(
          safeAsync(async () => {
            this.close()
            await openGlossary(this.plugin)
          })
        )
      )
    if (this.docs.some((doc) => /\.xlsx$/i.test(doc.file))) {
      new Setting(root)
        .setName(t('translate.formulaTexts'))
        .setDesc(t('translate.formulaTextsDesc'))
        .addToggle((toggle) =>
          toggle.setValue(this.formulaTexts).onChange((value) => {
            this.formulaTexts = value
          })
        )
    }
    root.createEl('p', { cls: 'pm-translate-note', text: t('translate.limits') })
    new Setting(root)
      .addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(t('translate.go'))
          .setCta()
          .onClick(
            safeAsync(async () => {
              this.plugin.settings.translationLanguage = this.language
              await this.plugin.saveSettings()
              this.close()
              await translateDocuments(this.plugin, this.docs, this.language, {
                useGlossary: this.useGlossary,
                formulaTexts: this.formulaTexts
              })
            })
          )
      )
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
