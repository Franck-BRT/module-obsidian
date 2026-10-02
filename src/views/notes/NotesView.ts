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
import { snippet } from '../../store/library/docText'
import {
  matchesNote,
  sortNotes,
  TO_SORT,
  type NoteEntry,
  type NoteQuery,
  type NoteSort
} from '../../store/notes/NoteLibrary'
import { formatDate } from '../../dates'
import { t } from '../../i18n'
import { safeAsync } from '../../utils'
import { confirmDialog, promptText } from '../../ui/ModalFactory'
import {
  dragRows,
  filteredFolder,
  FolderPicker,
  folderOptions,
  renderFolderStrip,
  type FolderChoice
} from '../folderUi'
import { AT_ROOT } from '../../store/folderFilter'
import { explain } from '../../ui/explain'

export const PM_NOTES_VIEW_TYPE = 'pm-notes'

/** Rows drawn at first; the rest on demand. */
const PAGE = 200

/**
 * The notes library: the notes that belong nowhere yet, and the inbox new ones land in.
 *
 * Each is found by a few words of its title or text, by project, by tag, or among those
 * still to sort; each can be said to belong to projects, moved beside one, or asked about
 * in the chat — one at a time, or ticked together.
 */
export class NotesView extends ItemView {
  private query: NoteQuery = { text: '', project: '', tag: '', folder: '' }
  private sort: NoteSort = 'modified'
  private shown = PAGE
  private picked = new Set<string>()
  private entries: NoteEntry[] = []
  private toolbarEl!: HTMLElement
  private filtersEl!: HTMLElement
  private bodyEl!: HTMLElement
  private redrawTimer: number | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
  }

  getViewType(): string {
    return PM_NOTES_VIEW_TYPE
  }

  getDisplayText(): string {
    return t('notes.title')
  }

  getIcon(): string {
    return 'notebook-pen'
  }

  getState(): Record<string, unknown> {
    return this.query.project ? { project: this.query.project } : {}
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const project = (state as { project?: unknown } | null)?.project
    this.query = { ...this.query, project: typeof project === 'string' ? project : '' }
    this.shown = PAGE
    // Drawn, it is drawn again for the project asked; not yet, it will be when it opens.
    if (this.filtersEl?.isConnected) await this.reload()
    await super.setState(state, result)
  }

  onOpen(): Promise<void> {
    try {
      this.build()
    } catch (error) {
      this.showFailure(error)
    }
    return Promise.resolve()
  }

  /**
   * Why the view could not be drawn, said in it — with the plugin's version, so a report
   * says which build it came from — and in the console with where it happened.
   */
  private showFailure(error: unknown): void {
    console.error('[PM] Could not draw the notes library:', error)
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root', 'pm-docs', 'pm-notes')
    const box = root.createDiv('pm-content pm-docs-body')
    box.createDiv({
      cls: 'pm-docs-none pm-docs-error',
      text: t('notes.loadFailed', { reason: error instanceof Error ? error.message : String(error) })
    })
    box.createEl('pre', {
      cls: 'pm-docs-error-detail',
      text: [`Black Projects ${this.plugin.manifest.version}`, error instanceof Error ? (error.stack ?? '') : '']
        .filter(Boolean)
        .join('\n')
    })
  }

  private build(): void {
    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root', 'pm-docs', 'pm-notes')
    this.toolbarEl = root.createDiv('pm-toolbar')
    this.filtersEl = root.createDiv('pm-docs-filters')
    this.bodyEl = root.createDiv('pm-content pm-docs-body')
    // A note written, changed, moved or thrown away redraws the list.
    const later = (): void => this.reloadSoon()
    // Only what happens in the library's folder: the vault indexed at start-up, or a note
    // written elsewhere, does not read the whole library again each time.
    const inside = (path: string): boolean => path.startsWith(`${this.plugin.notes.root}/`)
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (inside(file.path)) later()
      })
    )
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (inside(file.path)) later()
      })
    )
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (inside(file.path) || inside(oldPath)) later()
      })
    )
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFolder && file.path.startsWith(`${this.plugin.notes.root}/`)) later()
      })
    )
    this.register(this.plugin.index.onChange(later))
    // Something at once — the notes are read after —, never a blank page.
    this.renderToolbar()
    this.bodyEl.createDiv({ cls: 'pm-docs-none', text: t('notes.loading') })
    void this.reload()
  }

  onClose(): Promise<void> {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    return Promise.resolve()
  }

  private reloadSoon(): void {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    this.redrawTimer = window.setTimeout(() => {
      this.redrawTimer = null
      void this.reload()
    }, 300)
  }

  private loaded = false

  private async reload(): Promise<void> {
    try {
      this.entries = await this.plugin.notes.entries()
      this.loaded = true
      this.renderToolbar()
      this.renderFilters()
      this.renderBody()
    } catch (error) {
      // Said where it is looked for, rather than a blank page.
      this.showFailure(error)
    }
  }

  private projectTitle(path: string): string {
    return this.plugin.index.projectRef(path)?.title ?? path.replace(/^.*\//, '').replace(/\.md$/, '')
  }

  private renderToolbar(): void {
    this.toolbarEl.empty()
    const left = this.toolbarEl.createDiv('pm-toolbar-left')
    left.createEl('h2', { cls: 'pm-toolbar-title', text: t('notes.title') })
    const toSort = this.entries.filter((entry) => !entry.projects.length).length
    if (this.loaded) {
      left.createSpan({
        cls: 'pm-docs-count',
        text: [
          t('notes.count', { count: this.entries.length }),
          toSort ? t('notes.toSortCount', { count: toSort }) : ''
        ]
          .filter(Boolean)
          .join(' · ')
      })
    }
    const right = this.toolbarEl.createDiv('pm-toolbar-right')
    explain(
      new ButtonComponent(right)
        .setButtonText(t('folders.newFolder'))
        .setIcon('folder-plus')
        .onClick(safeAsync(() => this.newFolder())).buttonEl,
      t('folders.newFolder'),
      t('tip.folders.newFolder')
    )
    explain(
      new ButtonComponent(right)
        .setButtonText(t('notes.new'))
        .setIcon('file-plus')
        .setCta()
        .onClick(safeAsync(() => this.plugin.newInboxNote(this.currentFolder()))).buttonEl,
      t('notes.new'),
      t('tip.notes.new')
    )
  }

  private renderFilters(): void {
    // Drawn again while a search is being typed — a note changed elsewhere —: the typing goes on.
    const typing = this.filtersEl.querySelector<HTMLInputElement>('.pm-docs-search')
    const focused = !!typing && typing.ownerDocument.activeElement === typing
    const caret = typing?.selectionStart ?? null
    this.filtersEl.empty()
    this.filtersEl.toggleClass('is-hidden', !this.entries.length)
    const search = this.filtersEl.createEl('input', {
      cls: 'pm-docs-search',
      attr: { type: 'search', placeholder: t('notes.search') }
    })
    search.value = this.query.text
    if (focused) {
      search.focus()
      if (caret !== null) search.setSelectionRange(caret, caret)
    }
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
    const projects = this.plugin.libraryProjects().map((project): [string, string] => [project.path, project.title])
    if (
      this.query.project &&
      this.query.project !== TO_SORT &&
      !projects.some(([path]) => path === this.query.project)
    ) {
      projects.unshift([this.query.project, this.projectTitle(this.query.project)])
    }
    select([['', t('notes.allNotes')], [TO_SORT, t('notes.toSort')], ...projects], this.query.project, (project) => {
      this.query = { ...this.query, project }
      this.shown = PAGE
      this.app.workspace.requestSaveLayout()
      this.renderBody()
    })
    // The folders, each under the one it is in.
    const folders = this.plugin.notes.folders()
    if (folders.length || this.query.folder) {
      select(folderOptions(folders, t('notes.rootFolder')), this.query.folder ?? '', (folder) => {
        this.query = { ...this.query, folder }
        this.shown = PAGE
        this.renderBody()
      })
    }
    const tags = [...new Set(this.entries.flatMap((entry) => entry.tags))].sort((a, b) => a.localeCompare(b))
    if (tags.length || this.query.tag) {
      select(
        [['', t('library.allTags')], ...tags.map((tag): [string, string] => [tag, `#${tag}`])],
        this.query.tag,
        (tag) => {
          this.query = { ...this.query, tag }
          this.shown = PAGE
          this.renderBody()
        }
      )
    }
    select(
      [
        ['modified', t('notes.sortModified')],
        ['title', t('library.sortTitle')]
      ],
      this.sort,
      (sort) => {
        this.sort = sort as NoteSort
        this.renderBody()
      }
    )
  }

  private renderBody(): void {
    this.bodyEl.empty()
    const all = this.entries
    if (!all.length) {
      const empty = this.bodyEl.createDiv('pm-docs-empty')
      setIcon(empty.createDiv('pm-docs-empty-icon'), 'notebook-pen')
      empty.createDiv({ cls: 'pm-docs-empty-title', text: t('notes.emptyTitle') })
      empty.createDiv({ cls: 'pm-docs-empty-text', text: t('notes.emptyText', { folder: this.plugin.notes.root }) })
      explain(
        new ButtonComponent(empty)
          .setButtonText(t('notes.new'))
          .setIcon('file-plus')
          .setCta()
          .onClick(safeAsync(() => this.plugin.newInboxNote())).buttonEl,
        t('notes.new'),
        t('tip.notes.new')
      )
      return
    }
    const paths = new Set(all.map((entry) => entry.path))
    for (const path of this.picked) if (!paths.has(path)) this.picked.delete(path)
    renderFolderStrip(this.bodyEl, {
      folders: this.plugin.notes.folders(),
      current: this.query.folder ?? '',
      open: (folder) => this.openFolder(folder),
      drop: (dropped, folder) => {
        void this.moveNotes(
          all.filter((entry) => dropped.includes(entry.path)),
          folder
        )
      },
      rename: (folder) => {
        void this.renameFolder(folder)
      },
      remove: (folder) => {
        void this.deleteFolder(folder)
      }
    })
    const found = sortNotes(
      all.filter((entry) =>
        matchesNote(
          entry,
          this.query,
          (path) => this.projectTitle(path),
          (each) => this.plugin.notes.folded(each)
        )
      ),
      this.sort
    )
    const summary = this.bodyEl.createDiv('pm-docs-summary')
    const left = summary.createSpan('pm-docs-summary-left')
    const every = left.createEl('input', { attr: { type: 'checkbox', 'aria-label': t('library.pickAll') } })
    const ticked = found.filter((entry) => this.picked.has(entry.path)).length
    every.checked = found.length > 0 && ticked === found.length
    every.indeterminate = ticked > 0 && ticked < found.length
    every.addEventListener('change', () => {
      for (const entry of found) {
        if (every.checked) this.picked.add(entry.path)
        else this.picked.delete(entry.path)
      }
      this.renderBody()
    })
    left.createSpan({
      text:
        found.length === all.length
          ? t('notes.count', { count: all.length })
          : t('notes.found', { count: found.length, total: all.length })
    })
    if (this.picked.size) this.renderPickedBar()
    if (!found.length) {
      this.bodyEl.createDiv({ cls: 'pm-docs-none', text: t('notes.nothingFound') })
      return
    }
    const list = this.bodyEl.createDiv('pm-docs-list')
    for (const entry of found.slice(0, this.shown)) this.renderRow(list, entry)
    if (found.length > this.shown) {
      new ButtonComponent(this.bodyEl.createDiv('pm-docs-more'))
        .setButtonText(t('library.showMore', { count: Math.min(PAGE, found.length - this.shown) }))
        .onClick(() => {
          this.shown += PAGE
          this.renderBody()
        })
    }
  }

  private renderPickedBar(): void {
    const picked = this.entries.filter((entry) => this.picked.has(entry.path))
    const bar = this.bodyEl.createDiv('pm-docs-picked')
    bar.createSpan({ cls: 'pm-docs-picked-count', text: t('notes.picked', { count: picked.length }) })
    explain(
      new ButtonComponent(bar)
        .setButtonText(t('library.askChat'))
        .setIcon('messages-square')
        .setCta()
        .onClick(safeAsync(() => this.plugin.chatAboutDocuments(picked.map((entry) => entry.path)))).buttonEl,
      t('library.askChat'),
      t('tip.library.askChat')
    )
    explain(
      new ButtonComponent(bar)
        .setButtonText(t('notes.fileTo'))
        .setIcon('folder-kanban')
        .onClick(safeAsync(() => this.fileTo(picked))).buttonEl,
      t('notes.fileTo'),
      t('tip.notes.fileTo')
    )
    explain(
      new ButtonComponent(bar)
        .setButtonText(t('folders.moveTo'))
        .setIcon('folder-input')
        .onClick(() => this.moveToFolder(picked)).buttonEl,
      t('folders.moveTo'),
      t('tip.folders.moveTo')
    )
    explain(
      new ButtonComponent(bar).setButtonText(t('library.unpick')).onClick(() => {
        this.picked.clear()
        this.renderBody()
      }).buttonEl,
      t('library.unpick'),
      t('tip.library.unpick')
    )
  }

  private renderRow(list: HTMLElement, entry: NoteEntry): void {
    const row = list.createDiv('pm-docs-row')
    // Dragged onto a folder: itself, or all that is ticked when it is.
    dragRows(row, () => (this.picked.has(entry.path) ? [...this.picked] : [entry.path]))
    const tick = row.createEl('input', {
      cls: 'pm-docs-tick',
      attr: { type: 'checkbox', 'aria-label': t('library.pickOne', { title: entry.title }) }
    })
    tick.checked = this.picked.has(entry.path)
    tick.addEventListener('change', () => {
      if (tick.checked) this.picked.add(entry.path)
      else this.picked.delete(entry.path)
      this.renderBody()
    })
    if (tick.checked) row.addClass('is-picked')
    setIcon(row.createDiv('pm-docs-icon pm-docs-icon--note'), 'sticky-note')

    const main = row.createDiv('pm-docs-main')
    const title = main.createEl('a', { cls: 'pm-docs-title', text: entry.title, href: '#' })
    title.addEventListener('click', (event) => {
      event.preventDefault()
      void this.openNote(entry)
    })
    const meta = main.createDiv('pm-docs-meta')
    meta.createSpan({
      text: t('notes.modifiedOn', { date: formatDate(new Date(entry.mtime).toISOString().slice(0, 10)) })
    })
    if (entry.subfolder) {
      const folder = meta.createEl('a', { cls: 'pm-notes-folder', href: '#', text: entry.subfolder })
      folder.addEventListener('click', (event) => {
        event.preventDefault()
        this.query = { ...this.query, folder: entry.subfolder }
        this.renderFilters()
        this.renderBody()
      })
    }

    // The words searched for where they are in the text; otherwise its first lines.
    const words = this.query.text.split(/\s+/).filter(Boolean)
    const found = words.length
      ? snippet(this.plugin.notes.body(entry), words, this.plugin.notes.folded(entry), 70)
      : null
    const line = main.createDiv('pm-docs-snippet pm-notes-excerpt')
    if (found) {
      if (found.before) line.appendText('… ')
      for (const part of found.parts) {
        if (part.hit) line.createEl('mark', { text: part.text })
        else line.appendText(part.text)
      }
      if (found.after) line.appendText(' …')
    } else if (entry.excerpt) line.setText(entry.excerpt)
    else line.remove()

    const chips = main.createDiv('pm-docs-projects')
    if (!entry.projects.length) chips.createSpan({ cls: 'pm-docs-chip is-none', text: t('notes.toSort') })
    for (const path of entry.projects) {
      const chip = chips.createEl('button', { cls: 'pm-docs-chip', text: this.projectTitle(path) })
      explain(chip, this.projectTitle(path), t('library.filterOn', { project: this.projectTitle(path) }))
      chip.addEventListener('click', () => {
        this.query = { ...this.query, project: path }
        this.renderFilters()
        this.renderBody()
      })
    }
    for (const tag of entry.tags) {
      const chip = chips.createEl('button', { cls: 'pm-docs-chip pm-docs-tag', text: `#${tag}` })
      explain(chip, `#${tag}`, t('library.filterTag', { tag }))
      chip.addEventListener('click', () => {
        this.query = { ...this.query, tag }
        this.renderFilters()
        this.renderBody()
      })
    }

    const actions = row.createDiv('pm-docs-actions')
    explain(
      new ExtraButtonComponent(actions)
        .setIcon('folder-kanban')
        .setTooltip(t('notes.fileTo'))
        .onClick(safeAsync(() => this.fileTo([entry]))).extraSettingsEl,
      t('notes.fileTo'),
      t('tip.notes.fileTo')
    )
    const more = new ExtraButtonComponent(actions).setIcon('more-vertical')
    more.extraSettingsEl.addEventListener('click', (event) => this.showMenu(entry, event))
    explain(more.extraSettingsEl, t('library.more'), t('tip.notes.more'))
  }

  private showMenu(entry: NoteEntry, event: MouseEvent): void {
    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle(t('notes.open'))
        .setIcon('file-text')
        .onClick(safeAsync(() => this.openNote(entry)))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('notes.fileTo'))
        .setIcon('folder-kanban')
        .onClick(safeAsync(() => this.fileTo([entry])))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('folders.moveTo'))
        .setIcon('folder-input')
        .onClick(() => this.moveToFolder([entry]))
    )
    if (entry.projects.length) {
      menu.addItem((item) =>
        item
          .setTitle(t('notes.moveBeside', { project: this.projectTitle(entry.projects[0]) }))
          .setIcon('folder-input')
          .onClick(safeAsync(() => this.moveBeside(entry)))
      )
    }
    menu.addItem((item) =>
      item
        .setTitle(t('library.askChat'))
        .setIcon('messages-square')
        .onClick(safeAsync(() => this.plugin.chatAboutDocuments([entry.path])))
    )
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle(t('notes.delete'))
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(() => new DeleteModal(this.plugin, entry).open())
    )
    menu.showAtMouseEvent(event)
  }

  private fileOf(entry: NoteEntry): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(entry.path)
    return file instanceof TFile ? file : null
  }

  private async openNote(entry: NoteEntry): Promise<void> {
    const file = this.fileOf(entry)
    if (file) await this.app.workspace.getLeaf('tab').openFile(file)
  }

  /**
   * Says which projects notes belong to: one note as it is to be edited, several at once
   * given the projects ticked — added to what each already has.
   */
  private async fileTo(entries: NoteEntry[]): Promise<void> {
    if (!entries.length) return
    const one = entries.length === 1 ? entries[0] : null
    const answer = await this.plugin.askLibraryProjects({
      heading: one ? t('library.projectsOf', { title: one.title }) : t('notes.fileSeveral', { count: entries.length }),
      chosen: one ? one.projects : [],
      confirm: t('library.save')
    })
    if (!answer) return
    for (const entry of entries) {
      const file = this.fileOf(entry)
      if (!file) continue
      const projects = one ? answer.projects : [...new Set([...entry.projects, ...answer.projects])]
      await this.plugin.notes.setProjects(file, projects)
    }
    this.picked.clear()
  }

  /** The folder on screen, where a new note or folder goes: '' at the root, or when all are shown. */
  private currentFolder(): string {
    return filteredFolder(this.query.folder)
  }

  /** A folder made in the one on screen — or at the root —, then shown. */
  private async newFolder(): Promise<void> {
    const under = this.currentFolder()
    const name = await promptText(
      this.app,
      under ? t('folders.newFolderIn', { folder: under }) : t('notes.newFolderTitle'),
      t('folders.newFolderPlaceholder')
    )
    if (!name) return
    const made = await this.plugin.notes.createFolder(name, under)
    if (!made) return
    this.query = { ...this.query, folder: made }
    new Notice(t('folders.folderMade', { folder: made }))
    await this.reload()
  }

  /** Notes moved into a folder of the library, picked or named — a new name makes it. */
  private moveToFolder(entries: NoteEntry[]): void {
    if (!entries.length) return
    new FolderPicker(
      this.app,
      this.plugin.notes.folders(),
      t('notes.rootFolder'),
      safeAsync(async (target: FolderChoice) => {
        const folder = target.kind === 'new' ? await this.plugin.notes.createFolder(target.name) : target.path
        if (target.kind === 'new' && !folder) return
        await this.moveNotes(entries, folder)
      })
    ).open()
  }

  /** Notes moved into a folder of the library — '' for its root. */
  private async moveNotes(entries: NoteEntry[], folder: string): Promise<void> {
    if (!entries.length) return
    for (const entry of entries) {
      const file = this.fileOf(entry)
      if (file) await this.plugin.notes.moveTo(file, this.plugin.notes.pathOf(folder))
    }
    this.picked.clear()
    new Notice(t('notes.movedTo', { count: entries.length, folder: folder || t('notes.rootFolder') }))
  }

  /** Shows a folder — '' for every folder, `AT_ROOT` for the root alone. */
  private openFolder(folder: string): void {
    this.query = { ...this.query, folder }
    this.shown = PAGE
    this.renderFilters()
    this.renderBody()
  }

  /** A folder renamed where it is; the notes' links follow, as Obsidian renames them. */
  private async renameFolder(folder: string): Promise<void> {
    const name = await promptText(
      this.app,
      t('folders.renameTitle', { folder }),
      t('folders.renamePlaceholder'),
      folder.slice(folder.lastIndexOf('/') + 1)
    )
    if (name === null) return
    const renamed = await this.plugin.notes.renameFolder(folder, name)
    if (renamed === null) {
      new Notice(t('folders.nameTaken', { name: name.trim() }))
      return
    }
    new Notice(t('folders.renamed', { folder: renamed }))
    this.query = { ...this.query, folder: renamed }
    await this.reload()
  }

  /** A folder taken out, what it holds going up into the one it is in, after a yes. */
  private async deleteFolder(folder: string): Promise<void> {
    const parent = folder.slice(0, Math.max(0, folder.lastIndexOf('/')))
    const parentName = parent || t('notes.rootFolder')
    const yes = await confirmDialog(
      this.app,
      t('folders.deleteConfirm', { folder, parent: parentName }),
      t('folders.deleteAction')
    )
    if (!yes) return
    await this.plugin.notes.deleteFolder(folder)
    new Notice(t('folders.deleted', { folder, parent: parentName }))
    this.query = { ...this.query, folder: parent || AT_ROOT }
    await this.reload()
  }

  /** A note moved beside its first project — into its folder — where it now belongs. */
  private async moveBeside(entry: NoteEntry): Promise<void> {
    const file = this.fileOf(entry)
    const project = entry.projects[0]
    if (!file || !project) return
    const folder = project.slice(0, Math.max(0, project.lastIndexOf('/')))
    const moved = await this.plugin.notes.moveTo(file, folder)
    new Notice(t('notes.moved', { path: moved.path }))
  }
}

/** A yes before a note goes to the trash. */
class DeleteModal extends Modal {
  constructor(
    private plugin: PMPlugin,
    private entry: NoteEntry
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.setTitle(t('notes.deleteTitle', { title: this.entry.title }))
    this.contentEl.createEl('p', { text: t('notes.deleteText') })
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setDestructive()
          .setButtonText(t('notes.delete'))
          .onClick(
            safeAsync(async () => {
              this.close()
              const file = this.plugin.app.vault.getAbstractFileByPath(this.entry.path)
              if (file instanceof TFile) await this.plugin.app.fileManager.trashFile(file)
            })
          )
      )
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
