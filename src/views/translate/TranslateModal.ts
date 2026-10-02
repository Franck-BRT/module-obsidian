import { Modal, Setting } from 'obsidian'
import type PMPlugin from '../../main'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import { languageName } from '../../store/requirements/translate'
import { reqLanguages } from '../requirements/reqPalette'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'
import { glossaryPath, openGlossary, translatable, translateDocuments } from './translateDocs'

/** The languages offered: the usual ones, and those the requirements are kept in. */
function languages(plugin: PMPlugin): string[] {
  return [...new Set(['fr', 'en', 'de', 'es', 'it', 'pt', 'nl', ...reqLanguages(plugin.settings)])]
}

/** A language's name for the reader. */
function languageLabel(code: string): string {
  switch (code) {
    case 'fr':
      return t('translate.lang.fr')
    case 'en':
      return t('translate.lang.en')
    case 'de':
      return t('translate.lang.de')
    case 'es':
      return t('translate.lang.es')
    case 'it':
      return t('translate.lang.it')
    case 'pt':
      return t('translate.lang.pt')
    case 'nl':
      return t('translate.lang.nl')
    default:
      return languageName(code)
  }
}

/** Asks into which language, and with the glossary or not, then translates the documents. */
export function openTranslate(plugin: PMPlugin, docs: LibraryDoc[]): void {
  new TranslateModal(plugin, docs.filter(translatable)).open()
}

class TranslateModal extends Modal {
  private language: string
  private useGlossary = true

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
              await translateDocuments(this.plugin, this.docs, this.language, this.useGlossary)
            })
          )
      )
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
