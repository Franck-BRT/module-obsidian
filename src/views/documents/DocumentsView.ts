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
  DOC_FAMILIES,
  FAMILY_ICONS,
  familyOf,
  matchesDoc,
  NO_PROJECT,
  NO_VALUE,
  sortDocs,
  type DocFamily,
  type DocQuery,
  type DocSort,
  type LibraryDoc
} from '../../store/library/libraryDoc'
import type { PourItem } from '../../store/library/DocLibrary'
import { snippet } from '../../store/library/docText'
import { AT_ROOT } from '../../store/folderFilter'
import {
  missingRegisterFiles,
  registerEntries,
  registerFilesOutside,
  type MissingRegisterFile,
  type RegisterEntry
} from '../../store/library/libraryRegister'
import { findVaultFile } from '../../store/library/DocLibrary'
import { documentOf } from '../../store/Document'
import { confirmDialog, openTaskModal, promptText } from '../../ui/ModalFactory'
import { docStateLabel } from '../library/docStateLabel'
import { fileInRegister } from './registerActions'
import { proposeRegisterMatches } from './matchRegister'
import { pourRegisterFiles } from './pourRegisters'
import type { Project } from '../../types'
import { knownValues } from '../../store/library/libraryClass'
import { formatDate } from '../../dates'
import { t } from '../../i18n'
import { safeAsync } from '../../utils'
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
export class DocumentsView extends ItemView {
  private query: DocQuery = { text: '', project: '', family: '' }
  private sort: DocSort = 'added'
  /** Whether the finer filters — kind, category, lot, issuer, tag — are shown. */
  private moreFilters = false
  private shown = PAGE
  private toolbarEl!: HTMLElement
  private filtersEl!: HTMLElement
  private bodyEl!: HTMLElement
  private redrawTimer: number | null = null
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
    void this.plugin.libraryText.refresh(this.plugin.library.docs())
    void this.loadRegister()

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
    new ButtonComponent(right)
      .setButtonText(t('folders.newFolder'))
      .setIcon('folder-plus')
      .onClick(safeAsync(() => this.newFolder()))
    new ButtonComponent(right)
      .setButtonText(t('library.pour'))
      .setIcon('upload')
      .setCta()
      .onClick(() => this.pickFromComputer())
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
    const found = sortDocs(
      all.filter((doc) =>
        matchesDoc(
          doc,
          this.query,
          (path) => this.projectTitle(path),
          (each) => texts.folded(each)
        )
      ),
      this.sort
    )
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
    this.renderRegistersOutside(all)
    if (this.picked.size) this.renderPickedBar(all)
    if (!found.length) {
      this.bodyEl.createDiv({ cls: 'pm-docs-none', text: t('library.nothingFound') })
      return
    }
    const list = this.bodyEl.createDiv('pm-docs-list')
    for (const doc of found.slice(0, this.shown)) this.renderRow(list, doc)
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
    new ButtonComponent(bar)
      .setButtonText(t('library.askChat'))
      .setIcon('messages-square')
      .setCta()
      .onClick(
        safeAsync(async () => {
          await this.plugin.chatAboutDocuments(picked.map((doc) => doc.file))
        })
      )
    new ButtonComponent(bar)
      .setButtonText(t('library.classify'))
      .setIcon('tags')
      .onClick(safeAsync(() => this.plugin.classifyDocuments(all.filter((doc) => this.picked.has(doc.record)))))
    new ButtonComponent(bar)
      .setButtonText(t('folders.moveTo'))
      .setIcon('folder-input')
      .onClick(() => this.moveToFolder(all.filter((doc) => this.picked.has(doc.record))))
    new ButtonComponent(bar)
      .setButtonText(t('library.matchPicked'))
      .setIcon('clipboard-list')
      .onClick(
        safeAsync(async () => {
          await proposeRegisterMatches(this.plugin, picked, true)
          await this.loadRegister()
        })
      )
    new ButtonComponent(bar).setButtonText(t('library.unpick')).onClick(() => {
      this.picked.clear()
      this.renderBody()
    })
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
    const scans = all.filter((doc) => texts.entry(doc)?.state === 'scan')
    if (scans.length) {
      const link = status.createEl('a', {
        cls: 'pm-docs-scans',
        href: '#',
        text: t('library.scansWaiting', { count: scans.length })
      })
      link.setAttr('title', t('library.readScansHint'))
      link.addEventListener('click', (event) => {
        event.preventDefault()
        this.confirmReadScans(scans)
      })
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
    new ButtonComponent(empty)
      .setButtonText(t('library.pour'))
      .setIcon('upload')
      .setCta()
      .onClick(() => this.pickFromComputer())
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
    const family = familyOf(doc.file || doc.title)
    setIcon(row.createDiv({ cls: `pm-docs-icon pm-docs-icon--${family}` }), FAMILY_ICONS[family])

    const main = row.createDiv('pm-docs-main')
    const title = main.createEl('a', { cls: 'pm-docs-title', text: doc.title, href: '#' })
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
    this.renderTextState(meta, doc)

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
    if (!doc.projects.length) chips.createSpan({ cls: 'pm-docs-chip is-none', text: t('library.noProject') })
    for (const path of doc.projects) {
      const chip = chips.createEl('button', {
        cls: 'pm-docs-chip',
        text: this.projectTitle(path),
        attr: { title: t('library.filterOn', { project: this.projectTitle(path) }) }
      })
      chip.addEventListener('click', () => {
        this.query = { ...this.query, project: path }
        this.shown = PAGE
        this.renderFilters()
        this.renderBody()
      })
    }
    // Its tags, each one a filter.
    for (const tag of doc.tags) {
      const chip = chips.createEl('button', {
        cls: 'pm-docs-chip pm-docs-tag',
        text: `#${tag}`,
        attr: { title: t('library.filterTag', { tag }) }
      })
      chip.addEventListener('click', () => {
        this.query = { ...this.query, tag }
        this.shown = PAGE
        this.renderFilters()
        this.renderBody()
      })
    }

    const actions = row.createDiv('pm-docs-actions')
    new ExtraButtonComponent(actions)
      .setIcon('folder-kanban')
      .setTooltip(t('library.editProjects'))
      .onClick(safeAsync(() => this.editProjects(doc)))
    new ExtraButtonComponent(actions)
      .setIcon('more-vertical')
      .setTooltip(t('library.more'))
      .extraSettingsEl.addEventListener('click', (event) => this.showMenu(doc, event))
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
        cls: `pm-docs-reg${entry.current ? '' : ' is-old'} pm-docs-reg--${meta.state}`,
        attr: { title: t('library.registerOpen', { title: entry.task.title }) }
      })
      setIcon(chip.createSpan('pm-docs-reg-icon'), 'clipboard-list')
      chip.createSpan({ text: text.filter(Boolean).join(' · ') })
      chip.addEventListener('click', () =>
        openTaskModal(this.plugin, entry.project, { task: entry.task, onSave: () => this.loadRegister() })
      )
    }
  }

  /** Said when its text could not be read, and offered to a model when it is a scan. */
  private renderTextState(meta: HTMLElement, doc: LibraryDoc): void {
    const entry = this.plugin.libraryText.entry(doc)
    if (!entry || entry.state === 'ok') return
    if (entry.state === 'scan') {
      const badge = meta.createEl('a', { cls: 'pm-docs-badge is-scan', href: '#', text: t('library.scanBadge') })
      badge.setAttr('title', t('library.scanBadgeHint'))
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
    menu.addItem((item) =>
      item
        .setTitle(t('library.askChat'))
        .setIcon('messages-square')
        .setDisabled(!doc.file)
        .onClick(safeAsync(() => this.plugin.chatAboutDocuments([doc.file])))
    )
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
    await this.plugin.pourIntoLibrary(items, preset, filteredFolder(this.query.folder))
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
