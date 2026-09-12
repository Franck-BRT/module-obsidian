import { Menu, Notice, TFile, type EventRef, type TAbstractFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { DocState, FilterState, PMSettings, Project, Task } from '../../types'
import { DOC_STATES } from '../../types'
import { personKeyer, type ProjectScope } from '../../store'
import { flattenTasks } from '../../store/TaskTreeOps'
import { matchesFilter } from '../../store/TaskFilter'
import { documentOf, isAwaited, isDocument } from '../../store/Document'
import { formatDateShort, today } from '../../dates'
import { displayName, safeAsync } from '../../utils'
import { confirmDialog, openTaskModal } from '../../ui/ModalFactory'
import { buildTaskContextMenu } from '../../ui/TaskContextMenu'
import { Chip } from '../../ui/primitives/Chip'
import { ChipButton } from '../../ui/primitives/ChipButton'
import { SegmentedControl } from '../../ui/primitives/SegmentedControl'
import { renderDocumentCards } from './LibraryCards'
import { t } from '../../i18n'
import { docStateLabel } from './docStateLabel'
import type { SubView } from '../SubView'
import { depositDocument, setDocState, signOff } from './documentActions'
import { LIBRARY_SORT_KEYS, librarySortKeyLabel, orderDocuments } from './librarySort'
import { renderSortControl } from '../SortControl'
import { writeBordereau } from './bordereau'

const STATE_COLORS: Record<DocState, string> = {
  expected: 'var(--text-muted)',
  received: 'var(--color-blue)',
  'in-review': 'var(--color-orange)',
  approved: 'var(--color-green)',
  obsolete: 'var(--text-faint)'
}

/**
 * A project's documents as a library rather than as a plan: what exists, at which
 * issue, from whom, and what is still awaited.
 *
 * The same notes appear in the table and the Gantt as tickets with a due date. This view
 * is the other half of the same thing — it shows what a schedule cannot say about a
 * document, and nothing here is a second copy of anything.
 */
export class LibraryView implements SubView {
  private stateFilter: DocState | null = null
  private picked = new Set<string>()
  private watchers: EventRef[] = []
  private pending: number | null = null

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState
  ) {}

  render(): void {
    this.watchFiles()
    this.container.empty()
    this.container.addClass('pm-library-view')
    const docs = this.documents()
    this.renderToolbar(this.container, docs)

    if (!docs.length) {
      this.container.createDiv({ cls: 'pm-library-empty', text: t('view.libraryEmpty') })
      return
    }

    const shown = this.stateFilter ? docs.filter((task) => documentOf(task).state === this.stateFilter) : docs
    const wrapper = this.container.createDiv('pm-library-wrapper')
    if (this.plugin.settings.libraryMode === 'cards') {
      renderDocumentCards(wrapper, shown, {
        states: this.cardStates(),
        plugin: this.plugin,
        projectOf: (id) => this.scope.projectOf(id),
        picked: this.picked,
        openTicket: (task) => {
          const project = this.scope.projectOf(task.id)
          if (project) openTaskModal(this.plugin, project, { task, onSave: () => this.onRefresh() })
        },
        openMenu: (e, task) => {
          const project = this.scope.projectOf(task.id)
          if (!project) return
          e.preventDefault()
          const menu = new Menu()
          this.addDocumentItems(menu, project, task)
          menu.addSeparator()
          buildTaskContextMenu(menu, task, { plugin: this.plugin, project, onRefresh: this.onRefresh })
          menu.showAtMouseEvent(e)
        },
        onRefresh: this.onRefresh
      })
      return
    }
    const table = wrapper.createEl('table', { cls: 'pm-table pm-library-table' })
    const head = table.createEl('thead').createEl('tr')
    for (const label of [
      '',
      t('doc.reference'),
      t('common.task'),
      t('doc.issue'),
      t('doc.state'),
      t('doc.versions'),
      t('common.due'),
      t('doc.issuer'),
      t('doc.approvals')
    ]) {
      head.createEl('th', { text: label })
    }
    const body = table.createEl('tbody')
    for (const task of shown) this.renderRow(body, task)
  }

  refresh(): void {
    this.render()
  }

  destroy(): void {
    for (const ref of this.watchers) this.plugin.app.vault.offref(ref)
    this.watchers = []
    if (this.pending !== null) window.clearTimeout(this.pending)
    this.pending = null
  }

  /**
   * Watches the vault for the files behind the cards.
   *
   * The store only reloads a project when its note or a task note changes, which is
   * right: deleting a PDF does not change what the project says. But the library is
   * showing that PDF, so it has to hear about it — a card left displaying a file that
   * is gone is a lie the view tells until something else happens to redraw it.
   *
   * Notes are ignored: those already come back through the store.
   */
  private watchFiles(): void {
    if (this.watchers.length) return
    const vault = this.plugin.app.vault
    const touched = (file: TAbstractFile): void => {
      if (file instanceof TFile && file.extension === 'md') return
      // Debounced: dropping a folder of drawings into the vault is one redraw, not fifty.
      if (this.pending !== null) window.clearTimeout(this.pending)
      this.pending = window.setTimeout(() => {
        this.pending = null
        this.render()
      }, 200)
    }
    this.watchers = [vault.on('create', touched), vault.on('delete', touched), vault.on('rename', touched)]
  }

  /**
   * Every document in scope, in the order the library is set to. Reference by default:
   * that is how a register is read, and it is the order this view has always been in.
   */
  private documents(): Task[] {
    const config = this.scope.config
    const keyOf = personKeyer(this.plugin.app)
    const docs = flattenTasks(this.scope.tasks())
      .map((flat) => flat.task)
      .filter((task) => isDocument(task) && matchesFilter(task, this.filter, config.statuses, keyOf))
    return orderDocuments(docs, this.order())
  }

  private order(): { sortKey: PMSettings['librarySortKey']; sortDir: PMSettings['librarySortDir'] } {
    return { sortKey: this.plugin.settings.librarySortKey, sortDir: this.plugin.settings.librarySortDir }
  }

  /**
   * The order the wall stacks its state bands in. The wall groups by state whatever the
   * library is sorted by, so sorting by state cannot reorder cards inside a band — but
   * it can still turn the wall around, which is what reading a register backwards means
   * here: the approved at the top rather than the awaited.
   */
  private cardStates(): readonly DocState[] {
    const { sortKey, sortDir } = this.order()
    return sortKey === 'state' && sortDir === 'desc' ? [...DOC_STATES].reverse() : DOC_STATES
  }

  private renderToolbar(parent: HTMLElement, docs: Task[]): void {
    const bar = parent.createDiv('pm-library-bar')
    const counts = new Map<DocState, number>()
    for (const task of docs) {
      const state = documentOf(task).state
      counts.set(state, (counts.get(state) ?? 0) + 1)
    }

    new ChipButton(bar)
      .setLabel(`${t('common.all')} · ${docs.length}`)
      .setShape('pill')
      .setActive(this.stateFilter === null)
      .onClick(() => {
        this.stateFilter = null
        this.render()
      })

    for (const state of DOC_STATES) {
      const count = counts.get(state) ?? 0
      if (!count) continue
      new ChipButton(bar)
        .setLabel(`${docStateLabel(state)} · ${count}`)
        .setShape('pill')
        .setActive(this.stateFilter === state)
        .onClick(() => {
          this.stateFilter = this.stateFilter === state ? null : state
          this.render()
        })
    }

    const right = bar.createDiv('pm-library-bar-right')
    // The order the register is listed in — the document's own fields, in both the wall
    // of thumbnails and the register: it is one library shown two ways.
    renderSortControl(right, {
      keys: LIBRARY_SORT_KEYS,
      label: librarySortKeyLabel,
      order: this.order(),
      onPick: async (order) => {
        this.plugin.settings.librarySortKey = order.sortKey
        this.plugin.settings.librarySortDir = order.sortDir
        await this.plugin.saveSettings()
        this.render()
      }
    })
    new SegmentedControl<'list' | 'cards'>(right, {
      options: [
        { id: 'cards', label: t('view.libraryCards') },
        { id: 'list', label: t('view.libraryList') }
      ],
      active: this.plugin.settings.libraryMode,
      onChange: (mode) => {
        this.plugin.settings.libraryMode = mode
        void this.plugin.saveSettings()
        this.render()
      }
    })
    const late = docs.filter((task) => isAwaited(task, today().toString()))
    if (late.length) {
      new Chip(right)
        .setLabel(t('count.documents', { count: late.length }))
        .setLeadingIcon('alarm-clock')
        .setVariant('solid')
        .setColor('var(--text-error, var(--color-red))')
        .setTooltip(`${t('view.awaitedDocs')}\n${late.map((task) => task.title).join('\n')}`)
    }
    this.renderOrphanChip(right)
    new ChipButton(right)
      .setLabel(t('view.bordereau'))
      .setShape('pill')
      .onClick(
        safeAsync(async () => {
          const chosen = docs.filter((task) => this.picked.has(task.id))
          const project = this.scope.primary
          if (!project) return
          if (!chosen.length) {
            new Notice(t('view.bordereauEmpty'))
            return
          }
          new Notice(t('view.bordereauCreated', { path: await writeBordereau(this.plugin, project, chosen) }))
        })
      )
  }

  /**
   * Files sitting in the project's documents folder that no document claims.
   *
   * Deleting a document's ticket deliberately leaves its files alone — they are the
   * user's, and a note going away is no reason to destroy a drawing. But then nothing
   * says they are still there, which is how a documents folder quietly fills up with
   * things nobody can name. This chip is that missing sentence.
   */
  private renderOrphanChip(parent: HTMLElement): void {
    const project = this.scope.primary
    if (!project) return
    // Every document, filter or no filter: a file whose document is merely hidden by the
    // search is not loose, and calling it loose would invite deleting it.
    const claimed = flattenTasks(this.scope.tasks())
      .map((flat) => flat.task)
      .filter(isDocument)
    const orphans = this.plugin.documents.orphanFiles(project, claimed)
    if (!orphans.length) return
    const chip = new ChipButton(parent)
      .setLabel(t('count.orphanFiles', { count: orphans.length }))
      .setShape('pill')
      .setAriaLabel(t('view.orphanFiles'))
    chip.el.addEventListener('click', (e) => {
      const menu = new Menu()
      for (const path of orphans) {
        const name = path.slice(path.lastIndexOf('/') + 1)
        menu.addItem((item) =>
          item
            .setTitle(name)
            .setIcon('file')
            .onClick(
              safeAsync(async () => {
                const file = this.plugin.app.vault.getAbstractFileByPath(path)
                if (file instanceof TFile) await this.plugin.app.workspace.getLeaf('tab').openFile(file)
              })
            )
        )
      }
      menu.addSeparator()
      menu.addItem((item) =>
        item
          .setTitle(t('view.orphanTrash'))
          .setIcon('trash')
          .onClick(
            safeAsync(async () => {
              if (!(await confirmDialog(this.plugin.app, t('view.orphanTrashConfirm', { count: orphans.length })))) {
                return
              }
              for (const path of orphans) {
                const file = this.plugin.app.vault.getAbstractFileByPath(path)
                if (file) await this.plugin.app.fileManager.trashFile(file)
              }
              this.render()
            })
          )
      )
      menu.showAtMouseEvent(e)
    })
  }

  private renderRow(body: HTMLElement, task: Task): void {
    const meta = documentOf(task)
    const project = this.scope.projectOf(task.id)
    const row = body.createEl('tr', { cls: 'pm-table-row pm-library-row' })
    row.dataset.taskId = task.id

    const pick = row.createEl('td', { cls: 'pm-table-cell pm-table-cell-select' })
    const box = pick.createEl('input', { type: 'checkbox' })
    box.checked = this.picked.has(task.id)
    box.addEventListener('change', () => {
      if (box.checked) this.picked.add(task.id)
      else this.picked.delete(task.id)
    })

    row.createEl('td', { cls: 'pm-table-cell pm-library-ref', text: meta.reference || '—' })

    const titleCell = row.createEl('td', { cls: 'pm-table-cell pm-library-title' })
    const title = titleCell.createSpan({ cls: 'pm-library-title-text', text: task.title })
    title.addEventListener('click', () => {
      if (!project) return
      openTaskModal(this.plugin, project, { task, onSave: () => this.onRefresh() })
    })
    this.renderFileChip(titleCell, task)

    row.createEl('td', { cls: 'pm-table-cell', text: meta.issue || '—' })

    const stateCell = row.createEl('td', { cls: 'pm-table-cell' })
    const stateChip = new Chip(stateCell)
      .setLabel(docStateLabel(meta.state))
      .setVariant('outline')
      .setColor(STATE_COLORS[meta.state])
    stateChip.el.addClass('pm-clickable')
    stateChip.el.addEventListener('click', (e) => {
      if (!project) return
      e.stopPropagation()
      const menu = new Menu()
      for (const state of DOC_STATES) {
        menu.addItem((item) =>
          item
            .setTitle(docStateLabel(state))
            .setChecked(state === meta.state)
            .onClick(safeAsync(() => setDocState(this.plugin, project, task, state, this.onRefresh)))
        )
      }
      menu.showAtMouseEvent(e)
    })

    const versionCell = row.createEl('td', { cls: 'pm-table-cell pm-library-versions' })
    const last = meta.versions[meta.versions.length - 1]
    if (last) {
      const chip = new Chip(versionCell)
        .setLabel(t('doc.version', { version: last.version }))
        .setVariant('plain')
        .setTooltip(
          [t('doc.restore'), ...meta.versions.map((v) => `v${v.version} · ${v.at.slice(0, 10)} · ${v.by}`)].join('\n')
        )
      chip.el.addClass('pm-clickable')
      chip.el.addEventListener('click', (e) => this.openVersionMenu(e, task))
    } else {
      versionCell.createSpan({ cls: 'pm-overview-muted', text: '—' })
    }

    const dueCell = row.createEl('td', { cls: 'pm-table-cell' })
    const late = isAwaited(task, today().toString())
    dueCell.createSpan({
      cls: late ? 'pm-library-late' : '',
      text: task.due ? formatDateShort(task.due) : '—'
    })
    if (late) dueCell.setAttr('aria-label', t('doc.awaitedSince', { date: formatDateShort(task.due) }))

    row.createEl('td', { cls: 'pm-table-cell', text: meta.issuer ? displayName(meta.issuer) : '—' })

    const visaCell = row.createEl('td', { cls: 'pm-table-cell pm-library-visas' })
    this.renderVisas(visaCell, task, project)

    row.addEventListener('contextmenu', (e) => {
      if (!project) return
      e.preventDefault()
      const menu = new Menu()
      this.addDocumentItems(menu, project, task)
      menu.addSeparator()
      buildTaskContextMenu(menu, task, { plugin: this.plugin, project, onRefresh: this.onRefresh })
      menu.showAtMouseEvent(e)
    })
  }

  private renderFileChip(parent: HTMLElement, task: Task): void {
    const meta = documentOf(task)
    if (!meta.file) {
      parent.createSpan({ cls: 'pm-library-nofile', text: t('view.noDocFile') })
      return
    }
    const file = this.plugin.documents.fileOf(meta)
    const chip = new Chip(parent)
      .setLabel(meta.file.slice(meta.file.lastIndexOf('/') + 1))
      .setVariant('plain')
      .setSize('sm')
      .setLeadingIcon(file ? (meta.linked ? 'link' : 'paperclip') : 'file-x')
      .setTooltip(file ? (meta.linked ? t('view.linkedFile') : t('doc.open')) : t('view.missingFile'))
    chip.el.addClass('pm-clickable')
    if (!file) chip.el.addClass('pm-library-missing')
    chip.el.addEventListener(
      'click',
      safeAsync(async (e: MouseEvent) => {
        e.stopPropagation()
        if (!(await this.plugin.documents.open(meta))) new Notice(t('doc.cannotOpen'))
      })
    )
  }

  /** One chip per named approver, saying where their signature stands. */
  private renderVisas(parent: HTMLElement, task: Task, project: Project | null): void {
    const meta = documentOf(task)
    if (!meta.approvers.length) {
      parent.createSpan({ cls: 'pm-overview-muted', text: '—' })
      return
    }
    for (const approver of meta.approvers) {
      const verdict = meta.approvals.find((approval) => approval.by === approver)
      const chip = new Chip(parent)
        .setLabel(displayName(approver))
        .setSize('sm')
        .setVariant(verdict ? 'solid' : 'outline')
        .setColor(
          verdict?.verdict === 'approved'
            ? 'var(--color-green)'
            : verdict
              ? 'var(--text-error, var(--color-red))'
              : 'var(--text-muted)'
        )
        .setTooltip(
          verdict
            ? [
                verdict.verdict === 'approved'
                  ? t('doc.approvedBy', { who: displayName(approver) })
                  : t('doc.rejectedBy', { who: displayName(approver) }),
                verdict.note
              ]
                .filter(Boolean)
                .join('\n')
            : t('doc.pendingFrom', { who: displayName(approver) })
        )
      if (!project) continue
      chip.el.addClass('pm-clickable')
      chip.el.addEventListener('click', (e) => {
        e.stopPropagation()
        const menu = new Menu()
        menu.addItem((item) =>
          item
            .setTitle(t('doc.approve'))
            .setIcon('check')
            .onClick(safeAsync(() => signOff(this.plugin, project, task, approver, 'approved', this.onRefresh)))
        )
        menu.addItem((item) =>
          item
            .setTitle(t('doc.reject'))
            .setIcon('x')
            .onClick(safeAsync(() => signOff(this.plugin, project, task, approver, 'rejected', this.onRefresh)))
        )
        menu.showAtMouseEvent(e)
      })
    }
  }

  private openVersionMenu(e: MouseEvent, task: Task): void {
    e.stopPropagation()
    const project = this.scope.projectOf(task.id)
    if (!project) return
    const meta = documentOf(task)
    const menu = new Menu()
    for (const version of [...meta.versions].reverse()) {
      const note = version.note ? ` · ${version.note}` : ''
      menu.addItem((item) =>
        item
          .setTitle(
            `${t('doc.version', { version: version.version })} · ${version.at.slice(0, 10)} · ${version.by}${note}`
          )
          .setIcon('history')
          .onClick(
            safeAsync(async () => {
              const restored = await this.plugin.documents.restore(project, task, version.version)
              if (!restored) return
              await this.plugin.store.updateTask(project, task.id, { document: restored })
              new Notice(t('doc.restored', { version: version.version }))
              await this.onRefresh()
            })
          )
      )
    }
    menu.showAtMouseEvent(e)
  }

  private addDocumentItems(menu: Menu, project: Project, task: Task): void {
    const meta = documentOf(task)
    menu.addItem((item) =>
      item
        .setTitle(t('doc.deposit'))
        .setIcon('upload')
        .onClick(safeAsync(() => depositDocument(this.plugin, project, task, this.onRefresh)))
    )
    if (meta.file) {
      menu.addItem((item) =>
        item
          .setTitle(t('doc.open'))
          .setIcon('external-link')
          .onClick(
            safeAsync(async () => {
              if (!(await this.plugin.documents.open(meta))) new Notice(t('doc.cannotOpen'))
            })
          )
      )
    }
    if (meta.state === 'approved') {
      menu.addItem((item) =>
        item
          .setTitle(t('doc.reopen'))
          .setIcon('rotate-ccw')
          .onClick(safeAsync(() => setDocState(this.plugin, project, task, 'in-review', this.onRefresh)))
      )
    }
    if (meta.state !== 'obsolete') {
      menu.addItem((item) =>
        item
          .setTitle(t('doc.markObsolete'))
          .setIcon('archive')
          .onClick(safeAsync(() => setDocState(this.plugin, project, task, 'obsolete', this.onRefresh)))
      )
    }
  }
}
