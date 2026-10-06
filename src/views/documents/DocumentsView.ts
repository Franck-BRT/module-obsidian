import {
  ButtonComponent,
  ExtraButtonComponent,
  ItemView,
  Menu,
  Modal,
  Notice,
  Setting,
  setIcon,
  TFile,
  TFolder,
  type ViewStateResult,
  type WorkspaceLeaf
} from 'obsidian'
import type PMPlugin from '../../main'
import { formatBytes } from '../../store/email/EmailMessage'
import { openDocumentFile } from '../../store/DocumentStore'
import {
  collectionNames,
  DOC_FAMILIES,
  FAMILY_ICONS,
  familyOf,
  matchesDoc,
  NO_PROJECT,
  NO_VALUE,
  otherLanguages,
  revealQuery,
  sortDocs,
  type DocFamily,
  type DocQuery,
  type DocSort,
  type LibraryDoc
} from '../../store/library/libraryDoc'
import { versionKey } from '../../store/library/docVersions'
import { LibraryDocPicker } from './LibraryDocPicker'
import type { PourItem } from '../../store/library/DocLibrary'
import { snippet } from '../../store/library/docText'
import { AT_ROOT, inFolder } from '../../store/folderFilter'
import type { LibraryGhost } from '../../store/library/libraryGhost'
import {
  missingRegisterFiles,
  registerEntries,
  registerFilesOutside,
  type MissingRegisterFile,
  type RegisterEntry
} from '../../store/library/libraryRegister'
import { fileNameOf, findVaultFile } from '../../store/library/DocLibrary'
import { detectLanguage } from '../../store/library/docLanguage'
import { renderFlag } from '../../ui/flags'
import { languageLabel, languages } from '../translate/languages'
import { LanguagesModal } from './languageModal'
import { documentOf } from '../../store/Document'
import { confirmDialog, openTaskModal, promptText } from '../../ui/ModalFactory'
import { docStateLabel } from '../library/docStateLabel'
import { fileInRegister } from './registerActions'
import { proposeRegisterMatches } from './matchRegister'
import { pourRegisterFiles } from './pourRegisters'
import type { Project } from '../../types'
import { knownValues } from '../../store/library/libraryClass'
import { formatDate } from '../../dates'
import { openTranslate } from '../translate/TranslateModal'
import { translatable } from '../translate/translateDocs'
import { explain } from '../../ui/explain'
import { t } from '../../i18n'
import { safeAsync } from '../../utils'
import { ragDocState, type RagDocState } from './ragState'
import { CollectionsModal } from './collections'
import {
  dragRows,
  filteredFolder,
  FolderPicker,
  folderOptions,
  renderFolderStrip,
  type FolderChoice
} from '../folderUi'

export const PM_DOCUMENTS_VIEW_TYPE = 'pm-documents'

/** Rows drawn at first; the rest follow on demand, so a library of thousands opens at once. */
const PAGE = 200

/**
 * The document library: every document poured into it, found again by a few words, by
 * project or by kind.
 *
 * Files are poured in by dropping them on the view or choosing them from the computer;
 * each is asked which projects it belongs to — none, one or several — and can be told
 * otherwise later. A document is opened by its title; its record, where notes about it
 * can be written, from its menu.
 */
/** How long one page may take before the library says it is slow: models read a page in a minute or two. */
const SLOW_PAGE_SECONDS = 300

const RAG_ICON: Record<RagDocState, string> = {
  indexed: 'database',
  stale: 'refresh-cw',
  missing: 'database-zap',
  excluded: 'circle-slash'
}

function ragLabel(state: RagDocState): string {
  switch (state) {
    case 'indexed':
      return t('library.rag.indexed')
    case 'stale':
      return t('library.rag.stale')
    case 'missing':
      return t('library.rag.missing')
    case 'excluded':
      return t('library.rag.excluded')
  }
}

function ragTip(state: RagDocState, passages: number): string {
  switch (state) {
    case 'indexed':
      return t('tip.library.rag.indexed', { count: passages })
    case 'stale':
      return t('tip.library.rag.stale')
    case 'missing':
      return t('tip.library.rag.missing')
    case 'excluded':
      return t('tip.library.rag.excluded')
  }
}

export class DocumentsView extends ItemView {
  private query: DocQuery = { text: '', project: '', family: '' }
  /** Only the documents whose text is not there to search, with why. */
  private onlyUnread = false
  /** Documents just poured, or found already there, picked out for a moment. */
  private fresh = new Set<string>()
  /** The language guessed from each document's text, by its fingerprint: guessed once. */
  private detected = new Map<string, string>()
  /** The folders each document has a ghost in, by its record: drawn on its line. */
  private ghostFolders = new Map<string, string[]>()
  private freshTimer: number | null = null
  private sort: DocSort = 'added'
  /** Whether the finer filters — kind, category, lot, issuer, tag — are shown. */
  private moreFilters = false
  private shown = PAGE
  private toolbarEl!: HTMLElement
  private filtersEl!: HTMLElement
  private bodyEl!: HTMLElement
  private redrawTimer: number | null = null
  /** Where the time spent on the page being read is said, while one is. */
  private scanElapsedEl: HTMLElement | null = null
  private textTimer: number | null = null
  /** The documents ticked, by their records, to be asked about together. */
  private picked = new Set<string>()
  /** Where each file is followed in the projects' registers, once they have been read. */
  private followed = new Map<string, RegisterEntry[]>()
  /** The projects whose registers were read, to tell what they hold that the library lacks. */
  private registers: Project[] = []

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
  }

  getViewType(): string {
    return PM_DOCUMENTS_VIEW_TYPE
  }

  getDisplayText(): string {
    return t('library.title')
  }

  getIcon(): string {
    return 'library-big'
  }

  /** The project filter, remembered with the workspace and set by whoever opens the view. */
  getState(): Record<string, unknown> {
    return this.query.project ? { project: this.query.project } : {}
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const project = (state as { project?: unknown } | null)?.project
    this.query = { ...this.query, project: typeof project === 'string' ? project : '' }
    this.shown = PAGE
    if (this.filtersEl) {
      this.renderFilters()
      this.renderBody()
    }
    await super.setState(state, result)
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root', 'pm-docs')
    this.toolbarEl = root.createDiv('pm-toolbar')
    this.filtersEl = root.createDiv('pm-docs-filters')
    this.bodyEl = root.createDiv('pm-content pm-docs-body')
    this.renderToolbar()
    this.renderFilters()
    this.renderBody()

    // A record written, changed, moved or thrown away redraws the list — whoever did it.
    const later = (): void => this.redrawSoon()
    this.registerEvent(this.app.metadataCache.on('changed', later))
    this.registerEvent(this.app.vault.on('delete', later))
    this.registerEvent(this.app.vault.on('rename', later))
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFolder && file.path.startsWith(`${this.plugin.library.root}/`)) later()
      })
    )
    this.register(this.plugin.index.onChange(later))
    // What the documents say, read in the background: the list follows as it comes in.
    this.register(this.plugin.libraryText.onChange(() => this.textSoon()))
    // The scans being read: the document at its page, those waiting, how the last one ended.
    this.register(this.plugin.scans.onChange(() => this.textSoon()))
    this.register(this.plugin.scanProgress.onChange(() => this.textSoon()))
    void this.plugin.scanProgress.ready().then(() => this.textSoon())
    this.registerInterval(window.setInterval(() => this.tickScan(), 1000))
    void this.plugin.libraryText.refresh(this.plugin.library.docs())
    void this.loadRegister()
    // The vault index, where it is on: which documents it holds, said beside their projects.
    this.register(this.plugin.ragIndexer.onChange(() => this.textSoon()))
    if (this.plugin.settings.rag.enabled) {
      void this.plugin.ragIndex.load(this.plugin.settings.llm.modelEmbed.trim()).then(() => this.textSoon())
    }

    this.registerDomEvent(this.containerEl, 'dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      this.contentEl.addClass('pm-docs--drop')
    })
    this.registerDomEvent(this.containerEl, 'dragleave', (event) => {
      if (!this.containerEl.contains(event.relatedTarget as Node | null)) this.contentEl.removeClass('pm-docs--drop')
    })
    this.registerDomEvent(this.containerEl, 'drop', (event) => {
      this.contentEl.removeClass('pm-docs--drop')
      const dropped = event.dataTransfer?.files
      if (!dropped?.length) return
      event.preventDefault()
      void this.pourFiles(Array.from(dropped))
    })
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    if (this.textTimer !== null) window.clearTimeout(this.textTimer)
    return Promise.resolve()
  }

  private redrawSoon(): void {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    this.redrawTimer = window.setTimeout(() => {
      this.redrawTimer = null
      this.renderToolbar()
      // A folder made, renamed or thrown away elsewhere is offered, or no longer.
      this.renderFilters()
      this.renderBody()
      // A document come in, or changed, has its text read.
      void this.plugin.libraryText.refresh(this.plugin.library.docs())
      void this.loadRegister()
    }, 300)
  }

  /** The projects' registers, read for the files they follow; the list drawn again after. */
  private async loadRegister(): Promise<void> {
    const paths = this.plugin.index
      .projectRefs()
      .filter((ref) => !ref.template && !ref.program)
      .map((ref) => ref.path)
    this.registers = await this.plugin.store.loadProjects(paths)
    this.followed = registerEntries(this.registers)
    this.renderBody()
  }

  /**
   * The list drawn again as texts come in — at most a few times a second, so a long reading
   * shows its progress without redrawing a thousand rows for every document.
   */
  private textSoon(): void {
    if (this.textTimer !== null) return
    this.textTimer = window.setTimeout(() => {
      this.textTimer = null
      this.renderBody()
    }, 400)
  }

  private renderToolbar(): void {
    this.toolbarEl.empty()
    const left = this.toolbarEl.createDiv('pm-toolbar-left')
    left.createEl('h2', { cls: 'pm-toolbar-title', text: t('library.title') })
    const count = this.plugin.library.docs().length
    if (count) left.createSpan({ cls: 'pm-docs-count', text: t('library.count', { count }) })
    // Nothing to search or filter until something has been poured in.
    this.filtersEl.toggleClass('is-hidden', !count)
    const right = this.toolbarEl.createDiv('pm-toolbar-right')
    const folder = new ButtonComponent(right)
      .setButtonText(t('folders.newFolder'))
      .setIcon('folder-plus')
      .onClick(safeAsync(() => this.newFolder()))
    explain(folder.buttonEl, t('folders.newFolder'), t('tip.library.newFolder'))
    const pour = new ButtonComponent(right)
      .setButtonText(t('library.pour'))
      .setIcon('upload')
      .setCta()
      .onClick(() => this.pickFromComputer())
    explain(pour.buttonEl, t('library.pour'), t('tip.library.pour'))
  }

  private renderFilters(): void {
    // Drawn again while a search is being typed — a folder made elsewhere —: the typing goes on.
    const typing = this.filtersEl.querySelector<HTMLInputElement>('.pm-docs-search')
    const focused = !!typing && typing.ownerDocument.activeElement === typing
    const caret = typing?.selectionStart ?? null
    this.filtersEl.empty()
    const search = this.filtersEl.createEl('input', {
      cls: 'pm-docs-search',
      attr: { type: 'search', placeholder: t('library.search') }
    })
    search.value = this.query.text
    search.addEventListener('input', () => {
      this.query = { ...this.query, text: search.value }
      this.shown = PAGE
      this.renderBody()
    })
    if (focused) {
      search.focus()
      if (caret !== null) search.setSelectionRange(caret, caret)
    }

    const select = (
      parent: HTMLElement,
      options: [string, string][],
      value: string,
      onChange: (value: string) => void,
      filter = true
    ): void => {
      const el = parent.createEl('select', { cls: 'dropdown pm-docs-select' })
      for (const [key, label] of options) el.createEl('option', { value: key, text: label })
      el.value = value
      // A filter that is on says so; the order the list is in is no filter.
      if (filter && value) el.addClass('is-set')
      el.addEventListener('change', () => onChange(el.value))
    }
    const main = this.filtersEl

    const projects = this.projectOptions()
    // A project the filter names but the vault no longer has is still offered, so the
    // filter can be seen and taken off.
    if (this.query.project && this.query.project !== NO_PROJECT && !projects.some(([p]) => p === this.query.project)) {
      projects.unshift([this.query.project, this.projectTitle(this.query.project)])
    }
    select(
      main,
      [['', t('library.allProjects')], [NO_PROJECT, t('library.noProject')], ...projects],
      this.query.project,
      (project) => {
        this.query = { ...this.query, project }
        this.shown = PAGE
        this.app.workspace.requestSaveLayout()
        this.renderBody()
      }
    )
    // The folders, each under the one it is in; new documents go into the one shown.
    const folders = this.plugin.library.folders()
    if (folders.length || this.query.folder) {
      if (filteredFolder(this.query.folder) && !folders.includes(this.query.folder ?? '')) {
        folders.push(this.query.folder ?? '')
      }
      select(main, folderOptions(folders, t('library.rootFolder')), this.query.folder ?? '', (folder) =>
        this.openFolder(folder)
      )
    }
    // The collections, once there is one: a set of documents shown, and asked, alone.
    const collections = collectionNames(this.plugin.library.docs())
    if (collections.length || this.query.collection) {
      const current = this.query.collection ?? ''
      if (current && !collections.includes(current)) collections.unshift(current)
      select(
        main,
        [['', t('collection.docs.all')], ...collections.map((name): [string, string] => [name, name])],
        current,
        (collection) => {
          this.query = { ...this.query, collection }
          this.shown = PAGE
          this.renderFilters()
          this.renderBody()
        }
      )
    }
    select(
      main,
      [
        ['added', t('library.sortAdded')],
        ['title', t('library.sortTitle')],
        ['category', t('library.sortCategory')]
      ],
      this.sort,
      (sort) => {
        this.sort = sort as DocSort
        this.renderBody()
      },
      false
    )

    // The finer filters, folded away behind one button that says how many are on.
    const set = [this.query.family, this.query.category, this.query.lot, this.query.issuer, this.query.tag].filter(
      Boolean
    ).length
    const toggle = main.createEl('button', {
      cls: `pm-docs-more-filters${this.moreFilters ? ' is-open' : ''}${set ? ' is-set' : ''}`,
      attr: { 'aria-expanded': String(this.moreFilters) }
    })
    setIcon(toggle.createSpan({ cls: 'pm-docs-more-filters-icon' }), 'sliders-horizontal')
    toggle.createSpan({ text: set ? t('library.moreFiltersSet', { count: set }) : t('library.moreFilters') })
    toggle.addEventListener('click', () => {
      this.moreFilters = !this.moreFilters
      this.renderFilters()
    })
    explain(toggle, t('library.moreFilters'), t('tip.library.moreFilters'))
    if (!this.moreFilters) return
    const more = main.createDiv('pm-docs-filters-more')
    select(
      more,
      [
        ['', t('library.allKinds')],
        ...DOC_FAMILIES.map((family): [string, string] => [family, t(`library.kind.${family}`)])
      ],
      this.query.family,
      (family) => {
        this.query = { ...this.query, family: family as DocFamily | '' }
        this.shown = PAGE
        this.renderFilters()
        this.renderBody()
      }
    )
    // How the documents are filed: a filter a field, once the library holds a value for it.
    const docs = this.plugin.library.docs()
    const field = (key: 'category' | 'lot' | 'issuer', all: string, none: string): void => {
      const values = knownValues(docs, key)
      const current = this.query[key] ?? ''
      if (!values.length && !current) return
      if (current && current !== NO_VALUE && !values.includes(current)) values.unshift(current)
      select(
        more,
        [['', all], [NO_VALUE, none], ...values.map((value): [string, string] => [value, value])],
        current,
        (chosen) => {
          this.query = { ...this.query, [key]: chosen }
          this.shown = PAGE
          this.renderFilters()
          this.renderBody()
        }
      )
    }
    field('category', t('library.allCategories'), t('library.noCategory'))
    field('lot', t('library.allLots'), t('library.noLot'))
    field('issuer', t('library.allIssuers'), t('library.noIssuer'))
    const tags = knownValues(docs, 'tags')
    if (tags.length || this.query.tag) {
      const current = this.query.tag ?? ''
      if (current && !tags.includes(current)) tags.unshift(current)
      select(
        more,
        [['', t('library.allTags')], ...tags.map((tag): [string, string] => [tag, `#${tag}`])],
        current,
        (chosen) => {
          this.query = { ...this.query, tag: chosen }
          this.shown = PAGE
          this.renderFilters()
          this.renderBody()
        }
      )
    }
    if (set) {
      const clear = more.createEl('a', { cls: 'pm-docs-clear-filters', href: '#', text: t('library.clearFilters') })
      clear.addEventListener('click', (event) => {
        event.preventDefault()
        this.query = { ...this.query, family: '', category: '', lot: '', issuer: '', tag: '' }
        this.shown = PAGE
        this.renderFilters()
        this.renderBody()
      })
    }
  }

  /** Shows a folder — '' for every folder, `AT_ROOT` for the root alone. */
  private openFolder(folder: string): void {
    this.query = { ...this.query, folder }
    this.shown = PAGE
    this.renderFilters()
    this.renderBody()
  }

  private projectOptions(): [string, string][] {
    return this.plugin.libraryProjects().map((project): [string, string] => [project.path, project.title])
  }

  /** Its versions, said on its line: the issue it follows, and the one that followed it. */
  private renderVersions(meta: HTMLElement, doc: LibraryDoc): void {
    const all = this.plugin.library.docs()
    const before = doc.previous ? all.find((one) => one.record === doc.previous) : undefined
    const after = all.find((one) => one.previous === doc.record)
    if (before) {
      meta.createSpan({ cls: 'pm-docs-version', text: t('library.versionAfter', { title: before.title }) })
    }
    if (after) {
      meta.createSpan({
        cls: 'pm-docs-version pm-docs-version--old',
        text: t('library.versionBefore', { title: after.title })
      })
    }
    // The same document in its other languages: a flag each, which opens it.
    const others = otherLanguages(doc, all)
    if (others.length) {
      const langs = meta.createSpan({ cls: 'pm-docs-langs' })
      langs.createSpan({ text: t('library.alsoInLanguages') })
      for (const other of others) {
        const code = this.languageOf(other)
        const chip = langs.createEl('a', { cls: 'pm-docs-lang', href: '#' })
        if (code) renderFlag(chip, code)
        chip.createSpan({ text: code ? code.toUpperCase() : '?' })
        explain(chip, other.title, code ? languageLabel(code) : t('library.langUnknown'))
        chip.addEventListener('click', (event) => {
          event.preventDefault()
          void this.openDoc(other)
        })
      }
    }
  }

  /** The language a document is in: said in its record, else guessed from its text. */
  private languageOf(doc: LibraryDoc): string {
    if (doc.language) return doc.language
    return this.guessedLanguage(doc)
  }

  private guessedLanguage(doc: LibraryDoc): string {
    if (!doc.hash) return ''
    let code = this.detected.get(doc.hash)
    if (code === undefined) {
      const text = this.plugin.libraryText.entry(doc)?.text ?? ''
      code = text ? detectLanguage(text) : ''
      // Not kept while the text is not read: it may be, a moment later.
      if (text) this.detected.set(doc.hash, code)
    }
    return code
  }

  /** Its language's flag before its title — guessed or said —, which changes it at a click. */
  private renderLanguageFlag(parent: HTMLElement, doc: LibraryDoc): void {
    const code = this.languageOf(doc)
    if (!code) return
    const flag = renderFlag(parent, code)
    flag.addClass('pm-docs-flag')
    if (!doc.language) flag.addClass('is-guessed')
    explain(flag, languageLabel(code), doc.language ? t('library.langSaid') : t('library.langGuessed'))
    flag.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      this.chooseLanguage(doc)
    })
  }

  /** The language of a document, picked: kept in its record. */
  private chooseLanguage(doc: LibraryDoc): void {
    const guessed = this.guessedLanguage(doc)
    new LanguagesModal(
      this.app,
      t('library.langTitle'),
      [
        {
          label: doc.title,
          value: doc.language ?? guessed,
          note:
            !doc.language && guessed ? t('library.langGuessedNote', { language: languageLabel(guessed) }) : undefined
        }
      ],
      this.languageOptions(),
      safeAsync(async ([code]: string[]) => {
        await this.plugin.library.setLanguage(doc, code)
        this.redrawSoon()
      })
    ).open()
  }

  private languageOptions(): [string, string][] {
    return languages(this.plugin).map((code): [string, string] => [code, languageLabel(code)])
  }

  /**
   * The same document in another language, picked among the others — those of the same
   * name first —, then each one's language said; linked as one document in two languages.
   */
  private pickOtherLanguage(doc: LibraryDoc): void {
    const all = this.plugin.library.docs()
    const linked = new Set(otherLanguages(doc, all).map((one) => one.record))
    const key = versionKey(doc.title)
    const candidates = sortDocs(
      all.filter((one) => one.record !== doc.record && !linked.has(one.record)),
      'added'
    )
    const alike = (one: LibraryDoc): boolean => !!key && versionKey(one.title) === key
    const texts = this.plugin.libraryText
    new LibraryDocPicker(
      this.app,
      [...candidates.filter(alike), ...candidates.filter((one) => !alike(one))],
      (path) => this.projectTitle(path),
      (each) => texts.folded(each),
      (other) => {
        const guess = (one: LibraryDoc): string => one.language ?? this.guessedLanguage(one)
        new LanguagesModal(
          this.app,
          t('library.langLinkTitle'),
          [
            { label: doc.title, value: guess(doc) },
            { label: other.title, value: guess(other) }
          ],
          this.languageOptions(),
          safeAsync(async ([mine, theirs]: string[]) => {
            if (!mine || !theirs || mine === theirs) {
              new Notice(t('library.langLinkNeedsTwo'))
              return
            }
            await this.plugin.library.linkLanguages(doc, other, mine, theirs)
            new Notice(
              t('library.langLinked', {
                title: doc.title,
                other: other.title,
                language: languageLabel(theirs)
              })
            )
            this.redrawSoon()
          }),
          t('library.langLink')
        ).open()
      }
    ).open()
  }

  /**
   * The document a document is the new issue of, picked among the others — those known
   * by the same name first —, and linked to it as its version.
   */
  private pickPrevious(doc: LibraryDoc): void {
    const key = versionKey(doc.title) || versionKey(doc.file.slice(doc.file.lastIndexOf('/') + 1))
    const others = sortDocs(
      this.plugin.library.docs().filter((one) => one.record !== doc.record),
      'added'
    )
    const alike = (one: LibraryDoc): boolean => !!key && versionKey(one.title) === key
    const texts = this.plugin.libraryText
    new LibraryDocPicker(
      this.app,
      [...others.filter(alike), ...others.filter((one) => !alike(one))],
      (path) => this.projectTitle(path),
      (one) => texts.folded(one),
      safeAsync(async (chosen: LibraryDoc) => {
        await this.plugin.library.setPrevious(doc, chosen)
        new Notice(t('library.versionLinked', { title: doc.title, previous: chosen.title }), 8000)
      }),
      (one) => texts.entry(one)?.text ?? ''
    ).open()
  }

  private projectTitle(path: string): string {
    return this.plugin.index.projectRef(path)?.title ?? path.replace(/^.*\//, '').replace(/\.md$/, '')
  }

  private renderBody(): void {
    this.bodyEl.empty()
    const all = this.plugin.library.docs()
    if (!all.length) {
      this.renderEmpty()
      return
    }
    renderFolderStrip(this.bodyEl, {
      folders: this.plugin.library.folders(),
      current: this.query.folder ?? '',
      open: (folder) => this.openFolder(folder),
      drop: (records, folder) => {
        const moved = all.filter((doc) => records.includes(doc.record))
        void this.moveDocs(moved, folder)
      },
      rename: (folder) => {
        void this.renameFolder(folder)
      },
      remove: (folder) => {
        void this.deleteFolder(folder)
      }
    })
    const texts = this.plugin.libraryText
    if (this.onlyUnread && !all.some((doc) => texts.unreadReason(doc))) this.onlyUnread = false
    const found = sortDocs(
      all.filter(
        (doc) =>
          matchesDoc(
            doc,
            this.query,
            (path) => this.projectTitle(path),
            (each) => texts.folded(each)
          ) &&
          (!this.onlyUnread || texts.unreadReason(doc) !== null)
      ),
      this.sort
    )
    // Ghosts: documents shown in a folder they are not in. Only in a folder chosen — every
    // folder at once shows the documents themselves.
    const ghosts = this.plugin.library.ghosts(all)
    this.ghostFolders = new Map()
    for (const { ghost, doc } of ghosts) {
      if (doc) this.ghostFolders.set(doc.record, [...(this.ghostFolders.get(doc.record) ?? []), ghost.folder])
    }
    const searching = !!this.query.text.trim()
    const ghostsHere = this.query.folder
      ? ghosts.filter(
          ({ ghost, doc }) =>
            !!doc &&
            inFolder(ghost.folder, this.query.folder, searching) &&
            matchesDoc(
              doc,
              { ...this.query, folder: '' },
              (path) => this.projectTitle(path),
              (each) => texts.folded(each)
            ) &&
            (!this.onlyUnread || texts.unreadReason(doc) !== null)
        )
      : []
    // A ticked document no longer in the library is no longer ticked.
    const records = new Set(all.map((doc) => doc.record))
    for (const record of this.picked) if (!records.has(record)) this.picked.delete(record)
    const summary = this.bodyEl.createDiv('pm-docs-summary')
    const counts = summary.createSpan('pm-docs-summary-left')
    // Everything found, ticked or unticked at once: a search, then a question about all of it.
    const withFile = found.filter((doc) => doc.file)
    if (withFile.length) {
      const every = counts.createEl('input', {
        cls: 'pm-docs-pick-all',
        attr: { type: 'checkbox', 'aria-label': t('library.pickAll') }
      })
      const ticked = withFile.filter((doc) => this.picked.has(doc.record)).length
      every.checked = ticked === withFile.length
      every.indeterminate = ticked > 0 && ticked < withFile.length
      every.addEventListener('change', () => {
        for (const doc of withFile) {
          if (every.checked) this.picked.add(doc.record)
          else this.picked.delete(doc.record)
        }
        this.renderBody()
      })
    }
    counts.createSpan({
      text:
        found.length === all.length
          ? t('library.count', { count: all.length })
          : t('library.found', { count: found.length, total: all.length })
    })
    this.renderTextStatus(summary, all)
    if (this.onlyUnread) this.renderUnread(all)
    this.renderScanQueue()
    this.renderRegistersOutside(all)
    if (this.picked.size) this.renderPickedBar(all)
    if (!found.length && ghostsHere.length) {
      const list = this.bodyEl.createDiv('pm-docs-list')
      for (const entry of ghostsHere) if (entry.doc) this.renderGhostRow(list, entry.ghost, entry.doc)
      return
    }
    if (!found.length) {
      // A folder that holds only folders says so: its documents are in them, one click away.
      const folder = filteredFolder(this.query.folder)
      const below = folder
        ? all.filter(
            (doc) =>
              doc.folder.startsWith(`${folder}/`) &&
              matchesDoc(
                doc,
                { ...this.query, folder: '' },
                (path) => this.projectTitle(path),
                (each) => texts.folded(each)
              )
          ).length
        : 0
      this.bodyEl.createDiv({
        cls: 'pm-docs-none',
        text: below ? t('library.onlyInSubfolders', { count: below }) : t('library.nothingFound')
      })
      return
    }
    const list = this.bodyEl.createDiv('pm-docs-list')
    for (const doc of found.slice(0, this.shown)) this.renderRow(list, doc)
    for (const entry of ghostsHere) if (entry.doc) this.renderGhostRow(list, entry.ghost, entry.doc)
    if (found.length > this.shown) {
      new ButtonComponent(this.bodyEl.createDiv('pm-docs-more'))
        .setButtonText(t('library.showMore', { count: Math.min(PAGE, found.length - this.shown) }))
        .onClick(() => {
          this.shown += PAGE
          this.renderBody()
        })
    }
  }

  /**
   * The registers' documents the library does not have yet — those whose file is there to
   * pour — and, apart, those whose file cannot be found, which no pour can bring in.
   */
  private renderRegistersOutside(all: LibraryDoc[]): void {
    const inLibrary = new Set(all.map((doc) => doc.file.normalize('NFC')))
    const exists = (path: string): boolean => findVaultFile(this.app, path) !== null
    const outside = registerFilesOutside(this.registers, inLibrary, false).filter((entry) => exists(entry.file)).length
    if (outside) {
      const line = this.bodyEl.createDiv('pm-docs-outside')
      line.createSpan({ text: t('library.registersOutside', { count: outside }) })
      const link = line.createEl('a', { href: '#', text: t('library.registersPourLink') })
      link.addEventListener('click', (event) => {
        event.preventDefault()
        void pourRegisterFiles(this.plugin).then(() => this.loadRegister())
      })
    }
    const missing = missingRegisterFiles(this.registers, exists)
    if (missing.length) {
      const line = this.bodyEl.createDiv('pm-docs-outside is-missing')
      line.createSpan({ text: t('library.registersMissing', { count: missing.length }) })
      const link = line.createEl('a', { href: '#', text: t('library.registersMissingLink') })
      link.addEventListener('click', (event) => {
        event.preventDefault()
        new MissingFilesModal(this.plugin, missing, () => this.loadRegister()).open()
      })
    }
  }

  /** What is ticked, and what can be done with it: asked about in the chat, or let go. */
  private renderPickedBar(all: LibraryDoc[]): void {
    const picked = all.filter((doc) => this.picked.has(doc.record) && doc.file)
    const bar = this.bodyEl.createDiv('pm-docs-picked')
    bar.createSpan({ cls: 'pm-docs-picked-count', text: t('library.picked', { count: picked.length }) })
    const tipped = (button: ButtonComponent, title: string, help: string): void => explain(button.buttonEl, title, help)
    const ask = new ButtonComponent(bar)
      .setButtonText(t('library.askChat'))
      .setIcon('messages-square')
      .setCta()
      .onClick(
        safeAsync(async () => {
          await this.plugin.chatAboutDocuments(picked.map((doc) => doc.file))
        })
      )
    tipped(ask, t('library.askChat'), t('tip.library.askChat'))
    tipped(
      new ButtonComponent(bar)
        .setButtonText(t('library.classify'))
        .setIcon('tags')
        .onClick(safeAsync(() => this.plugin.classifyDocuments(all.filter((doc) => this.picked.has(doc.record))))),
      t('library.classify'),
      t('tip.library.classify')
    )
    tipped(
      new ButtonComponent(bar)
        .setButtonText(t('collection.docs.button'))
        .setIcon('library')
        .onClick(() =>
          new CollectionsModal(
            this.plugin,
            all.filter((doc) => this.picked.has(doc.record)),
            () => this.redrawSoon()
          ).open()
        ),
      t('collection.docs.button'),
      t('tip.library.collections')
    )
    tipped(
      new ButtonComponent(bar)
        .setButtonText(t('folders.moveTo'))
        .setIcon('folder-input')
        .onClick(() => this.moveToFolder(all.filter((doc) => this.picked.has(doc.record)))),
      t('folders.moveTo'),
      t('tip.library.moveTo')
    )
    const match = new ButtonComponent(bar)
      .setButtonText(t('library.matchPicked'))
      .setIcon('clipboard-list')
      .onClick(
        safeAsync(async () => {
          await proposeRegisterMatches(this.plugin, picked, true)
          await this.loadRegister()
        })
      )
    tipped(match, t('library.matchPicked'), t('tip.library.match'))
    // The scans among them — a PDF or an image — read by the model; those it read already, read again.
    const scans = picked.filter((doc) => {
      const family = familyOf(doc.file || doc.title)
      return family === 'pdf' || family === 'image'
    })
    if (scans.length) {
      const read = new ButtonComponent(bar)
        .setButtonText(t('library.readPicked', { count: scans.length }))
        .setIcon('scan-text')
        .onClick(
          safeAsync(async () => {
            const again = scans.some((doc) => this.plugin.libraryText.entry(doc)?.ocr === true)
            await this.plugin.askAndReadScans(scans, again)
          })
        )
      tipped(read, t('library.readPicked', { count: scans.length }), t('tip.library.read'))
    }
    const words = picked.filter(translatable)
    if (words.length) {
      tipped(
        new ButtonComponent(bar)
          .setButtonText(t('translate.picked', { count: words.length }))
          .setIcon('languages')
          .onClick(() => openTranslate(this.plugin, words)),
        t('translate.picked', { count: words.length }),
        t('tip.library.translate')
      )
    }
    const ticked = all.filter((doc) => this.picked.has(doc.record))
    tipped(
      new ButtonComponent(bar)
        .setButtonText(t('library.removePicked'))
        .setIcon('trash-2')
        .setDestructive()
        .onClick(() => this.confirmRemoveMany(ticked)),
      t('library.removePicked'),
      t('tip.library.remove')
    )
    tipped(
      new ButtonComponent(bar).setButtonText(t('library.unpick')).onClick(() => {
        this.picked.clear()
        this.renderBody()
      }),
      t('library.unpick'),
      t('tip.library.unpick')
    )
  }

  /** The documents ticked, removed from the library once the reader says so. */
  private confirmRemoveMany(docs: LibraryDoc[]): void {
    if (!docs.length) return
    if (docs.length === 1) {
      this.confirmRemove(docs[0])
      return
    }
    const kept = docs.filter((doc) => this.plugin.library.holdsFile(doc)).length
    new ConfirmModal(
      this.plugin,
      t('library.removeManyTitle', { count: docs.length }),
      [
        kept ? t('library.removeManyFiles', { count: kept }) : '',
        docs.length - kept ? t('library.removeManyRecords', { count: docs.length - kept }) : ''
      ]
        .filter(Boolean)
        .join(' '),
      t('library.remove'),
      true,
      async () => {
        for (const doc of docs) {
          await this.plugin.library.remove(doc)
          this.picked.delete(doc.record)
        }
        new Notice(t('library.removedMany', { count: docs.length }))
        this.renderBody()
      }
    ).open()
  }

  /** How far the reading of what the documents say has got, and the scans left to read. */
  private renderTextStatus(parent: HTMLElement, all: LibraryDoc[]): void {
    const texts = this.plugin.libraryText
    const status = parent.createSpan('pm-docs-text-status')
    const progress = texts.progress
    if (progress?.total) {
      status.createSpan({
        cls: 'pm-docs-reading',
        text: t('library.textReading', { done: progress.done, total: progress.total })
      })
      return
    }
    const counts = texts.counts(all)
    status.createSpan({ text: t('library.textRead', { count: counts.read, total: all.length }) })
    // Those not read: shown alone, each with why and what to do.
    const unread = all.length - counts.read
    if (unread) {
      const toggle = status.createEl('a', {
        cls: 'pm-docs-unread-link',
        href: '#',
        text: this.onlyUnread ? t('library.unreadAll') : t('library.unreadLink', { count: unread })
      })
      explain(toggle, t('library.unreadLink', { count: unread }), t('library.unreadHint'))
      toggle.addEventListener('click', (event) => {
        event.preventDefault()
        this.onlyUnread = !this.onlyUnread
        this.shown = PAGE
        this.renderBody()
      })
    }
    const scans = all.filter((doc) => texts.entry(doc)?.state === 'scan')
    if (scans.length) {
      const link = status.createEl('a', {
        cls: 'pm-docs-scans',
        href: '#',
        text: t('library.scansWaiting', { count: scans.length })
      })
      explain(link, t('library.scansWaiting', { count: scans.length }), t('library.readScansHint'))
      link.addEventListener('click', (event) => {
        event.preventDefault()
        this.confirmReadScans(scans)
      })
    }
  }

  /** Why the documents shown are not read, by reason, with what can be done about each. */
  private renderUnread(all: LibraryDoc[]): void {
    const texts = this.plugin.libraryText
    const box = this.bodyEl.createDiv('pm-docs-unread')
    box.createDiv({ cls: 'pm-docs-unread-title', text: t('library.unreadTitle') })
    const list = box.createEl('ul')
    for (const { reason, docs, formats } of texts.unread(all)) {
      const line = list.createEl('li')
      const count = docs.length
      const shown = formats
        .slice(0, 6)
        .map(([ext, many]) => `.${ext} × ${many}`)
        .join(', ')
      line.createSpan({
        text:
          reason === 'scan'
            ? t('library.unread.scan', { count })
            : reason === 'unsupported'
              ? t('library.unread.unsupported', { count, formats: shown })
              : reason === 'unreadable'
                ? t('library.unread.unreadable', { count })
                : reason === 'empty'
                  ? t('library.unread.empty', { count })
                  : reason === 'missing'
                    ? t('library.unread.missing', { count })
                    : t('library.unread.pending', { count })
      })
      if (reason === 'scan') {
        const act = line.createEl('a', { cls: 'pm-docs-unread-act', href: '#', text: t('library.readScans') })
        act.addEventListener('click', (event) => {
          event.preventDefault()
          this.confirmReadScans(docs)
        })
      } else if (reason === 'unreadable' || reason === 'pending') {
        const act = line.createEl('a', { cls: 'pm-docs-unread-act', href: '#', text: t('library.unreadReread') })
        act.addEventListener(
          'click',
          safeAsync(async (event: MouseEvent) => {
            event.preventDefault()
            for (const doc of docs) await texts.reread(doc)
          })
        )
      }
    }
  }

  private confirmReadScans(scans: LibraryDoc[]): void {
    void this.plugin.askAndReadScans(scans)
  }

  private renderEmpty(): void {
    const empty = this.bodyEl.createDiv('pm-docs-empty')
    setIcon(empty.createDiv('pm-docs-empty-icon'), 'library-big')
    empty.createDiv({ cls: 'pm-docs-empty-title', text: t('library.emptyTitle') })
    empty.createDiv({ cls: 'pm-docs-empty-text', text: t('library.emptyText') })
    const pour = new ButtonComponent(empty)
      .setButtonText(t('library.pour'))
      .setIcon('upload')
      .setCta()
      .onClick(() => this.pickFromComputer())
    explain(pour.buttonEl, t('library.pour'), t('tip.library.pour'))
  }

  private renderRow(list: HTMLElement, doc: LibraryDoc): void {
    const row = list.createDiv('pm-docs-row')
    // Dragged onto a folder: itself, or all that is ticked when it is.
    dragRows(row, () => (this.picked.has(doc.record) ? [...this.picked] : [doc.record]))
    if (!doc.file) row.addClass('is-missing')
    const tick = row.createEl('input', {
      cls: 'pm-docs-tick',
      attr: { type: 'checkbox', 'aria-label': t('library.pickOne', { title: doc.title }) }
    })
    tick.checked = this.picked.has(doc.record)
    tick.disabled = !doc.file
    tick.addEventListener('change', () => {
      if (tick.checked) this.picked.add(doc.record)
      else this.picked.delete(doc.record)
      this.renderBody()
    })
    if (tick.checked) row.addClass('is-picked')
    if (this.fresh.has(doc.record)) row.addClass('is-fresh')
    const family = familyOf(doc.file || doc.title)
    setIcon(row.createDiv({ cls: `pm-docs-icon pm-docs-icon--${family}` }), FAMILY_ICONS[family])

    const main = row.createDiv('pm-docs-main')
    const line = main.createDiv('pm-docs-title-line')
    this.renderReferenceStar(line, doc)
    this.renderLanguageFlag(line, doc)
    const title = line.createEl('a', { cls: 'pm-docs-title', text: doc.title, href: '#' })
    title.addEventListener('click', (event) => {
      event.preventDefault()
      void this.openDoc(doc)
    })
    const meta = main.createDiv('pm-docs-meta')
    // Its folder, when the list shows more than that folder: a click shows only it.
    if (doc.folder && this.query.folder !== doc.folder) {
      const folder = meta.createEl('a', {
        cls: 'pm-docs-folder',
        href: '#',
        text: doc.folder,
        attr: { title: t('library.folderChip', { folder: doc.folder }) }
      })
      folder.addEventListener('click', (event) => {
        event.preventDefault()
        this.query = { ...this.query, folder: doc.folder }
        this.shown = PAGE
        this.renderFilters()
        this.renderBody()
      })
    }
    if (doc.category) meta.createSpan({ cls: 'pm-docs-category', text: doc.category })
    if (doc.file) {
      meta.createSpan({ cls: 'pm-docs-name', text: doc.file.slice(doc.file.lastIndexOf('/') + 1) })
    } else meta.createSpan({ cls: 'pm-docs-lost', text: t('library.fileMissing') })
    if (doc.size) meta.createSpan({ text: formatBytes(doc.size, this.units()) })
    if (doc.added) meta.createSpan({ text: t('library.addedOn', { date: formatDate(doc.added) }) })
    if (doc.lot) meta.createSpan({ text: doc.lot })
    if (doc.issuer) meta.createSpan({ text: t('library.issuedBy', { issuer: doc.issuer }) })
    this.renderVersions(meta, doc)
    this.renderTextState(meta, doc)
    // Shown elsewhere by its ghosts: said, with where.
    const elsewhere = this.ghostFolders.get(doc.record) ?? []
    if (elsewhere.length) {
      const badge = meta.createSpan({
        cls: 'pm-docs-badge is-ghosted',
        text: t('library.alsoIn', { count: elsewhere.length })
      })
      explain(
        badge,
        t('library.alsoIn', { count: elsewhere.length }),
        elsewhere.map((folder) => folder || t('library.rootFolder')).join(' · ')
      )
    }

    // Where the words searched for are in what it says.
    const words = this.query.text.split(/\s+/).filter(Boolean)
    const entry = words.length ? this.plugin.libraryText.entry(doc) : undefined
    const found = entry?.text ? snippet(entry.text, words, this.plugin.libraryText.folded(doc)) : null
    if (found) {
      const line = main.createDiv('pm-docs-snippet')
      if (found.before) line.appendText('… ')
      for (const part of found.parts) {
        if (part.hit) line.createEl('mark', { text: part.text })
        else line.appendText(part.text)
      }
      if (found.after) line.appendText(' …')
    }

    this.renderRegister(main, doc)

    const chips = main.createDiv('pm-docs-projects')
    this.renderRagChip(chips, doc)
    if (!doc.projects.length) chips.createSpan({ cls: 'pm-docs-chip is-none', text: t('library.noProject') })
    for (const path of doc.projects) {
      const chip = chips.createEl('button', { cls: 'pm-docs-chip', text: this.projectTitle(path) })
      explain(chip, this.projectTitle(path), t('library.filterOn', { project: this.projectTitle(path) }))
      chip.addEventListener('click', () => {
        this.query = { ...this.query, project: path }
        this.shown = PAGE
        this.renderFilters()
        this.renderBody()
      })
    }
    // Its collections, each one a filter.
    for (const name of doc.collections ?? []) {
      const chip = chips.createEl('button', { cls: 'pm-docs-chip pm-docs-collection' })
      setIcon(chip.createSpan({ cls: 'pm-docs-rag-icon' }), 'library')
      chip.createSpan({ text: name })
      explain(chip, name, t('collection.docs.filterOn', { name }))
      chip.addEventListener('click', () => {
        this.query = { ...this.query, collection: name }
        this.shown = PAGE
        this.renderFilters()
        this.renderBody()
      })
    }
    // Its tags, each one a filter.
    for (const tag of doc.tags) {
      const chip = chips.createEl('button', { cls: 'pm-docs-chip pm-docs-tag', text: `#${tag}` })
      explain(chip, `#${tag}`, t('library.filterTag', { tag }))
      chip.addEventListener('click', () => {
        this.query = { ...this.query, tag }
        this.shown = PAGE
        this.renderFilters()
        this.renderBody()
      })
    }

    const actions = row.createDiv('pm-docs-actions')
    const projects = new ExtraButtonComponent(actions)
      .setIcon('folder-kanban')
      .onClick(safeAsync(() => this.editProjects(doc)))
    explain(projects.extraSettingsEl, t('library.editProjects'), t('tip.library.projects'))
    const more = new ExtraButtonComponent(actions).setIcon('more-vertical')
    more.extraSettingsEl.addEventListener('click', (event) => this.showMenu(doc, event))
    explain(more.extraSettingsEl, t('library.more'), t('tip.library.more'))
  }

  /** Whether the vault index holds it — what the chat finds it by —, beside its projects. */
  private renderRagChip(chips: HTMLElement, doc: LibraryDoc): void {
    const rag = ragDocState(this.plugin, doc)
    if (!rag) return
    const chip = chips.createSpan({ cls: `pm-docs-chip pm-docs-rag is-${rag.state}` })
    setIcon(chip.createSpan({ cls: 'pm-docs-rag-icon' }), RAG_ICON[rag.state])
    chip.createSpan({ text: ragLabel(rag.state) })
    explain(chip, ragLabel(rag.state), ragTip(rag.state, rag.passages))
  }

  /**
   * Where the document is followed in the registers: the project, its reference, issue and
   * state — or that it is an earlier version there. A click opens the register's ticket.
   */
  private renderRegister(main: HTMLElement, doc: LibraryDoc): void {
    const entries = doc.file ? this.followed.get(doc.file.normalize('NFC')) : undefined
    if (!entries?.length) return
    const line = main.createDiv('pm-docs-register')
    for (const entry of entries) {
      const meta = documentOf(entry.task)
      const text = entry.current
        ? [
            entry.project.title,
            meta.reference || entry.task.title,
            meta.issue && t('library.registerIssue', { issue: meta.issue }),
            docStateLabel(meta.state)
          ]
        : [
            entry.project.title,
            meta.reference || entry.task.title,
            t('library.registerOld', { version: entry.version })
          ]
      const chip = line.createEl('button', {
        cls: `pm-docs-reg${entry.current ? '' : ' is-old'} pm-docs-reg--${meta.state}`
      })
      explain(chip, entry.task.title, t('library.registerOpen', { title: entry.task.title }))
      setIcon(chip.createSpan('pm-docs-reg-icon'), 'clipboard-list')
      chip.createSpan({ text: text.filter(Boolean).join(' · ') })
      chip.addEventListener('click', () =>
        openTaskModal(this.plugin, entry.project, { task: entry.task, onSave: () => this.loadRegister() })
      )
    }
  }

  /**
   * The reading of scans as it goes: the document being read, the page it is at and for
   * how long — a page that takes long is said to — those waiting, and a button that stops
   * it; once done, how the last one ended, until dismissed.
   */
  private renderScanQueue(): void {
    const scans = this.plugin.scans
    this.scanElapsedEl = null
    const current = scans.current
    this.renderScanCut()
    if (!current && !scans.last) return
    const strip = this.bodyEl.createDiv('pm-docs-scan-strip')
    if (current) {
      setIcon(strip.createSpan({ cls: 'pm-docs-scan-icon is-running' }), 'loader')
      strip.createSpan({
        cls: 'pm-docs-scan-text',
        text:
          current.kind === 'translate'
            ? current.total
              ? t('translate.status', { title: current.title, done: current.page, total: current.total })
              : t('translate.starting', { title: current.title })
            : current.total
              ? t('library.scanReadingPage', { title: current.title, page: current.page, total: current.total })
              : t('library.scanStatusStarting', { title: current.title })
      })
      this.scanElapsedEl = strip.createSpan({ cls: 'pm-docs-scan-elapsed' })
      if (scans.waiting.length) {
        strip.createSpan({
          cls: 'pm-docs-scan-waiting',
          text: t('library.scanWaitingCount', { count: scans.waiting.length }),
          attr: { title: scans.waiting.map((job) => job.title).join('\n') }
        })
      }
      const stop = strip.createEl('button', { cls: 'mod-warning', text: t('library.scanStop') })
      explain(stop, t('library.scanStop'), t('tip.library.scanStop'))
      stop.addEventListener('click', () => {
        scans.stop()
        stop.disabled = true
        stop.setText(t('library.scanStopping'))
      })
      this.tickScan()
      return
    }
    const last = scans.last
    if (!last) return
    setIcon(strip.createSpan({ cls: 'pm-docs-scan-icon' }), last.ok ? 'check' : 'circle-alert')
    strip.toggleClass('is-problem', !last.ok)
    strip.createSpan({
      cls: 'pm-docs-scan-text',
      text:
        last.kind === 'translate'
          ? last.ok
            ? t('translate.done', { title: last.title })
            : last.reason === 'stopped'
              ? t('translate.stopped', { title: last.title })
              : t('translate.failed', { title: last.title, reason: last.reason ?? '' })
          : last.ok
            ? t('library.scanDone', { title: last.title })
            : last.reason === 'stopped'
              ? t('library.scanStopped', { title: last.title })
              : t('library.scanFailed', { title: last.title, reason: last.reason ?? '' })
    })
    const close = strip.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('common.close') } })
    setIcon(close, 'x')
    close.addEventListener('click', () => scans.dismiss())
  }

  /**
   * The readings cut short — Obsidian closed in the middle, or the model failing — that are
   * not going on now: each at the page it reached, with the way to go on or give up.
   */
  private renderScanCut(): void {
    const cut = this.plugin.scanProgress.list().filter((entry) => !this.plugin.scans.stateOf(entry.key))
    if (!cut.length) return
    const strip = this.bodyEl.createDiv('pm-docs-scan-strip is-problem')
    setIcon(strip.createSpan({ cls: 'pm-docs-scan-icon' }), 'pause')
    strip.createSpan({
      cls: 'pm-docs-scan-text',
      text:
        cut.length === 1
          ? t('library.scanCutOne', { title: cut[0].title, page: cut[0].parts.length, total: cut[0].total })
          : t('library.scanCutMany', { count: cut.length })
    })
    if (cut.length > 1) strip.setAttr('title', cut.map((entry) => entry.title).join('\n'))
    const go = strip.createEl('button', { cls: 'mod-cta', text: t('library.scanResume') })
    explain(go, t('library.scanResume'), t('tip.library.scanResume'))
    go.addEventListener('click', () => {
      void this.plugin.resumeScans()
    })
    const drop = strip.createEl('button', { text: t('library.scanDrop') })
    explain(drop, t('library.scanDrop'), t('tip.library.scanDrop'))
    drop.addEventListener('click', () => {
      void this.plugin.dropScans()
    })
  }

  /** How long the page being read has taken, said each second; a long one said to be. */
  private tickScan(): void {
    const el = this.scanElapsedEl
    const current = this.plugin.scans.current
    if (!el || !current) return
    const seconds = Math.max(0, Math.floor((Date.now() - current.since) / 1000))
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    el.setText(seconds >= SLOW_PAGE_SECONDS ? t('library.scanSlow', { time }) : t('library.scanElapsed', { time }))
    el.toggleClass('is-slow', seconds >= SLOW_PAGE_SECONDS)
  }

  /** Said when its text could not be read, and offered to a model when it is a scan. */
  private renderTextState(meta: HTMLElement, doc: LibraryDoc): void {
    // Being read, or waiting to be: said before anything else.
    const queued = this.plugin.scans.stateOf(doc.record)
    if (queued) {
      const current = this.plugin.scans.current
      meta.createSpan({
        cls: `pm-docs-badge ${queued === 'reading' ? 'is-reading' : 'is-waiting'}`,
        text:
          queued === 'reading' && current?.total
            ? t('library.scanBadgeReading', { page: current.page, total: current.total })
            : queued === 'reading'
              ? t('library.scanBadgeStarting')
              : t('library.scanBadgeWaiting')
      })
      return
    }
    const entry = this.plugin.libraryText.entry(doc)
    if (!entry || entry.state === 'ok') return
    if (entry.state === 'scan') {
      const badge = meta.createEl('a', { cls: 'pm-docs-badge is-scan', href: '#', text: t('library.scanBadge') })
      explain(badge, t('library.scanBadge'), t('library.scanBadgeHint'))
      badge.addEventListener('click', (event) => {
        event.preventDefault()
        void this.plugin.askAndReadScans([doc])
      })
      return
    }
    meta.createSpan({
      cls: 'pm-docs-badge',
      text: t('library.noText'),
      attr: { title: t(`library.noText.${entry.state}`) }
    })
  }

  /** A ghost: the document it stands for, said to be elsewhere — opened from here, or found there. */
  private renderGhostRow(list: HTMLElement, ghost: LibraryGhost, doc: LibraryDoc): void {
    const row = list.createDiv('pm-docs-row pm-docs-ghost')
    if (this.fresh.has(ghost.record)) row.addClass('is-fresh')
    row.createSpan('pm-docs-tick pm-docs-tick-spacer')
    setIcon(row.createDiv('pm-docs-icon pm-docs-icon--ghost'), 'ghost')
    const main = row.createDiv('pm-docs-main')
    const line = main.createDiv('pm-docs-title-line')
    this.renderReferenceStar(line, doc)
    this.renderLanguageFlag(line, doc)
    const title = line.createEl('a', { cls: 'pm-docs-title', text: doc.title, href: '#' })
    title.addEventListener('click', (event) => {
      event.preventDefault()
      void this.openDoc(doc)
    })
    const meta = main.createDiv('pm-docs-meta')
    const badge = meta.createSpan({ cls: 'pm-docs-badge is-ghost', text: t('library.ghost') })
    explain(badge, t('library.ghost'), t('library.ghostHint'))
    const where = meta.createEl('a', {
      cls: 'pm-docs-folder',
      href: '#',
      text: t('library.ghostIn', { folder: doc.folder || t('library.rootFolder') })
    })
    explain(where, t('library.ghostGo'), t('library.ghostGoHint'))
    where.addEventListener('click', (event) => {
      event.preventDefault()
      this.goToOriginal(doc)
    })
    const actions = row.createDiv('pm-docs-actions')
    const more = new ExtraButtonComponent(actions).setIcon('more-vertical')
    explain(more.extraSettingsEl, t('library.more'), t('library.ghostMenuHint'))
    more.extraSettingsEl.addEventListener('click', (event) => {
      const menu = new Menu()
      menu.addItem((item) =>
        item
          .setTitle(t('library.open'))
          .setIcon('file-search')
          .setDisabled(!doc.file)
          .onClick(safeAsync(() => this.openDoc(doc)))
      )
      menu.addItem((item) =>
        item
          .setTitle(t('library.ghostGo'))
          .setIcon('corner-up-right')
          .onClick(() => this.goToOriginal(doc))
      )
      menu.addSeparator()
      menu.addItem((item) =>
        item
          .setTitle(t('library.ghostRemove'))
          .setIcon('trash-2')
          .onClick(
            safeAsync(async () => {
              await this.plugin.library.removeGhost(ghost)
              new Notice(t('library.ghostRemoved', { title: doc.title }))
              this.redrawSoon()
            })
          )
      )
      menu.showAtMouseEvent(event)
    })
  }

  /** A document of reference — kept in the folder of reference, or one of its folders —, and its ghosts: a yellow star. */
  private renderReferenceStar(parent: HTMLElement, doc: LibraryDoc): void {
    const reference = this.plugin.referenceFolder()
    if (doc.folder !== reference && !doc.folder.startsWith(`${reference}/`)) return
    const star = parent.createSpan({ cls: 'pm-docs-reference-star' })
    setIcon(star, 'star')
    explain(star, t('library.referenceStar'), t('library.referenceStarHint', { reference }))
  }

  /**
   * A document given another title: its record and its file named after it, the registers
   * that follow the file told where it now is.
   */
  private async renameDoc(doc: LibraryDoc): Promise<void> {
    const title = await promptText(this.app, t('library.renameTitle'), t('library.renamePlaceholder'), doc.title)
    if (title === null || title.trim() === doc.title) return
    if (!fileNameOf(title)) {
      new Notice(t('library.renameEmpty'))
      return
    }
    const moves = await this.plugin.library.rename(doc, title)
    const told = await this.plugin.followLibraryMoves(moves)
    const parts = [t('library.renamed', { title: title.replace(/\s+/g, ' ').trim() })]
    if (told) parts.push(t('library.registersFollowed', { count: told }))
    new Notice(parts.join('\n'), told ? 8000 : 4000)
    this.redrawSoon()
  }

  /** The document a ghost stands for, shown in its own folder. */
  private goToOriginal(doc: LibraryDoc): void {
    this.openFolder(doc.folder || AT_ROOT)
    this.reveal([doc.record])
  }

  private showMenu(doc: LibraryDoc, event: MouseEvent): void {
    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle(t('library.open'))
        .setIcon('file-search')
        .setDisabled(!doc.file)
        .onClick(safeAsync(() => this.openDoc(doc)))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('library.renameMenu'))
        .setIcon('pencil')
        .onClick(safeAsync(() => this.renameDoc(doc)))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('library.langMenu'))
        .setIcon('languages')
        .onClick(() => this.chooseLanguage(doc))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('library.langLinkMenu'))
        .setIcon('link')
        .onClick(() => this.pickOtherLanguage(doc))
    )
    if (otherLanguages(doc, this.plugin.library.docs()).length) {
      menu.addItem((item) =>
        item
          .setTitle(t('library.langUnlinkMenu'))
          .setIcon('unlink')
          .onClick(
            safeAsync(async () => {
              await this.plugin.library.unlinkLanguages(doc)
              new Notice(t('library.langUnlinked', { title: doc.title }))
              this.redrawSoon()
            })
          )
      )
    }
    menu.addItem((item) =>
      item
        .setTitle(t('library.registerMenu'))
        .setIcon('clipboard-list')
        .setDisabled(!doc.file)
        .onClick(
          safeAsync(async () => {
            await fileInRegister(this.plugin, doc)
            await this.loadRegister()
          })
        )
    )
    const reference = this.plugin.referenceFolder()
    if (doc.folder !== reference) {
      menu.addItem((item) =>
        item
          .setTitle(t('library.referenceMenu', { reference }))
          .setIcon('ghost')
          .onClick(
            safeAsync(async () => {
              await this.plugin.moveToReference(doc)
              this.renderFilters()
              this.redrawSoon()
            })
          )
      )
    }
    menu.addItem((item) =>
      item
        .setTitle(t('collection.docs.button'))
        .setIcon('library')
        .onClick(() => new CollectionsModal(this.plugin, [doc], () => this.redrawSoon()).open())
    )
    menu.addItem((item) =>
      item
        .setTitle(t('library.askChat'))
        .setIcon('messages-square')
        .setDisabled(!doc.file)
        .onClick(safeAsync(() => this.plugin.chatAboutDocuments([doc.file])))
    )
    // What the document fixes — dates, delays —, proposed as the project's milestones.
    menu.addItem((item) =>
      item
        .setTitle(t('library.deadlines'))
        .setIcon('calendar-clock')
        .setDisabled(!doc.file)
        .onClick(safeAsync(() => this.plugin.chatDeadlines([doc.file])))
    )
    // Its versions: the issue before it, compared or unlinked; another one named as such.
    const previous = doc.previous ? this.plugin.library.docs().find((one) => one.record === doc.previous) : undefined
    if (previous) {
      menu.addItem((item) =>
        item
          .setTitle(t('library.compareWith', { title: previous.title }))
          .setIcon('git-compare')
          .setDisabled(!doc.file || !previous.file)
          .onClick(safeAsync(() => this.plugin.chatCompare(previous.file, doc.file)))
      )
    }
    menu.addItem((item) =>
      item
        .setTitle(t('library.newVersionOf'))
        .setIcon('git-branch-plus')
        .onClick(() => this.pickPrevious(doc))
    )
    if (previous) {
      menu.addItem((item) =>
        item
          .setTitle(t('library.unlinkVersion', { title: previous.title }))
          .setIcon('unlink')
          .onClick(safeAsync(() => this.plugin.library.setPrevious(doc, null)))
      )
    }
    menu.addItem((item) =>
      item
        .setTitle(t('library.openRecord'))
        .setIcon('file-pen-line')
        .onClick(safeAsync(() => this.openRecord(doc)))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('library.editProjects'))
        .setIcon('folder-kanban')
        .onClick(safeAsync(() => this.editProjects(doc)))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('library.classify'))
        .setIcon('tags')
        .onClick(safeAsync(() => this.plugin.classifyDocuments([doc])))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('folders.moveTo'))
        .setIcon('folder-input')
        .onClick(() => this.moveToFolder([doc]))
    )
    const family = familyOf(doc.file || doc.title)
    if (doc.file && (family === 'pdf' || family === 'image')) {
      menu.addItem((item) =>
        item
          .setTitle(t('library.readScan'))
          .setIcon('scan-text')
          .onClick(
            safeAsync(async () => {
              // Read already by the model: read again, the transcription replaced.
              await this.plugin.askAndReadScans([doc], this.plugin.libraryText.entry(doc)?.ocr === true)
            })
          )
      )
    }
    if (translatable(doc)) {
      menu.addItem((item) =>
        item
          .setTitle(t('translate.menu'))
          .setIcon('languages')
          .onClick(() => openTranslate(this.plugin, [doc]))
      )
    }
    if (doc.file) {
      menu.addItem((item) =>
        item
          .setTitle(t('library.reread'))
          .setIcon('refresh-cw')
          .onClick(safeAsync(() => this.plugin.libraryText.reread(doc)))
      )
    }
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle(t('library.remove'))
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(() => this.confirmRemove(doc))
    )
    menu.showAtMouseEvent(event)
  }

  private async openDoc(doc: LibraryDoc): Promise<void> {
    const file = doc.file ? this.app.vault.getAbstractFileByPath(doc.file) : null
    if (!(file instanceof TFile)) {
      new Notice(t('library.fileMissing'))
      return
    }
    if (!(await openDocumentFile(this.app, file))) new Notice(t('library.cannotOpen', { name: file.name }))
  }

  private async openRecord(doc: LibraryDoc): Promise<void> {
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (record instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(record)
  }

  private async editProjects(doc: LibraryDoc): Promise<void> {
    const answer = await this.plugin.askLibraryProjects({
      heading: t('library.projectsOf', { title: doc.title }),
      chosen: doc.projects,
      confirm: t('library.save')
    })
    if (!answer) return
    await this.plugin.library.setProjects(doc, answer.projects)
  }

  private confirmRemove(doc: LibraryDoc): void {
    const keptInLibrary = this.plugin.library.holdsFile(doc)
    new ConfirmModal(
      this.plugin,
      t('library.removeTitle', { title: doc.title }),
      keptInLibrary ? t('library.removeWithFile') : t('library.removeRecordOnly'),
      t('library.remove'),
      true,
      () => this.plugin.library.remove(doc)
    ).open()
  }

  /** Files chosen from the computer, the way the system asks for them. */
  /**
   * Documents just poured, or found already there, shown whatever was filtering them out —
   * another folder, a search, a kind, a collection, the unread alone —, far enough down the
   * list, and picked out for a moment.
   */
  reveal(records: string[], ghosts: string[] = []): void {
    const docs = this.plugin.library.docs().filter((doc) => records.includes(doc.record))
    if (!docs.length && !ghosts.length) return
    const texts = this.plugin.libraryText
    const shows = (doc: LibraryDoc, query: DocQuery): boolean =>
      matchesDoc(
        doc,
        query,
        (path) => this.projectTitle(path),
        (each) => texts.folded(each)
      )
    const query = revealQuery(docs, this.query, shows)
    if (query !== this.query || this.onlyUnread) {
      this.query = query
      this.onlyUnread = false
      this.renderFilters()
    }
    // Far enough down the list for the last of them to be drawn.
    const listed = sortDocs(
      this.plugin.library.docs().filter((doc) => shows(doc, this.query)),
      this.sort
    )
    const last = Math.max(-1, ...listed.map((doc, at) => (records.includes(doc.record) ? at : -1)))
    this.shown = Math.max(PAGE, last + 1)
    this.fresh = new Set([...records, ...ghosts])
    this.renderBody()
    this.bodyEl.querySelector('.pm-docs-row.is-fresh')?.scrollIntoView({ block: 'center' })
    if (this.freshTimer !== null) window.clearTimeout(this.freshTimer)
    this.freshTimer = window.setTimeout(() => {
      this.freshTimer = null
      this.fresh.clear()
      for (const row of Array.from(this.bodyEl.querySelectorAll('.pm-docs-row.is-fresh'))) row.removeClass('is-fresh')
    }, 6000)
  }

  private pickFromComputer(): void {
    const input = createEl('input', { attr: { type: 'file', multiple: 'true' } })
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? [])
      if (files.length) void this.pourFiles(files)
    })
    input.click()
  }

  private async pourFiles(files: File[]): Promise<void> {
    const items: PourItem[] = []
    const unread: string[] = []
    for (const file of files) {
      try {
        items.push({ kind: 'bytes', name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
      } catch {
        // A folder dropped from the computer arrives as an entry that cannot be read.
        unread.push(file.name)
      }
    }
    if (unread.length) new Notice(t('library.unreadable', { list: unread.join(', ') }))
    if (!items.length) return
    const preset = this.query.project && this.query.project !== NO_PROJECT ? [this.query.project] : []
    // Poured while a collection is shown, they go in it unless the reader says otherwise.
    await this.plugin.pourIntoLibrary(
      items,
      preset,
      filteredFolder(this.query.folder),
      this.query.collection ? [this.query.collection] : [],
      // Into a folder chosen — not every folder at once —: a document already elsewhere leaves a ghost.
      !!this.query.folder
    )
  }

  /** A folder made in the one on screen — or at the root —, then shown. */
  private async newFolder(): Promise<void> {
    const under = filteredFolder(this.query.folder)
    const name = await promptText(
      this.app,
      under ? t('folders.newFolderIn', { folder: under }) : t('library.newFolderTitle'),
      t('folders.newFolderPlaceholder')
    )
    if (!name) return
    const made = await this.plugin.library.createFolder(name, under)
    if (!made) return
    this.query = { ...this.query, folder: made }
    this.shown = PAGE
    new Notice(t('folders.folderMade', { folder: made }))
    this.renderToolbar()
    this.renderFilters()
    this.renderBody()
  }

  /** Documents moved into a folder of the library, picked or named — a new name makes it. */
  private moveToFolder(docs: LibraryDoc[]): void {
    if (!docs.length) return
    new FolderPicker(
      this.app,
      this.plugin.library.folders(),
      t('library.rootFolder'),
      safeAsync(async (target: FolderChoice) => {
        const folder = target.kind === 'new' ? await this.plugin.library.createFolder(target.name) : target.path
        if (target.kind === 'new' && !folder) return
        await this.moveDocs(docs, folder)
      })
    ).open()
  }

  /**
   * Documents moved into a folder — '' for the root —, the files the library keeps with
   * them; the registers following those files are told where they now are.
   */
  private async moveDocs(docs: LibraryDoc[], folder: string): Promise<void> {
    if (!docs.length) return
    const moves = new Map<string, string>()
    for (const doc of docs) {
      for (const [from, to] of await this.plugin.library.moveTo(doc, folder)) moves.set(from, to)
    }
    const told = await this.plugin.followLibraryMoves(moves)
    this.picked.clear()
    const parts = [t('library.movedTo', { count: docs.length, folder: folder || t('library.rootFolder') })]
    if (told) parts.push(t('library.registersFollowed', { count: told }))
    new Notice(parts.join('\n'), told ? 8000 : 4000)
    this.renderFilters()
    this.redrawSoon()
  }

  /** A folder renamed where it is; the registers following its files told. */
  private async renameFolder(folder: string): Promise<void> {
    const name = await promptText(
      this.app,
      t('folders.renameTitle', { folder }),
      t('folders.renamePlaceholder'),
      folder.slice(folder.lastIndexOf('/') + 1)
    )
    if (name === null) return
    const renamed = await this.plugin.library.renameFolder(folder, name)
    if (!renamed) {
      new Notice(t('folders.nameTaken', { name: name.trim() }))
      return
    }
    const told = await this.plugin.followLibraryMoves(renamed.moves)
    const parts = [t('folders.renamed', { folder: renamed.folder })]
    if (told) parts.push(t('library.registersFollowed', { count: told }))
    new Notice(parts.join('\n'))
    this.openFolder(renamed.folder)
    this.redrawSoon()
  }

  /** A folder taken out, what it holds going up into the one it is in, after a yes. */
  private async deleteFolder(folder: string): Promise<void> {
    const parent = folder.slice(0, Math.max(0, folder.lastIndexOf('/')))
    const parentName = parent || t('library.rootFolder')
    const yes = await confirmDialog(
      this.app,
      t('folders.deleteConfirm', { folder, parent: parentName }),
      t('folders.deleteAction')
    )
    if (!yes) return
    const moves = await this.plugin.library.deleteFolder(folder)
    const told = await this.plugin.followLibraryMoves(moves)
    const parts = [t('folders.deleted', { folder, parent: parentName })]
    if (told) parts.push(t('library.registersFollowed', { count: told }))
    new Notice(parts.join('\n'))
    this.openFolder(parent || AT_ROOT)
    this.redrawSoon()
  }

  private units(): string[] {
    return [t('unit.bytes'), t('unit.kilobytes'), t('unit.megabytes'), t('unit.gigabytes')]
  }
}

/** A yes or no before something that cannot be taken back, or that takes its time. */
class ConfirmModal extends Modal {
  constructor(
    private plugin: PMPlugin,
    private heading: string,
    private text: string,
    private confirm: string,
    private destructive: boolean,
    private run: () => Promise<void>
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.setTitle(this.heading)
    this.contentEl.createEl('p', { text: this.text })
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((button) =>
        (this.destructive ? button.setDestructive() : button.setCta()).setButtonText(this.confirm).onClick(
          safeAsync(async () => {
            this.close()
            await this.run()
          })
        )
      )
  }

  onClose(): void {
    this.contentEl.empty()
  }
}

/** The register documents whose file cannot be found, each opening its register ticket. */
class MissingFilesModal extends Modal {
  constructor(
    private plugin: PMPlugin,
    private missing: MissingRegisterFile[],
    private onSave: () => Promise<void>
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.setTitle(t('library.missingTitle', { count: this.missing.length }))
    this.modalEl.addClass('pm-docs-chooser')
    this.contentEl.createEl('p', { cls: 'pm-docs-classify-note', text: t('library.missingIntro') })
    const list = this.contentEl.createDiv('pm-docs-chooser-list pm-docs-registers-list')
    for (const entry of this.missing) {
      const row = list.createEl('a', { cls: 'pm-docs-chooser-row pm-docs-missing-row', href: '#' })
      row.createSpan({ cls: 'pm-docs-chooser-title', text: entry.task.title })
      row.createSpan({ cls: 'pm-docs-chooser-detail', text: `${entry.project.title} · ${entry.file}` })
      row.addEventListener('click', (event) => {
        event.preventDefault()
        this.close()
        openTaskModal(this.plugin, entry.project, { task: entry.task, onSave: () => this.onSave() })
      })
    }
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
