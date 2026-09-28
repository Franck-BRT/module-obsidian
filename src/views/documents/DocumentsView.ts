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
  sortDocs,
  type DocFamily,
  type DocQuery,
  type DocSort,
  type LibraryDoc
} from '../../store/library/libraryDoc'
import type { PourItem } from '../../store/library/DocLibrary'
import { snippet } from '../../store/library/docText'
import { formatDate } from '../../dates'
import { t } from '../../i18n'
import { safeAsync } from '../../utils'

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
  private shown = PAGE
  private toolbarEl!: HTMLElement
  private filtersEl!: HTMLElement
  private bodyEl!: HTMLElement
  private redrawTimer: number | null = null
  private textTimer: number | null = null

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
    this.register(this.plugin.index.onChange(later))
    // What the documents say, read in the background: the list follows as it comes in.
    this.register(this.plugin.libraryText.onChange(() => this.textSoon()))
    void this.plugin.libraryText.refresh(this.plugin.library.docs())

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
      this.renderBody()
      // A document come in, or changed, has its text read.
      void this.plugin.libraryText.refresh(this.plugin.library.docs())
    }, 300)
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
      .setButtonText(t('library.pour'))
      .setIcon('upload')
      .setCta()
      .onClick(() => this.pickFromComputer())
  }

  private renderFilters(): void {
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

    const select = (options: [string, string][], value: string, onChange: (value: string) => void): void => {
      const el = this.filtersEl.createEl('select', { cls: 'dropdown pm-docs-select' })
      for (const [key, label] of options) el.createEl('option', { value: key, text: label })
      el.value = value
      el.addEventListener('change', () => onChange(el.value))
    }

    const projects = this.projectOptions()
    // A project the filter names but the vault no longer has is still offered, so the
    // filter can be seen and taken off.
    if (this.query.project && this.query.project !== NO_PROJECT && !projects.some(([p]) => p === this.query.project)) {
      projects.unshift([this.query.project, this.projectTitle(this.query.project)])
    }
    select(
      [['', t('library.allProjects')], [NO_PROJECT, t('library.noProject')], ...projects],
      this.query.project,
      (project) => {
        this.query = { ...this.query, project }
        this.shown = PAGE
        this.app.workspace.requestSaveLayout()
        this.renderBody()
      }
    )
    select(
      [
        ['', t('library.allKinds')],
        ...DOC_FAMILIES.map((family): [string, string] => [family, t(`library.kind.${family}`)])
      ],
      this.query.family,
      (family) => {
        this.query = { ...this.query, family: family as DocFamily | '' }
        this.shown = PAGE
        this.renderBody()
      }
    )
    select(
      [
        ['added', t('library.sortAdded')],
        ['title', t('library.sortTitle')]
      ],
      this.sort,
      (sort) => {
        this.sort = sort as DocSort
        this.renderBody()
      }
    )
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
    const summary = this.bodyEl.createDiv('pm-docs-summary')
    summary.createSpan({
      text:
        found.length === all.length
          ? t('library.count', { count: all.length })
          : t('library.found', { count: found.length, total: all.length })
    })
    this.renderTextStatus(summary, all)
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
    new ConfirmModal(
      this.plugin,
      t('library.readScansTitle', { count: scans.length }),
      t('library.readScansText'),
      t('library.readScans'),
      false,
      async () => {
        await this.plugin.readLibraryScans(scans)
      }
    ).open()
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
    if (!doc.file) row.addClass('is-missing')
    const family = familyOf(doc.file || doc.title)
    setIcon(row.createDiv({ cls: `pm-docs-icon pm-docs-icon--${family}` }), FAMILY_ICONS[family])

    const main = row.createDiv('pm-docs-main')
    const title = main.createEl('a', { cls: 'pm-docs-title', text: doc.title, href: '#' })
    title.addEventListener('click', (event) => {
      event.preventDefault()
      void this.openDoc(doc)
    })
    const meta = main.createDiv('pm-docs-meta')
    if (doc.file) {
      meta.createSpan({ cls: 'pm-docs-name', text: doc.file.slice(doc.file.lastIndexOf('/') + 1) })
    } else meta.createSpan({ cls: 'pm-docs-lost', text: t('library.fileMissing') })
    if (doc.size) meta.createSpan({ text: formatBytes(doc.size, this.units()) })
    if (doc.added) meta.createSpan({ text: t('library.addedOn', { date: formatDate(doc.added) }) })
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

  /** Said when its text could not be read, and offered to a model when it is a scan. */
  private renderTextState(meta: HTMLElement, doc: LibraryDoc): void {
    const entry = this.plugin.libraryText.entry(doc)
    if (!entry || entry.state === 'ok') return
    if (entry.state === 'scan') {
      const badge = meta.createEl('a', { cls: 'pm-docs-badge is-scan', href: '#', text: t('library.scanBadge') })
      badge.setAttr('title', t('library.scanBadgeHint'))
      badge.addEventListener('click', (event) => {
        event.preventDefault()
        void this.plugin.readLibraryScans([doc])
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
    const family = familyOf(doc.file || doc.title)
    if (doc.file && (family === 'pdf' || family === 'image')) {
      menu.addItem((item) =>
        item
          .setTitle(t('library.readScan'))
          .setIcon('scan-text')
          .onClick(
            safeAsync(async () => {
              await this.plugin.readLibraryScans([doc])
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
    const keptInLibrary = !!doc.file && doc.file.startsWith(`${this.plugin.library.filesFolder}/`)
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
    await this.plugin.pourIntoLibrary(items, preset)
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
