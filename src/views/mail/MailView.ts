import { Menu, Notice, TFile, type EventRef, type TAbstractFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { PMSettings } from '../../types'
import type { ProjectScope } from '../../store'
import { MailCache, mailFiles, matchesQuery, type MailEntry } from '../../store/MailBox'
import { formatDateShort } from '../../dates'
import { safeAsync } from '../../utils'
import { EmptyState } from '../../ui/primitives/EmptyState'
import { SegmentedControl } from '../../ui/primitives/SegmentedControl'
import { ChipButton } from '../../ui/primitives/ChipButton'
import { renderSortControl } from '../SortControl'
import { SUBVIEW_CLASS } from '../subviewClasses'
import type { SubView } from '../SubView'
import { MAIL_SORT_KEYS, mailSortKeyLabel, orderMail } from './mailSort'
import { renderMailPreview } from './mailPreview'
import { ticketFromMessage } from '../messageToTicket'
import { t } from '../../i18n'

/**
 * A project's messages, as a mailbox.
 *
 * The documents library answers "what do we have and what are we waiting for"; this
 * answers "what were we told, and by whom". They are deliberately not the same view:
 * a document has a state, a version and someone who owes it, and a message has none of
 * those — it arrived, and either something came of it or nothing did.
 *
 * The pane is the point. Reading a message meant opening it, losing the list, and coming
 * back; a list with the message beside it is how every mail client has worked for thirty
 * years, and the reason is that looking through mail means reading several.
 */
export class MailView implements SubView {
  private cache = new MailCache()
  private entries: MailEntry[] = []
  private selected: string | null = null
  private query = ''
  private watchers: EventRef[] = []
  private pending: number | null = null
  /** Bumped on every load, so a slow read from a previous render cannot paint over this one. */
  private generation = 0
  private listEl: HTMLElement | null = null
  private paneEl: HTMLElement | null = null

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>
  ) {}

  render(): void {
    this.watchFiles()
    this.container.empty()
    this.container.addClass(SUBVIEW_CLASS.mail)
    this.renderToolbar(this.container)

    const split = this.container.createDiv('pm-mail-split')
    split.addClass(`pm-mail-split--${this.pane()}`)
    this.listEl = split.createDiv('pm-mail-list')
    this.paneEl = this.pane() === 'off' ? null : split.createDiv('pm-mail-pane')

    this.listEl.createDiv({ cls: 'pm-mail-loading', text: t('email.reading') })
    void this.load()
  }

  refresh(): void {
    this.render()
  }

  destroy(): void {
    for (const ref of this.watchers) this.plugin.app.vault.offref(ref)
    this.watchers = []
    if (this.pending !== null) window.clearTimeout(this.pending)
    this.pending = null
    // Nothing else holds this cache, and the next visit re-reads what it needs anyway.
    this.generation++
  }

  private pane(): PMSettings['mailPane'] {
    return this.plugin.settings.mailPane
  }

  private order(): { sortKey: PMSettings['mailSortKey']; sortDir: PMSettings['mailSortDir'] } {
    return { sortKey: this.plugin.settings.mailSortKey, sortDir: this.plugin.settings.mailSortDir }
  }

  /**
   * Reads the mailbox, then draws it.
   *
   * Every message has to be parsed before the list can say who it is from, and parsing a
   * `.msg` means walking a compound file — so the list says it is reading rather than
   * appearing blank, and the cache means the second visit is instant. A render that
   * started before this one is abandoned when it lands: the newer answer is the true one.
   */
  private async load(): Promise<void> {
    const mine = ++this.generation
    const project = this.scope.primary
    if (!project) return
    const files = mailFiles(this.plugin.app, project)
    this.cache.prune(files.map((file) => file.path))
    const entries: MailEntry[] = []
    for (const file of files) {
      entries.push(await this.cache.read(this.plugin.app, file))
      if (this.generation !== mine) return
    }
    this.entries = entries
    this.paint()
  }

  private shown(): MailEntry[] {
    return orderMail(
      this.entries.filter((entry) => matchesQuery(entry, this.query)),
      this.order()
    )
  }

  private paint(): void {
    const list = this.listEl
    if (!list) return
    list.empty()
    const shown = this.shown()
    if (!shown.length) {
      new EmptyState(list)
        .setIcon('✉️')
        .setTitle(this.entries.length ? t('email.noneMatch') : t('email.boxEmpty'))
        .setBody(this.entries.length ? t('email.noneMatchHint') : t('email.boxEmptyHint'))
      this.paintPane(null)
      return
    }
    // A selection that the search or a deletion has taken away falls back to the top of
    // the list rather than leaving the pane showing a message no longer listed.
    if (!shown.some((entry) => entry.path === this.selected)) this.selected = shown[0].path
    for (const entry of shown) this.renderRow(list, entry)
    this.paintPane(shown.find((entry) => entry.path === this.selected) ?? null)
  }

  private renderRow(parent: HTMLElement, entry: MailEntry): void {
    const row = parent.createDiv('pm-mail-row')
    if (entry.path === this.selected) row.addClass('pm-mail-row--selected')
    if (!entry.mail) row.addClass('pm-mail-row--unreadable')

    const head = row.createDiv('pm-mail-row-head')
    head.createSpan({ cls: 'pm-mail-from', text: entry.mail?.from || t('email.unknownSender') })
    const date = entry.mail?.date ?? ''
    head.createSpan({ cls: 'pm-mail-date', text: date ? formatDateShort(date) : '—' })

    row.createDiv({ cls: 'pm-mail-subject', text: entry.mail?.subject.trim() || entry.name })
    const preview = entry.mail?.body.trim().replace(/\s+/g, ' ') ?? t('email.unreadableShort')
    row.createDiv({ cls: 'pm-mail-snippet', text: preview.slice(0, 160) })

    row.addEventListener('click', () => {
      this.selected = entry.path
      this.paint()
    })
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.openRowMenu(e, entry)
    })
  }

  private paintPane(entry: MailEntry | null): void {
    const pane = this.paneEl
    if (!pane) return
    pane.empty()
    if (!entry) {
      new EmptyState(pane).setIcon('✉️').setTitle(t('email.pickOne'))
      return
    }
    if (!entry.mail) {
      new EmptyState(pane).setIcon('✉️').setTitle(t('email.unreadable', { name: entry.name }))
      return
    }
    renderMailPreview(pane, entry.mail, {
      fallbackTitle: entry.name,
      action: {
        label: t('email.toTicket'),
        icon: 'square-check-big',
        onClick: safeAsync(() => this.makeTicket(entry))
      }
    })
  }

  private async makeTicket(entry: MailEntry): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(entry.path)
    if (!(file instanceof TFile)) {
      new Notice(t('email.gone', { name: entry.name }))
      return
    }
    await ticketFromMessage(this.plugin, file)
    await this.onRefresh()
  }

  private openRowMenu(e: MouseEvent, entry: MailEntry): void {
    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle(t('email.toTicket'))
        .setIcon('square-check-big')
        .onClick(safeAsync(() => this.makeTicket(entry)))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('email.openTab'))
        .setIcon('external-link')
        .onClick(
          safeAsync(async () => {
            const file = this.plugin.app.vault.getAbstractFileByPath(entry.path)
            if (file instanceof TFile) await this.plugin.app.workspace.getLeaf('tab').openFile(file)
          })
        )
    )
    menu.showAtMouseEvent(e)
  }

  private renderToolbar(parent: HTMLElement): void {
    const bar = parent.createDiv('pm-mail-bar')

    const search = bar.createEl('input', { type: 'search', cls: 'pm-mail-search' })
    search.placeholder = t('email.search')
    search.value = this.query
    search.addEventListener('input', () => {
      this.query = search.value
      this.paint()
    })

    const right = bar.createDiv('pm-mail-bar-right')
    new ChipButton(right)
      .setLabel(t('count.messages', { count: this.entries.length }))
      .setShape('pill')
      .setAriaLabel(t('email.count'))

    renderSortControl(right, {
      keys: MAIL_SORT_KEYS,
      label: mailSortKeyLabel,
      order: this.order(),
      onPick: async (order) => {
        this.plugin.settings.mailSortKey = order.sortKey
        this.plugin.settings.mailSortDir = order.sortDir
        await this.plugin.saveSettings()
        this.paint()
      }
    })

    // Where the message is read. Beside the list on a wide screen, under it on a narrow
    // one, or nowhere for a reader who wants the whole width for the list itself.
    new SegmentedControl<PMSettings['mailPane']>(right, {
      options: [
        { id: 'right', label: t('email.paneRight') },
        { id: 'bottom', label: t('email.paneBottom') },
        { id: 'off', label: t('email.paneOff') }
      ],
      active: this.pane(),
      onChange: (mode) => {
        this.plugin.settings.mailPane = mode
        void this.plugin.saveSettings()
        this.render()
      }
    })
  }

  /**
   * Watches the vault for the files the mailbox lists.
   *
   * The store reloads a project when a note changes, and a `.msg` is not a note — so
   * filing the inbox, or dropping a message straight into `_mail`, would otherwise leave
   * this list showing what was there when it was opened.
   */
  private watchFiles(): void {
    if (this.watchers.length) return
    const vault = this.plugin.app.vault
    const touched = (file: TAbstractFile): void => {
      if (file instanceof TFile && file.extension === 'md') return
      // Debounced: filing ten messages out of the inbox is one reload, not ten.
      if (this.pending !== null) window.clearTimeout(this.pending)
      this.pending = window.setTimeout(() => {
        this.pending = null
        void this.load()
      }, 200)
    }
    this.watchers = [vault.on('create', touched), vault.on('delete', touched), vault.on('rename', touched)]
  }
}
