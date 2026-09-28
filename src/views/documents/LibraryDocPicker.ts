import { SuggestModal, setIcon, type App } from 'obsidian'
import { snippet } from '../../store/library/docText'
import { FAMILY_ICONS, familyOf, matchesDoc, type LibraryDoc } from '../../store/library/libraryDoc'
import { t } from '../../i18n'

/**
 * A document of the library, chosen by a few words: its title, its file's name, its
 * projects, or what it says — the passage where the words are shown under it, so the
 * right issue of a planning is told from the one before.
 */
export class LibraryDocPicker extends SuggestModal<LibraryDoc> {
  private words: string[] = []

  constructor(
    app: App,
    private docs: LibraryDoc[],
    private projectTitle: (path: string) => string,
    private content: (doc: LibraryDoc) => string,
    private onChoose: (doc: LibraryDoc) => void,
    private text: (doc: LibraryDoc) => string = () => ''
  ) {
    super(app)
    this.setPlaceholder(t('chat.libraryPick'))
    this.limit = 100
  }

  getSuggestions(query: string): LibraryDoc[] {
    this.words = query.split(/\s+/).filter(Boolean)
    return this.docs.filter((doc) =>
      matchesDoc(doc, { text: query, project: '', family: '' }, this.projectTitle, this.content)
    )
  }

  renderSuggestion(doc: LibraryDoc, el: HTMLElement): void {
    el.addClass('pm-docs-pick')
    const line = el.createDiv('pm-docs-pick-line')
    const family = familyOf(doc.file || doc.title)
    setIcon(line.createSpan({ cls: `pm-docs-pick-icon pm-docs-icon--${family}` }), FAMILY_ICONS[family])
    line.createSpan({ cls: 'pm-docs-pick-title', text: doc.title })
    const detail = [doc.file.slice(doc.file.lastIndexOf('/') + 1), ...doc.projects.map(this.projectTitle)].join(' · ')
    el.createEl('small', { cls: 'pm-docs-pick-detail', text: detail })
    const found = this.words.length ? snippet(this.text(doc), this.words, this.content(doc), 60) : null
    if (found) {
      const passage = el.createDiv('pm-docs-pick-snippet')
      if (found.before) passage.appendText('… ')
      for (const part of found.parts) {
        if (part.hit) passage.createEl('mark', { text: part.text })
        else passage.appendText(part.text)
      }
      if (found.after) passage.appendText(' …')
    }
  }

  onChooseSuggestion(doc: LibraryDoc): void {
    this.onChoose(doc)
  }
}
