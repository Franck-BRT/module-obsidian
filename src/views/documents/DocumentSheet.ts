import { ButtonComponent, Modal, Notice, setIcon, TFile, type EventRef } from 'obsidian'
import type PMPlugin from '../../main'
import { formatBytes } from '../../store/email/EmailMessage'
import { ContactBook, readContacts } from '../../store/contacts'
import { attachComboList } from '../../ui/comboList'
import { openInWindow, revealInExplorer, shownInObsidian } from '../../store/DocumentStore'
import {
  derivedFrom,
  extensionOf,
  FAMILY_ICONS,
  familyOf,
  otherLanguages,
  versionLabel,
  type DocFamily,
  type LibraryDoc
} from '../../store/library/libraryDoc'
import { fileNameOf } from '../../store/library/DocLibrary'
import { renderFlag } from '../../ui/flags'
import { languageLabel } from '../translate/languages'
import { explain } from '../../ui/explain'
import { formatDate } from '../../dates'
import { t } from '../../i18n'
import { safeAsync } from '../../utils'

/**
 * What the document sheet asks of the library it is opened from: the actions the list
 * already has — so the sheet and the list's menu do the same thing —, and the parts of a
 * card it draws the same way.
 */
export interface DocSheetHost {
  plugin: PMPlugin
  projectTitle(path: string): string
  /** The language it is in: said in its record, else guessed from its text; '' when not known. */
  languageOf(doc: LibraryDoc): string
  openDoc(doc: LibraryDoc): Promise<void>
  openRecord(doc: LibraryDoc): Promise<void>
  editProjects(doc: LibraryDoc): Promise<void>
  editCollections(doc: LibraryDoc): void
  pickSource(doc: LibraryDoc, made: boolean): void
  pickPrevious(doc: LibraryDoc): void
  chooseLanguage(doc: LibraryDoc): void
  pickOtherLanguage(doc: LibraryDoc): void
  fileInRegister(doc: LibraryDoc): Promise<void>
  showMenu(doc: LibraryDoc, event: MouseEvent): void
  remove(doc: LibraryDoc): void
  /** Where it is followed in the projects' registers, as the list draws it; nothing when nowhere. */
  renderRegister(parent: HTMLElement, doc: LibraryDoc): void
  /** Whether the chat finds it, as the list draws it. */
  renderRagChip(parent: HTMLElement, doc: LibraryDoc): void
  /** Folders it is shown in besides its own, by its ghosts. */
  ghostFolders(doc: LibraryDoc): string[]
  redraw(): void
}

/** The values, each once, in their order: the first spelling kept. */
function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** What each kind of file is called, for whoever does not read extensions. */
const FAMILY_KEYS: Record<DocFamily, () => string> = {
  pdf: () => t('sheet.kind.pdf'),
  word: () => t('sheet.kind.word'),
  sheet: () => t('sheet.kind.sheet'),
  slides: () => t('sheet.kind.slides'),
  image: () => t('sheet.kind.image'),
  mail: () => t('sheet.kind.mail'),
  note: () => t('sheet.kind.note'),
  other: () => t('sheet.kind.other')
}

/**
 * A library document's sheet: everything known of it in one window, said in words anyone
 * reads — what it is, where its file is, which projects it serves, what it is linked to,
 * whether its content was read —, its fields to change in place, and its actions as
 * buttons. The record note stays, for notes and for those who want it, a button away.
 */
export class DocumentSheet extends Modal {
  private record: string
  private timer: number | null = null
  private cacheEvents: EventRef[] = []
  private vaultEvents: EventRef[] = []
  private stopText: (() => void) | null = null
  /** A field being typed in: the sheet is not drawn again under the reader's fingers. */
  private editing = false

  constructor(
    private host: DocSheetHost,
    doc: LibraryDoc
  ) {
    super(host.plugin.app)
    this.record = doc.record
  }

  private get plugin(): PMPlugin {
    return this.host.plugin
  }

  private doc(): LibraryDoc | undefined {
    return this.plugin.library.docs().find((one) => one.record === this.record)
  }

  onOpen(): void {
    this.modalEl.addClass('pm-sheet-modal')
    const soon = (): void => {
      if (this.timer !== null) window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => {
        this.timer = null
        if (!this.editing) this.render()
      }, 200)
    }
    // Its record changed — by the sheet, a picker, the list's menu —, or one it is linked to.
    this.cacheEvents.push(this.app.metadataCache.on('changed', soon))
    this.vaultEvents.push(
      this.app.vault.on('rename', (file, old) => {
        if (old === this.record) this.record = file.path
        soon()
      })
    )
    this.vaultEvents.push(this.app.vault.on('delete', soon))
    this.stopText = this.plugin.libraryText.onChange(soon)
    // A record made before its reference, edition and revision were: given them.
    const doc = this.doc()
    if (doc) void this.plugin.library.ensureHandFields(doc)
    this.render()
  }

  onClose(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    for (const ref of this.cacheEvents) this.app.metadataCache.offref(ref)
    for (const ref of this.vaultEvents) this.app.vault.offref(ref)
    this.stopText?.()
    this.contentEl.empty()
  }

  /** Another document's sheet, in this same window. */
  private show(other: LibraryDoc): void {
    this.record = other.record
    this.render()
    this.contentEl.scrollTop = 0
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    root.addClass('pm-sheet')
    const doc = this.doc()
    if (!doc) {
      this.setTitle(t('sheet.title'))
      root.createDiv({ cls: 'pm-sheet-gone', text: t('sheet.gone') })
      return
    }
    this.setTitle(t('sheet.title'))
    this.renderHead(root, doc)
    this.renderActions(root, doc)
    const grid = root.createDiv('pm-sheet-grid')
    this.renderIdentity(this.card(grid, 'id-card', t('sheet.identity'), t('sheet.identityHint')), doc)
    this.renderFile(this.card(grid, 'file', t('sheet.file'), t('sheet.fileHint')), doc)
    this.renderProjects(this.card(grid, 'folder-kanban', t('sheet.projects'), t('sheet.projectsHint')), doc)
    this.renderLinks(this.card(grid, 'link', t('sheet.links'), t('sheet.linksHint')), doc)
    this.renderReading(this.card(grid, 'scan-text', t('sheet.reading'), t('sheet.readingHint')), doc)
    this.renderFoot(root, doc)
  }

  private card(grid: HTMLElement, icon: string, title: string, hint: string): HTMLElement {
    const card = grid.createDiv('pm-sheet-card')
    const head = card.createDiv('pm-sheet-card-head')
    setIcon(head.createSpan('pm-sheet-card-icon'), icon)
    head.createSpan({ cls: 'pm-sheet-card-title', text: title })
    card.createDiv({ cls: 'pm-sheet-card-hint', text: hint })
    return card.createDiv('pm-sheet-card-body')
  }

  /** A line of a card: what it is, then what it says — or a dash, said as such. */
  private line(body: HTMLElement, label: string): HTMLElement {
    const row = body.createDiv('pm-sheet-line')
    row.createSpan({ cls: 'pm-sheet-label', text: label })
    return row.createDiv('pm-sheet-value')
  }

  private empty(parent: HTMLElement, text = t('sheet.none')): void {
    parent.createSpan({ cls: 'pm-sheet-empty', text })
  }

  private renderHead(root: HTMLElement, doc: LibraryDoc): void {
    const head = root.createDiv('pm-sheet-head')
    const family = familyOf(doc.file || doc.title)
    const icon = head.createDiv({ cls: `pm-sheet-icon pm-docs-icon--${family}` })
    setIcon(icon, FAMILY_ICONS[family])
    const main = head.createDiv('pm-sheet-head-main')
    // Its title, changed in place: its record and its file renamed after it.
    const title = main.createEl('input', {
      cls: 'pm-sheet-title-input',
      attr: { type: 'text', 'aria-label': t('sheet.titleField') }
    })
    title.value = doc.title
    explain(title, t('sheet.titleField'), t('sheet.titleHint'))
    title.addEventListener('focus', () => (this.editing = true))
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') title.blur()
      if (event.key === 'Escape') {
        title.value = doc.title
        title.blur()
      }
    })
    title.addEventListener(
      'blur',
      safeAsync(async () => {
        this.editing = false
        const wanted = title.value.replace(/\s+/g, ' ').trim()
        if (!wanted || wanted === doc.title) {
          title.value = doc.title
          return
        }
        if (!fileNameOf(wanted)) {
          new Notice(t('library.renameEmpty'))
          title.value = doc.title
          return
        }
        const moves = await this.plugin.library.rename(doc, wanted)
        this.record = moves.get(doc.record) ?? this.record
        const told = await this.plugin.followLibraryMoves(moves)
        const parts = [t('library.renamed', { title: wanted })]
        if (told) parts.push(t('library.registersFollowed', { count: told }))
        new Notice(parts.join('\n'), told ? 8000 : 4000)
        this.host.redraw()
        this.render()
      })
    )
    // What it is at a glance: its kind, its version, its language, whether it is a reference.
    const badges = main.createDiv('pm-sheet-badges')
    const badge = (text: string, cls = '', icon = ''): HTMLElement => {
      const one = badges.createSpan({ cls: `pm-sheet-badge ${cls}` })
      if (icon) setIcon(one.createSpan('pm-sheet-badge-icon'), icon)
      one.createSpan({ text })
      return one
    }
    badge(`${FAMILY_KEYS[family]()}${extensionOf(doc.file) ? ` · ${extensionOf(doc.file).toUpperCase()}` : ''}`)
    if (doc.reference) badge(doc.reference, 'is-ref')
    const version = versionLabel(doc)
    if (version) badge(t('sheet.versionBadge', { version }), 'is-version')
    const language = this.host.languageOf(doc)
    if (language) {
      const flag = badge(languageLabel(language), 'is-language')
      renderFlag(flag, language).addClass('pm-sheet-flag')
      flag.prepend(flag.lastElementChild ?? flag)
    }
    const reference = this.plugin.referenceFolder()
    if (doc.folder === reference || doc.folder.startsWith(`${reference}/`)) {
      explain(
        badge(t('library.referenceStar'), 'is-star', 'star'),
        t('library.referenceStar'),
        t('library.referenceStarHint', { reference })
      )
    }
    if (!doc.file) badge(t('library.fileMissing'), 'is-missing', 'file-x')
  }

  private renderActions(root: HTMLElement, doc: LibraryDoc): void {
    const bar = root.createDiv('pm-sheet-actions')
    const button = (text: string, icon: string, run: () => void | Promise<void>, cta = false): ButtonComponent => {
      const one = new ButtonComponent(bar).setButtonText(text).onClick(safeAsync(async () => run()))
      setIcon(one.buttonEl.createSpan({ cls: 'pm-sheet-button-icon' }), icon)
      one.buttonEl.prepend(one.buttonEl.lastElementChild ?? one.buttonEl)
      if (cta) one.setCta()
      return one
    }
    button(t('library.open'), 'file-search', () => this.host.openDoc(doc), true).setDisabled(!doc.file)
    button(t('library.askChat'), 'messages-square', () => {
      this.close()
      return this.plugin.chatAboutDocuments([doc.file])
    }).setDisabled(!doc.file)
    button(t('sheet.toRegister'), 'clipboard-list', () => this.host.fileInRegister(doc)).setDisabled(!doc.file)
    const more = button(t('sheet.more'), 'more-horizontal', () => undefined)
    more.buttonEl.addEventListener('click', (event) => this.host.showMenu(doc, event))
  }

  /** What it is: its reference, edition and revision, its kind, lot and issuer — to change here. */
  private renderIdentity(body: HTMLElement, doc: LibraryDoc): void {
    const field = (
      label: string,
      value: string,
      placeholder: string,
      save: (value: string) => Promise<void>,
      options: string[] = []
    ): void => {
      const input = this.line(body, label).createEl('input', {
        cls: 'pm-sheet-input',
        attr: { type: 'text', placeholder }
      })
      input.value = value
      // Every choice offered on a click, not only the one the field holds; one taken is saved.
      const blur = (): void => input.blur()
      if (options.length) attachComboList(input, () => options, blur)
      input.addEventListener('focus', () => (this.editing = true))
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur()
      })
      input.addEventListener(
        'blur',
        safeAsync(async () => {
          this.editing = false
          if (input.value.trim() === value.trim()) return
          await save(input.value.trim())
          this.host.redraw()
        })
      )
    }
    const classification = { category: doc.category, lot: doc.lot, issuer: doc.issuer, tags: doc.tags }
    const choices = this.plugin.libraryChoices()
    // The lots of its projects first, then those the library files under; the people folder's names after the issuers known.
    const lots = unique([...(choices.lotsFor?.(doc.projects) ?? []), ...choices.lots])
    const people = new ContactBook(readContacts(this.app, this.plugin.settings.peopleFolder)).names()
    const issuers = unique([...choices.issuers, ...people])
    field(t('sheet.reference'), doc.reference ?? '', t('sheet.referencePlaceholder'), (reference) =>
      this.plugin.library.setHandFields(doc, { reference })
    )
    field(t('sheet.edition'), doc.edition ?? '', t('sheet.editionPlaceholder'), (edition) =>
      this.plugin.library.setHandFields(doc, { edition })
    )
    field(t('sheet.revision'), doc.revision ?? '', t('sheet.revisionPlaceholder'), (revision) =>
      this.plugin.library.setHandFields(doc, { revision })
    )
    field(
      t('sheet.category'),
      doc.category,
      t('sheet.categoryPlaceholder'),
      async (category) => {
        await this.plugin.library.setClassification(doc, { ...classification, category })
        await this.plugin.rememberCategory(category)
      },
      choices.categories
    )
    field(
      t('sheet.lot'),
      doc.lot,
      t('sheet.lotPlaceholder'),
      (lot) => this.plugin.library.setClassification(doc, { ...classification, lot }),
      lots
    )
    field(
      t('sheet.issuer'),
      doc.issuer,
      t('sheet.issuerPlaceholder'),
      (issuer) => this.plugin.library.setClassification(doc, { ...classification, issuer }),
      issuers
    )
    // Its language: said, and changed by the list's own window.
    const language = this.line(body, t('sheet.language'))
    const code = this.host.languageOf(doc)
    if (code) {
      renderFlag(language, code).addClass('pm-sheet-flag')
      language.createSpan({ text: languageLabel(code) })
      if (!doc.language) language.createSpan({ cls: 'pm-sheet-muted', text: t('sheet.languageGuessed') })
    } else this.empty(language, t('library.langUnknown'))
    this.link(language, t('sheet.change'), () => this.host.chooseLanguage(doc))
  }

  /** Where its file is, how big, since when — and the folders it is shown in. */
  private renderFile(body: HTMLElement, doc: LibraryDoc): void {
    const name = this.line(body, t('sheet.fileName'))
    if (doc.file) name.createSpan({ cls: 'pm-sheet-strong', text: doc.file.slice(doc.file.lastIndexOf('/') + 1) })
    else name.createSpan({ cls: 'pm-sheet-warning', text: t('sheet.fileLost') })
    if (doc.size) this.line(body, t('sheet.size')).setText(formatBytes(doc.size, this.units()))
    if (doc.added) this.line(body, t('sheet.added')).setText(formatDate(doc.added))
    this.line(body, t('sheet.folder')).setText(doc.folder || t('library.rootFolder'))
    const ghosts = this.host.ghostFolders(doc)
    if (ghosts.length) {
      this.line(body, t('sheet.alsoShown')).setText(
        ghosts.map((folder) => folder || t('library.rootFolder')).join(' · ')
      )
    }
    if (doc.file) {
      const where = this.line(body, t('sheet.path'))
      where.createSpan({ cls: 'pm-sheet-path', text: doc.file })
    }
    const file = doc.file ? this.app.vault.getAbstractFileByPath(doc.file) : null
    if (!(file instanceof TFile)) return
    // Where it is, in Obsidian's own explorer; and the file itself, in a window of its own.
    const actions = body.createDiv('pm-sheet-file-actions')
    const button = (text: string, icon: string, tip: string, run: () => Promise<void>): void => {
      const one = new ButtonComponent(actions).setButtonText(text).onClick(safeAsync(run))
      setIcon(one.buttonEl.createSpan({ cls: 'pm-sheet-button-icon' }), icon)
      one.buttonEl.prepend(one.buttonEl.lastElementChild ?? one.buttonEl)
      explain(one.buttonEl, text, tip)
    }
    button(t('sheet.reveal'), 'folder-open', t('sheet.revealHint'), async () => {
      if (!(await revealInExplorer(this.app, file))) {
        new Notice(t('sheet.noExplorer'))
        return
      }
      // The explorer is behind the sheet: the sheet steps aside for it.
      this.close()
    })
    const shown = shownInObsidian(file)
    button(
      shown ? t('sheet.openWindow') : t('sheet.openSystem'),
      shown ? 'app-window' : 'external-link',
      shown ? t('sheet.openWindowHint') : t('sheet.openSystemHint', { ext: file.extension.toUpperCase() }),
      async () => {
        const where = await openInWindow(this.app, file)
        if (!where) new Notice(t('library.cannotOpen', { name: file.name }))
      }
    )
  }

  /** The projects it serves, the collections it is gathered in, its tags. */
  private renderProjects(body: HTMLElement, doc: LibraryDoc): void {
    const projects = this.line(body, t('sheet.projectsLine'))
    const chips = projects.createDiv('pm-sheet-chips')
    if (!doc.projects.length) this.empty(chips, t('library.noProject'))
    for (const path of doc.projects) chips.createSpan({ cls: 'pm-sheet-chip', text: this.host.projectTitle(path) })
    this.link(projects, t('sheet.change'), () => this.host.editProjects(doc))

    const collections = this.line(body, t('sheet.collections'))
    const gathered = collections.createDiv('pm-sheet-chips')
    if (!(doc.collections ?? []).length) this.empty(gathered)
    for (const name of doc.collections ?? []) gathered.createSpan({ cls: 'pm-sheet-chip', text: name })
    this.link(collections, t('sheet.change'), () => this.host.editCollections(doc))

    const tags = this.line(body, t('sheet.tags'))
    const tagged = tags.createDiv('pm-sheet-chips')
    for (const tag of doc.tags) {
      const chip = tagged.createSpan({ cls: 'pm-sheet-chip is-tag', text: `#${tag}` })
      const off = chip.createEl('button', {
        cls: 'pm-sheet-chip-off',
        attr: { 'aria-label': t('sheet.untag', { tag }) }
      })
      setIcon(off, 'x')
      off.addEventListener(
        'click',
        safeAsync(async () => {
          await this.plugin.library.untag(doc, [tag])
          this.host.redraw()
        })
      )
    }
    const add = tagged.createEl('input', {
      cls: 'pm-sheet-tag-input',
      attr: { type: 'text', placeholder: t('sheet.addTag') }
    })
    add.addEventListener('focus', () => (this.editing = true))
    add.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') add.blur()
    })
    add.addEventListener(
      'blur',
      safeAsync(async () => {
        this.editing = false
        const tag = add.value.replace(/^#/, '').trim()
        if (!tag) return
        await this.plugin.library.classify(doc, { tags: [tag] })
        this.host.redraw()
      })
    )

    const registers = this.line(body, t('sheet.registers'))
    const before = registers.childElementCount
    this.host.renderRegister(registers, doc)
    if (registers.childElementCount === before) this.empty(registers, t('sheet.notInRegister'))
  }

  /** What it is linked to: its versions, what it was made from and into, its other languages. */
  private renderLinks(body: HTMLElement, doc: LibraryDoc): void {
    const all = this.plugin.library.docs()
    const byRecord = (path: string | undefined): LibraryDoc | undefined =>
      path ? all.find((one) => one.record === path) : undefined

    const previous = byRecord(doc.previous)
    const next = all.find((one) => one.previous === doc.record)
    const versions = this.line(body, t('sheet.previous'))
    if (previous) {
      this.docLink(versions, previous)
      this.link(versions, t('sheet.compare'), () => {
        this.close()
        return this.plugin.chatCompare(previous.file, doc.file)
      })
      this.unlink(versions, t('library.unlinkVersion', { title: previous.title }), () =>
        this.plugin.library.setPrevious(doc, null)
      )
    } else {
      this.empty(versions)
      this.link(versions, t('sheet.setPrevious'), () => this.host.pickPrevious(doc))
    }
    if (next) this.docLink(this.line(body, t('sheet.next')), next)

    const sources = (doc.sources ?? []).map(byRecord).filter((one): one is LibraryDoc => !!one)
    const from = this.line(body, t('sheet.sources'))
    if (!sources.length) this.empty(from)
    for (const source of sources) {
      const item = from.createDiv('pm-sheet-link-item')
      this.docLink(item, source)
      this.unlink(item, t('library.sourceUnlinkOne', { title: source.title }), () =>
        this.plugin.library.removeSource(doc, source)
      )
    }
    this.link(from, t('sheet.addSource'), () => this.host.pickSource(doc, false))

    const derived = derivedFrom(doc, all)
    const into = this.line(body, t('sheet.derived'))
    if (!derived.length) this.empty(into)
    for (const one of derived) this.docLink(into.createDiv('pm-sheet-link-item'), one)
    this.link(into, t('sheet.addDerived'), () => this.host.pickSource(doc, true))

    const others = otherLanguages(doc, all)
    const languages = this.line(body, t('sheet.otherLanguages'))
    if (!others.length) this.empty(languages)
    for (const other of others) {
      const item = languages.createDiv('pm-sheet-link-item')
      const code = this.host.languageOf(other)
      if (code) renderFlag(item, code).addClass('pm-sheet-flag')
      this.docLink(item, other)
    }
    this.link(languages, t('sheet.addLanguage'), () => this.host.pickOtherLanguage(doc))
    if (others.length) {
      this.unlink(languages, t('library.langUnlinkMenu'), () => this.plugin.library.unlinkLanguages(doc))
    }
  }

  /** Whether its content was read — what the search and the chat find it by —, and what to do when not. */
  private renderReading(body: HTMLElement, doc: LibraryDoc): void {
    const texts = this.plugin.libraryText
    const state = this.line(body, t('sheet.content'))
    const queued = this.plugin.scans.stateOf(doc.record)
    const reason = texts.unreadReason(doc)
    const entry = texts.entry(doc)
    if (queued) {
      state.createSpan({
        cls: 'pm-sheet-info',
        text: queued === 'reading' ? t('sheet.readingNow') : t('sheet.readingQueued')
      })
    } else if (!reason && entry) {
      const words = entry.text.split(/\s+/).filter(Boolean).length
      state.createSpan({ cls: 'pm-sheet-ok', text: t('sheet.read', { count: words }) })
      if (entry.ocr) state.createSpan({ cls: 'pm-sheet-muted', text: t('sheet.readByModel') })
    } else {
      state.createSpan({ cls: 'pm-sheet-warning', text: t(`sheet.unread.${reason ?? 'pending'}`) })
    }
    const chat = this.line(body, t('sheet.chat'))
    const before = chat.childElementCount
    this.host.renderRagChip(chat, doc)
    if (chat.childElementCount === before) this.empty(chat)

    const actions = body.createDiv('pm-sheet-card-actions')
    const family = familyOf(doc.file || doc.title)
    if (doc.file && (family === 'pdf' || family === 'image') && !queued) {
      this.link(actions, t('library.readScan'), () =>
        this.plugin.askAndReadScans([doc], this.plugin.libraryText.entry(doc)?.ocr === true)
      )
    }
    if (doc.file) this.link(actions, t('library.reread'), () => this.plugin.libraryText.reread(doc))
  }

  private renderFoot(root: HTMLElement, doc: LibraryDoc): void {
    const foot = root.createDiv('pm-sheet-foot')
    const notes = foot.createEl('a', { href: '#', text: t('sheet.openNote') })
    explain(notes, t('sheet.openNote'), t('sheet.openNoteHint'))
    notes.addEventListener(
      'click',
      safeAsync(async (event: MouseEvent) => {
        event.preventDefault()
        this.close()
        await this.host.openRecord(doc)
      })
    )
    const remove = foot.createEl('a', { cls: 'pm-sheet-remove', href: '#', text: t('library.remove') })
    remove.addEventListener('click', (event) => {
      event.preventDefault()
      this.close()
      this.host.remove(doc)
    })
  }

  /** Another document named in the sheet: a click shows its own sheet. */
  private docLink(parent: HTMLElement, doc: LibraryDoc): void {
    const family = familyOf(doc.file || doc.title)
    const link = parent.createEl('a', { cls: 'pm-sheet-doc', href: '#' })
    setIcon(link.createSpan({ cls: `pm-sheet-doc-icon pm-docs-icon--${family}` }), FAMILY_ICONS[family])
    link.createSpan({ text: doc.title })
    const version = versionLabel(doc)
    if (version) link.createSpan({ cls: 'pm-sheet-muted', text: version })
    explain(link, doc.title, t('sheet.showOther'))
    link.addEventListener('click', (event) => {
      event.preventDefault()
      this.show(doc)
    })
  }

  private link(parent: HTMLElement, text: string, run: () => unknown): void {
    const link = parent.createEl('a', { cls: 'pm-sheet-action', href: '#', text })
    link.addEventListener(
      'click',
      safeAsync(async (event: MouseEvent) => {
        event.preventDefault()
        await run()
      })
    )
  }

  private unlink(parent: HTMLElement, label: string, run: () => Promise<void>): void {
    const button = parent.createEl('button', { cls: 'pm-sheet-unlink clickable-icon', attr: { 'aria-label': label } })
    setIcon(button, 'unlink')
    button.addEventListener(
      'click',
      safeAsync(async () => {
        await run()
        this.host.redraw()
      })
    )
  }

  private units(): string[] {
    return [t('unit.bytes'), t('unit.kilobytes'), t('unit.megabytes'), t('unit.gigabytes')]
  }
}
