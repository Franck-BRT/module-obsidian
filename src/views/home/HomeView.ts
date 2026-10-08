import { ItemView, type WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../../main'
import { readContacts } from '../../store/contacts'
import { isPromptNote } from '../../store/chat/promptLibrary'
import { isPersonaNote } from '../../store/chat/personaLibrary'
import { openProjectCreate } from '../../ui/ModalFactory'
import { t } from '../../i18n'
import { safeAsync } from '../../utils'
import { renderHome, type HomeCounts } from './homePage'

export const PM_HOME_VIEW_TYPE = 'pm-home'

/** The home page, in a tab: the counts drawn again whenever it is come back to. */
export class HomeView extends ItemView {
  private redrawTimer: number | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
  }

  getViewType(): string {
    return PM_HOME_VIEW_TYPE
  }

  getDisplayText(): string {
    return t('home.title')
  }

  getIcon(): string {
    return 'house'
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    this.contentEl.addClass('pm-root', 'pm-home-root')
    this.render()
    // Projects appearing or going, documents read, the page brought back to the front.
    this.register(this.plugin.index.onChange(() => this.renderSoon()))
    this.register(this.plugin.libraryText.onChange(() => this.renderSoon()))
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf) this.renderSoon()
      })
    )
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    return Promise.resolve()
  }

  private renderSoon(): void {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    this.redrawTimer = window.setTimeout(() => {
      this.redrawTimer = null
      this.render()
    }, 300)
  }

  private counts(): HomeCounts {
    const plugin = this.plugin
    const docs = plugin.library.docs()
    return {
      projects: plugin.index.rootRefs().length,
      contacts: readContacts(this.app, plugin.settings.peopleFolder).length,
      documents: docs.length,
      documentsRead: plugin.libraryText.counts(docs).read,
      notes: plugin.notes.files().length,
      requirements: plugin.index.requirementRefs().length,
      prompts: this.app.vault
        .getMarkdownFiles()
        .filter((file) => isPromptNote(this.app.metadataCache.getFileCache(file)?.frontmatter)).length,
      personas: this.app.vault
        .getMarkdownFiles()
        .filter((file) => isPersonaNote(this.app.metadataCache.getFileCache(file)?.frontmatter)).length
    }
  }

  private render(): void {
    const plugin = this.plugin
    renderHome(this.contentEl, this.counts(), {
      projects: safeAsync(() => plugin.router.openDashboard()),
      chat: safeAsync(() => plugin.openChat()),
      contacts: safeAsync(() => plugin.openContacts()),
      documents: safeAsync(() => plugin.openDocuments()),
      notes: safeAsync(() => plugin.openNotes()),
      requirements: safeAsync(() => plugin.openRequirements()),
      prompts: safeAsync(() => plugin.openPrompts()),
      personas: safeAsync(() => plugin.openPersonas()),
      settings: () => plugin.openSettings(),
      newProject: () => openProjectCreate(plugin),
      newNote: safeAsync(() => plugin.newInboxNote())
    })
  }
}
