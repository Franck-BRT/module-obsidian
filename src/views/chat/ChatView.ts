import {
  Component,
  ItemView,
  Menu,
  MarkdownRenderer,
  MarkdownView,
  normalizePath,
  Notice,
  setIcon,
  SuggestModal,
  TFile,
  type App,
  type ViewStateResult,
  type WorkspaceLeaf
} from 'obsidian'
import type PMPlugin from '../../main'
import {
  chatMessages,
  currentContext,
  readableNote,
  withNote,
  withoutFailure,
  type ChatTurn,
  type ContextNote
} from '../../store/chat/chatSession'
import { branches, chatTitle, isChatNote, localStamp, type ChatNoteWords } from '../../store/chat/chatNote'
import { ChatNotes } from '../../store/chat/ChatNotes'
import { currentRequirements, requirementsContext, type RequirementWords } from '../../store/chat/chatRequirements'
import {
  collectionParts,
  currentCollections,
  currentProjects,
  projectContext,
  projectParts,
  projectShare,
  withoutNested,
  type ProjectWords
} from '../../store/chat/chatProject'
import { changeBlocks, parseChange, withoutOpenChange } from '../../store/chat/chatChange'
import { applyCreate, applyToRequirement, applyToTicket, type Applied } from '../../store/chat/applyChange'
import {
  currentFiles,
  excerptFor,
  fileShare,
  questionWords,
  fileText,
  filesContext,
  FileReadError,
  isImage,
  isReadable,
  readPdfText,
  type ContextFile,
  type FileProblem
} from '../../store/chat/chatFile'
import { needsOcr, transcriptPath } from '../../store/chat/ocr'
import { scanPages, transcribeScan } from './scanReader'
import { notesFallback } from './noteCard'
import { calledSkills, readSkill, skillBody, skillsContext, type Skill } from '../../store/chat/skills'
import { LibraryDocPicker } from '../documents/LibraryDocPicker'
import { sortDocs, type LibraryDoc } from '../../store/library/libraryDoc'
import { keepDroppedFile } from '../../store/chat/keepFile'
import { chatModel, chatModels } from '../../store/chat/chatModels'
import { availablePrompts, parsePrompts, type ChatPrompt } from '../../store/chat/chatPrompts'
import { builtinPrompts, scopeIcon } from './chatPresets'
import { requirementOptions } from './changeCard'
import type { Requirement } from '../../store/requirements/Requirement'
import { ProjectScope, resolveScopePaths, type ScopeSpec } from '../../store/ProjectScope'
import { collectionMemberIds } from '../../store/Collection'
import type { ProjectRef } from '../../store/VaultIndex'
import { docStateConfigOf, typeConfigOf } from '../../store/TicketPalette'
import { TASK_TYPES, type DocState, type TaskType } from '../../types'
import { today } from '../../dates'
import {
  reqCriticalityGlyph,
  reqLinkKindLabel,
  reqStatusGlyph,
  reqLanguages,
  reqTypeGlyph,
  verificationLabel
} from '../requirements/reqPalette'
import { LlmClient, LlmError } from '../../store/llm'
import { displayName, safeAsync, sanitizeFileName } from '../../utils'
import { fillPrompt, promptParams } from '../../store/chat/promptParams'
import { withSelection } from '../../store/chat/selection'
import { branchEnd, conversationTree, threadTo } from '../../store/chat/chatBranches'
import { BranchModal } from './branchGraph'
import { askParams } from './ParamModal'
import { replyNoteContent, replyTitle, withoutChangeBlocks } from '../../store/chat/replyNote'
import { freePath } from '../../store/DocumentStore'
import { ensureFolder } from '../../store/vaultFs'
import { t } from '../../i18n'

export const PM_CHAT_VIEW_TYPE = 'pm-chat'

/**
 * A conversation with the language model the plugin is already set up to use.
 *
 * The same gateway, the same text model and the same limits as the requirement reviews,
 * so there is one place where the model is chosen and one where it is switched off.
 *
 * Every exchange is kept in a note as soon as the reply arrives, so closing the panel —
 * or Obsidian — loses nothing, and any conversation can be taken up again from its note.
 */
export class ChatView extends ItemView {
  private turns: ChatTurn[] = []
  private pending = false
  /** The note this conversation is kept in, once its first reply has arrived. */
  private notePath: string | null = null
  /** The turns already in the note, by identity: a failed reply taken off shifts no index. */
  private saved = new WeakSet<ChatTurn>()
  private notes: ChatNotes
  /** The note open beside the conversation, which a question can be asked about. */
  private contextFile: TFile | null = null
  /** Whether that note goes with the next question: the reader's to turn off. */
  private useNote = true
  /** Requirements chosen in the library, sent with every question until taken off. */
  private attached: string[] = []
  /** The projects talked about, by the paths of their notes: sent with every question until taken off. */
  private projects: string[] = []
  /** The collections talked about, by the paths of their notes: sent like the projects. */
  private collections: string[] = []
  /**
   * Where the next question goes on from when the reader went back to an older branch:
   * the time of that branch's last question. Null on the latest branch.
   */
  private follows: string | null = null
  /** Whether the conversation has branched: the way to its branches is then shown. */
  private branched = false
  /** The question being rewritten, whose place the next one sent takes. */
  private editing: ChatTurn | null = null
  /** A passage chosen in a note, for the next question only. */
  private selection: { text: string; path: string } | null = null
  private contextEl: HTMLElement | null = null
  /** The ready questions offered while the conversation is empty. */
  private presetsEl: HTMLElement | null = null
  /** Files attached — a planning, a report — by path, sent with every question until taken off. */
  private files: string[] = []
  /** The skills in use: their instructions go with every question until taken off. */
  private skills: string[] = []
  /** Files already read, by path and way of reading, with the modification time they were read at. */
  private fileCache = new Map<string, { mtime: number; text: string }>()
  /** PDFs the reader asked to have read as pictures, whatever text they hold. */
  private ocrForced = new Set<string>()
  /** The reply being written, drawn as it grows; null when none is. */
  private liveEl: HTMLElement | null = null
  private liveText = ''
  private liveTimer: number | null = null
  /**
   * What the replies' Markdown hangs off, replaced at every redraw: a proposal card
   * watches the vault for as long as it lives, and one left behind by each redraw would
   * go on watching for a card no longer on screen.
   */
  private turnsComponent: Component | null = null
  /** What the live reply's Markdown hangs off, replaced at every redraw. */
  private liveComponent: Component | null = null
  /** Stops the reply being written. */
  private stopper: AbortController | null = null
  private listEl!: HTMLElement
  private inputEl!: HTMLTextAreaElement
  private sendEl!: HTMLButtonElement

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
    this.notes = new ChatNotes(this.app, () => this.plugin.settings.chat.folder)
  }

  getViewType(): string {
    return PM_CHAT_VIEW_TYPE
  }
  getDisplayText(): string {
    return t('chat.title')
  }
  getIcon(): string {
    return 'messages-square'
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    // The note may be renamed or moved while the conversation goes on; the next exchange
    // follows it rather than starting a second note.
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (oldPath === this.notePath) this.notePath = file.path
        if (this.projects.includes(oldPath)) {
          this.projects = this.projects.map((path) => (path === oldPath ? file.path : path))
          this.renderContext()
        }
        if (this.collections.includes(oldPath)) {
          this.collections = this.collections.map((path) => (path === oldPath ? file.path : path))
          this.renderContext()
        }
        if (this.files.includes(oldPath)) {
          this.files = this.files.map((path) => (path === oldPath ? file.path : path))
          this.renderContext()
        }
        if (this.skills.includes(oldPath)) {
          this.skills = this.skills.map((path) => (path === oldPath ? file.path : path))
          this.renderContext()
        }
        if (file === this.contextFile) this.renderContext()
      })
    )
    // The note beside the conversation follows the reader: the last one they opened, and
    // none once it is closed. Only the strip that shows it is redrawn, so a question
    // being typed is not lost to a click elsewhere.
    this.contextFile = this.openNote()
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!file || !this.eligible(file)) return
        this.contextFile = file
        this.renderContext()
      })
    )
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.contextFile && this.showing(this.contextFile)) return
        this.contextFile = this.openNote()
        this.renderContext()
      })
    )
    // A file dropped on the panel is kept in the vault, then attached.
    this.registerDomEvent(this.containerEl, 'dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      this.contentEl.addClass('pm-chat--drop')
    })
    this.registerDomEvent(this.containerEl, 'dragleave', (event) => {
      if (!this.containerEl.contains(event.relatedTarget as Node | null)) this.contentEl.removeClass('pm-chat--drop')
    })
    this.registerDomEvent(this.containerEl, 'drop', (event) => {
      this.contentEl.removeClass('pm-chat--drop')
      const dropped = event.dataTransfer?.files
      if (!dropped?.length) return
      event.preventDefault()
      void this.dropFiles(Array.from(dropped), { x: event.clientX, y: event.clientY })
    })
    this.render()
    return Promise.resolve()
  }

  /** The note, remembered with the workspace, so the conversation is there after a restart. */
  getState(): Record<string, unknown> {
    return this.notePath ? { notePath: this.notePath } : {}
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const path = (state as { notePath?: unknown } | null)?.notePath
    if (typeof path === 'string' && path !== this.notePath) {
      const file = this.app.vault.getAbstractFileByPath(path)
      if (file instanceof TFile) await this.resume(file)
    }
    await super.setState(state, result)
  }

  /** A note a question can be about: Markdown, and not one of the conversations themselves. */
  private eligible(file: TFile): boolean {
    return file.extension === 'md' && !isChatNote(this.app.metadataCache.getFileCache(file)?.frontmatter)
  }

  private showing(file: TFile): boolean {
    return this.app.workspace.getLeavesOfType('markdown').some((leaf) => (leaf.view as MarkdownView).file === file)
  }

  /** The note the reader was last in, in the main area, if it is one a question can be about. */
  private openNote(): TFile | null {
    const view = this.app.workspace.getMostRecentLeaf()?.view
    const file = view instanceof MarkdownView ? view.file : this.app.workspace.getActiveFile()
    return file && this.eligible(file) ? file : null
  }

  /**
   * The strip above the box: what goes with the next question — the note, and the
   * requirements chosen in the library — each with the switch to leave it out.
   */
  private renderContext(): void {
    // What is offered follows what is attached.
    this.renderPresets()
    const el = this.contextEl
    if (!el) return
    el.empty()
    const file = this.contextFile
    const noteRow = el.createDiv('pm-chat-context-row')
    noteRow.toggleClass('pm-chat-context--empty', !file)
    noteRow.toggleClass('pm-chat-context--off', !!file && !this.useNote)
    setIcon(noteRow.createSpan({ cls: 'pm-chat-context-icon' }), 'file-text')
    if (!file) noteRow.createSpan({ cls: 'pm-chat-context-name', text: t('chat.noNote') })
    else {
      const name = noteRow.createEl('a', {
        cls: 'pm-chat-context-name',
        text: file.basename,
        attr: { title: file.path }
      })
      name.addEventListener(
        'click',
        safeAsync(() => this.app.workspace.getLeaf(false).openFile(file))
      )
      const toggle = noteRow.createEl('button', {
        cls: 'clickable-icon',
        attr: { 'aria-label': this.useNote ? t('chat.noteOff') : t('chat.noteOn') }
      })
      setIcon(toggle, this.useNote ? 'eye' : 'eye-off')
      toggle.addEventListener('click', () => {
        this.useNote = !this.useNote
        this.renderContext()
      })
    }

    this.renderSelectionRow(el)
    this.renderProjectRows(el)
    this.renderFileRows(el)
    this.renderSkillRows(el)

    if (!this.attached.length) return
    const reqRow = el.createDiv('pm-chat-context-row')
    setIcon(reqRow.createSpan({ cls: 'pm-chat-context-icon' }), 'list-checks')
    const list = this.attached.join(', ')
    reqRow.createSpan({
      cls: 'pm-chat-context-name',
      text: t('chat.requirements', { count: this.attached.length, list }),
      attr: { title: list }
    })
    const detach = reqRow.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.detach') } })
    setIcon(detach, 'x')
    detach.addEventListener('click', () => {
      this.attached = []
      this.renderContext()
    })
  }

  /**
   * The project and collection rows: one each attached, each with the way to take it off,
   * and on the last the way to add another — or, with none, the way to choose one.
   */
  private renderProjectRows(el: HTMLElement): void {
    const rows: { path: string; title: string; icon: string; open: () => Promise<void>; off: () => void }[] = []
    for (const path of this.projects) {
      const ref = this.plugin.index.projectRef(path)
      if (!ref) continue
      rows.push({
        path,
        title: ref.program ? `${ref.title} (${t('chat.projectProgram')})` : ref.title,
        icon: 'folder-kanban',
        open: () => this.plugin.router.openProjectLink(ref.path),
        off: () => {
          this.projects = this.projects.filter((each) => each !== path)
        }
      })
    }
    for (const path of this.collections) {
      const ref = this.plugin.index.collectionRef(path)
      if (!ref) continue
      rows.push({
        path,
        title: ref.title,
        icon: 'library',
        open: () => this.plugin.router.openScope({ kind: 'collection', path }),
        off: () => {
          this.collections = this.collections.filter((each) => each !== path)
        }
      })
    }
    const add = (row: HTMLElement, label: string): void => {
      const pick = row.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } })
      setIcon(pick, 'plus')
      pick.addEventListener('click', () => this.pickProject())
    }
    if (!rows.length) {
      const row = el.createDiv('pm-chat-context-row pm-chat-context--empty')
      setIcon(row.createSpan({ cls: 'pm-chat-context-icon' }), 'folder-kanban')
      row.createSpan({ cls: 'pm-chat-context-name', text: t('chat.noProject') })
      add(row, t('chat.pickProject'))
      return
    }
    rows.forEach((entry, at) => {
      const row = el.createDiv('pm-chat-context-row')
      setIcon(row.createSpan({ cls: 'pm-chat-context-icon' }), entry.icon)
      const name = row.createEl('a', {
        cls: 'pm-chat-context-name',
        text: entry.title,
        attr: { title: t('chat.projectOpen') }
      })
      name.addEventListener('click', safeAsync(entry.open))
      if (at === rows.length - 1) add(row, t('chat.pickAnotherProject'))
      const off = row.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.projectOff') } })
      setIcon(off, 'x')
      off.addEventListener('click', () => {
        entry.off()
        this.renderContext()
      })
    })
  }

  /** The passage chosen for the next question, with its size and the way to leave it out. */
  private renderSelectionRow(el: HTMLElement): void {
    const chosen = this.selection
    if (!chosen) return
    const row = el.createDiv('pm-chat-context-row')
    setIcon(row.createSpan({ cls: 'pm-chat-context-icon' }), 'text-select')
    const name = chosen.path.replace(/^.*\//, '').replace(/\.md$/i, '')
    row.createSpan({
      cls: 'pm-chat-context-name',
      text: t('chat.selection', { name, count: chosen.text.length }),
      attr: { title: chosen.text.slice(0, 500) }
    })
    const off = row.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.selectionOff') } })
    setIcon(off, 'x')
    off.addEventListener('click', () => {
      this.selection = null
      this.renderContext()
    })
  }

  /**
   * A passage to ask about, chosen in a note: it goes with the next question, quoted
   * under it, and the ready questions for a passage are offered first.
   */
  attachSelection(text: string, path: string): void {
    this.selection = { text, path }
    this.renderContext()
    window.setTimeout(() => this.inputEl?.focus(), 0)
  }

  /** One row a file attached, with the way to open it and the way to take it off. */
  private renderFileRows(el: HTMLElement): void {
    // A document of the library goes by its title, as it does there.
    const titles = new Map(this.plugin.library.docs().map((doc) => [doc.file, doc.title]))
    for (const path of this.files) {
      const row = el.createDiv('pm-chat-context-row')
      const title = titles.get(path)
      setIcon(row.createSpan({ cls: 'pm-chat-context-icon' }), title ? 'library-big' : 'paperclip')
      const name = row.createEl('a', {
        cls: 'pm-chat-context-name',
        text: title ?? path.slice(path.lastIndexOf('/') + 1),
        attr: { title: path }
      })
      name.addEventListener(
        'click',
        safeAsync(() => this.app.workspace.openLinkText(path, '', 'tab'))
      )
      // A transcription already made is the reader's to check, one click away.
      const transcript = this.app.vault.getAbstractFileByPath(transcriptPath(path, t('chat.ocrSuffix')))
      if (transcript instanceof TFile) {
        const open = row.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.ocrOpen') } })
        setIcon(open, 'file-scan')
        open.addEventListener(
          'click',
          safeAsync(() => this.app.workspace.getLeaf('tab').openFile(transcript))
        )
      }
      // A PDF with a title block around a picture of the planning: its text is not the
      // document, and the reader can say so.
      if (path.toLowerCase().endsWith('.pdf')) {
        const forced = this.ocrForced.has(path)
        const scan = row.createEl('button', {
          cls: `clickable-icon${forced ? ' is-active' : ''}`,
          attr: { 'aria-label': forced ? t('chat.ocrOff') : t('chat.ocrOn'), 'aria-pressed': String(forced) }
        })
        setIcon(scan, 'scan-text')
        scan.addEventListener('click', () => {
          if (forced) this.ocrForced.delete(path)
          else this.ocrForced.add(path)
          this.renderContext()
        })
      }
      const off = row.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.fileOff') } })
      setIcon(off, 'x')
      off.addEventListener('click', () => {
        this.files = this.files.filter((each) => each !== path)
        this.renderContext()
      })
    }
  }

  /** Every skill in the vault, found by its property wherever its note is. */
  private allSkills(): Skill[] {
    const skills: Skill[] = []
    for (const file of this.app.vault.getMarkdownFiles()) {
      const skill = readSkill(file.path, file.basename, this.app.metadataCache.getFileCache(file)?.frontmatter)
      if (skill) skills.push(skill)
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** One row a skill in use, with the way to read it and the way to take it off. */
  private renderSkillRows(el: HTMLElement): void {
    const known = new Map(this.allSkills().map((skill) => [skill.path, skill]))
    for (const path of this.skills) {
      const skill = known.get(path)
      const row = el.createDiv('pm-chat-context-row pm-chat-skill-row')
      setIcon(row.createSpan({ cls: 'pm-chat-context-icon' }), 'sparkles')
      const name = row.createEl('a', {
        cls: 'pm-chat-context-name',
        text: skill?.name ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
        attr: { title: skill?.description || path }
      })
      name.addEventListener(
        'click',
        safeAsync(() => this.app.workspace.openLinkText(path, '', 'tab'))
      )
      const off = row.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.skillOff') } })
      setIcon(off, 'x')
      off.addEventListener('click', () => {
        this.skills = this.skills.filter((each) => each !== path)
        this.renderContext()
      })
    }
  }

  /** A skill taken up: its instructions go with every question from here on, until taken off. */
  attachSkill(path: string): void {
    if (!this.skills.includes(path)) this.skills = [...this.skills, path]
    this.renderContext()
    window.setTimeout(() => this.inputEl?.focus(), 0)
  }

  /** The skills to take up, by name and what they are for. */
  private pickSkill(): void {
    const skills = this.allSkills().filter((skill) => !this.skills.includes(skill.path))
    if (!skills.length) {
      new Notice(t('chat.skillNone'), 10000)
      return
    }
    new SkillPicker(this.app, skills, (skill) => this.attachSkill(skill.path)).open()
  }

  /** The skills in use, their notes read now — the reader may have just changed one. */
  private async skillsBlock(paths: string[]): Promise<string> {
    const known = new Map(this.allSkills().map((skill) => [skill.path, skill]))
    const entries: { skill: Skill; body: string }[] = []
    for (const path of paths) {
      const skill = known.get(path)
      const file = this.app.vault.getAbstractFileByPath(path)
      if (!skill || !(file instanceof TFile)) continue
      entries.push({ skill, body: skillBody(await this.app.vault.cachedRead(file)) })
    }
    const block = skillsContext(entries, {
      heading: (name) => t('chat.skillHeading', { name }),
      folder: (folder) => t('chat.skillFolder', { folder })
    })
    return block ? `${t('chat.skillIntro')}\n\n${block}` : ''
  }

  /**
   * A file to read with the questions: it goes with every one from here on, until taken
   * off, like the note and the project.
   */
  attachFile(path: string): void {
    this.attachFiles([path])
  }

  /** Several files at once: documents chosen in the library, or all of a project's. */
  attachFiles(paths: string[]): void {
    const added = paths.filter((path) => !this.files.includes(path))
    if (added.length) this.files = [...this.files, ...added]
    this.renderContext()
    window.setTimeout(() => this.inputEl?.focus(), 0)
  }

  /**
   * What can be joined to the questions: a file of the vault, a document of the library —
   * found by what it says as well as by its name — or, in one go, every document the
   * library holds for a project attached.
   */
  private showAttachMenu(event: MouseEvent): void {
    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle(t('chat.attachVault'))
        .setIcon('paperclip')
        .onClick(() => this.pickFile())
    )
    const docs = this.plugin.library.docs().filter((doc) => doc.file && !this.files.includes(doc.file))
    menu.addItem((item) =>
      item
        .setTitle(t('chat.attachLibrary'))
        .setIcon('library-big')
        .setDisabled(!docs.length)
        .onClick(() => this.pickLibraryDoc(docs))
    )
    const byProject = this.projects
      .map((path) => ({ path, docs: docs.filter((doc) => doc.projects.includes(path)) }))
      .filter((entry) => entry.docs.length)
    if (byProject.length) menu.addSeparator()
    for (const entry of byProject) {
      const title = this.plugin.index.projectRef(entry.path)?.title ?? entry.path
      menu.addItem((item) =>
        item
          .setTitle(t('chat.attachProjectDocs', { count: entry.docs.length, project: title }))
          .setIcon('folder-kanban')
          .onClick(() => this.attachFiles(entry.docs.map((doc) => doc.file)))
      )
    }
    menu.showAtMouseEvent(event)
  }

  /** A document of the library, found by its title, its projects or what it says. */
  private pickLibraryDoc(docs: LibraryDoc[]): void {
    const texts = this.plugin.libraryText
    void texts.refresh(this.plugin.library.docs())
    new LibraryDocPicker(
      this.app,
      sortDocs(docs, 'added'),
      (path) => this.plugin.index.projectRef(path)?.title ?? path,
      (doc) => texts.folded(doc),
      (doc) => this.attachFile(doc.file),
      (doc) => texts.entry(doc)?.text ?? ''
    ).open()
  }

  /**
   * The files that can be read, the attached project's own first — its documents are what
   * a question about it is most likely about — then the most recently changed.
   */
  private pickFile(): void {
    // Every attached project's folder: its documents first.
    const folders = this.projects.map((path) => path.slice(0, path.lastIndexOf('/') + 1)).filter(Boolean)
    const files = this.app.vault
      .getFiles()
      .filter((file) => isReadable(file.extension) && !this.files.includes(file.path))
      .filter((file) => file.extension !== 'md' || !isChatNote(this.app.metadataCache.getFileCache(file)?.frontmatter))
      .sort((a, b) => {
        const own = (file: TFile): number => (folders.some((folder) => file.path.startsWith(folder)) ? 0 : 1)
        return own(a) - own(b) || b.stat.mtime - a.stat.mtime
      })
    if (!files.length) {
      new Notice(t('chat.fileNone'))
      return
    }
    new FilePicker(this.app, files, (file) => this.attachFile(file.path)).open()
  }

  /**
   * Files dropped from outside the vault: kept first — into the attached project as
   * received documents, or beside the conversations — then attached by where they now are.
   */
  private async dropFiles(files: File[], at: { x: number; y: number }): Promise<void> {
    const settings = this.plugin.settings
    // With several projects attached, the reader says which one the files belong to.
    const into = await this.dropTarget(at)
    if (into === undefined) return
    for (const file of files) {
      const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1) : ''
      if (!isReadable(extension)) {
        new Notice(t('chat.fileUnsupported', { name: file.name }))
        continue
      }
      try {
        const looseFolder = normalizePath(`${settings.chat.folder}/${t('chat.filesFolder')}`)
        const kept = await keepDroppedFile(
          {
            app: this.app,
            store: this.plugin.store,
            documents: this.plugin.documents,
            looseFolder,
            by: settings.globalTeamMembers[0] ?? '',
            note: t('chat.dropNote')
          },
          file.name,
          new Uint8Array(await file.arrayBuffer()),
          into
        )
        this.attachFile(kept.path)
        const project = into ? (this.plugin.index.projectRef(into)?.title ?? '') : ''
        new Notice(
          kept.filed
            ? t('chat.fileFiled', { name: file.name, project })
            : t('chat.fileKept', { name: file.name, folder: looseFolder })
        )
      } catch (error) {
        new Notice(
          t('chat.fileKeepFailed', { name: file.name, reason: error instanceof Error ? error.message : String(error) })
        )
      }
    }
  }

  /**
   * The attached files' text, for the instructions: each read when it changed, not at
   * every question — a hundred-page PDF is not parsed again for a follow-up. One that
   * cannot be read is named with why, so the model says so rather than answering as if
   * it had read it; the reader is told too.
   */
  private async filesBlock(paths: string[], question: string): Promise<string> {
    const read: ContextFile[] = []
    const unread: string[] = []
    const library = new Map(this.plugin.library.docs().map((doc) => [doc.file, doc]))
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) continue
      const key = `${path}|${this.ocrForced.has(path) ? 'ocr' : 'text'}`
      const cached = this.fileCache.get(key)
      let text = cached && cached.mtime === file.stat.mtime ? cached.text : null
      // What the library has read of it already, scans included: not read a second time.
      const doc = library.get(path)
      const kept = doc ? this.plugin.libraryText.entry(doc) : undefined
      if (
        text === null &&
        kept?.state === 'ok' &&
        kept.mtime === file.stat.mtime &&
        (kept.ocr || !this.ocrForced.has(path))
      ) {
        text = kept.text
      }
      if (text === null) {
        try {
          text = await this.readAttached(file)
          this.fileCache.set(key, { mtime: file.stat.mtime, text })
        } catch (error) {
          const reason =
            error instanceof FileReadError
              ? fileProblemText(error.problem)
              : error instanceof Error
                ? error.message
                : String(error)
          unread.push(t('chat.fileUnread', { name: file.name, reason }))
          new Notice(t('chat.fileProblemNotice', { name: file.name, reason }), 10000)
          continue
        }
      }
      read.push({ path: file.path, name: file.name, text })
    }
    // Several files share what can be sent; one too long for its share goes by the
    // passages the question speaks of, or by its start — and the reader is told which.
    const share = fileShare(read.length)
    const words = questionWords(question)
    const long = read.filter((each) => each.text.length > share)
    if (long.length > 2) {
      new Notice(t('chat.filesShared', { count: long.length, share }), 12000)
    } else {
      for (const file of long) {
        const passages = excerptFor(file.text, share, words) !== null
        new Notice(
          passages
            ? t('chat.filePassages', { name: file.name, total: file.text.length })
            : t('chat.fileCut', { name: file.name, sent: share, total: file.text.length }),
          12000
        )
      }
    }
    const block = filesContext(
      read,
      {
        heading: (name, path) => t('chat.fileHeading', { name, path }),
        truncated: (sent, total) => t('chat.fileTruncated', { sent, total }),
        excerpted: (sent, total) => t('chat.fileExcerpted', { sent, total })
      },
      share,
      words
    )
    return [block, ...unread].filter(Boolean).join('\n\n')
  }

  /**
   * A file's text, however it has to be had: a picture read by a model that sees, a PDF
   * with no text to speak of drawn page by page and read the same way, anything else by
   * its reader.
   */
  private async readAttached(file: TFile): Promise<string> {
    const bytes = new Uint8Array(await this.app.vault.readBinary(file))
    if (!isImage(file.extension)) {
      if (file.extension.toLowerCase() !== 'pdf') return fileText(file.extension, bytes)
      let text = ''
      let pages = 1
      try {
        ;({ text, pages } = await readPdfText(bytes))
      } catch {
        // A PDF this plugin cannot take apart may still be one the viewer can draw.
      }
      if (!this.ocrForced.has(file.path) && !needsOcr(text, pages)) return text
    }
    const source = await scanPages(file, bytes)
    try {
      const model = this.plugin.settings.llm.modelOcr.trim() || this.model
      const read = await transcribeScan(this.app, this.llm, model, file, source)
      if (read.fresh) this.renderContext()
      return read.text
    } finally {
      source.close()
    }
  }

  /**
   * The project dropped files go into: the one attached, none when none is, and the
   * reader's choice when there are several — undefined when they chose nothing.
   */
  private dropTarget(at: { x: number; y: number }): Promise<string | null | undefined> {
    const refs = this.projects
      .map((path) => this.plugin.index.projectRef(path))
      .filter((ref): ref is ProjectRef => ref !== null && !ref.program)
    if (refs.length <= 1) return Promise.resolve(refs[0]?.path ?? null)
    return new Promise((resolve) => {
      let chosen: string | null | undefined
      const menu = new Menu()
      menu.addItem((item) => item.setTitle(t('chat.dropInto')).setIsLabel(true))
      for (const ref of refs) {
        menu.addItem((item) =>
          item
            .setTitle(ref.title)
            .setIcon('folder-kanban')
            .onClick(() => {
              chosen = ref.path
            })
        )
      }
      menu.addSeparator()
      menu.addItem((item) =>
        item
          .setTitle(t('chat.dropLoose'))
          .setIcon('messages-square')
          .onClick(() => {
            chosen = null
          })
      )
      // Hidden after the click is handled: what was chosen, or nothing.
      menu.onHide(() => window.setTimeout(() => resolve(chosen), 0))
      menu.showAtPosition(at)
    })
  }

  /** The projects and collections not attached yet, the projects first. */
  private pickProject(): void {
    const index = this.plugin.index
    const scopes: ScopeChoice[] = [
      ...index
        .projectRefs()
        .filter((ref) => !this.projects.includes(ref.path))
        .map((ref) => ({
          kind: 'project' as const,
          path: ref.path,
          title: ref.title,
          detail: ref.program ? `${t('chat.projectProgram')} · ${ref.path}` : ref.path
        })),
      ...index
        .collectionRefs()
        .filter((ref) => !this.collections.includes(ref.path))
        .map((ref) => ({
          kind: 'collection' as const,
          path: ref.path,
          title: ref.title,
          detail: `${t('chat.collection')} · ${ref.path}`
        }))
    ]
    new ScopePicker(this.app, scopes, (choice) =>
      choice.kind === 'project' ? this.attachProject(choice.path) : this.attachCollection(choice.path)
    ).open()
  }

  /** A collection to talk about, beside anything already attached, like a project. */
  attachCollection(path: string): void {
    if (!this.collections.includes(path)) this.collections = [...this.collections, path]
    this.renderContext()
    window.setTimeout(() => this.inputEl?.focus(), 0)
  }

  /**
   * A project to talk about, beside any already attached: it goes with every question from
   * here on, until taken off, the way the open note does. A programme stands for the
   * projects it groups.
   */
  attachProject(path: string): void {
    if (!this.projects.includes(path)) this.projects = [...this.projects, path]
    this.renderContext()
    window.setTimeout(() => this.inputEl?.focus(), 0)
  }

  /**
   * The projects a question was asked about, written out as they stand now; null when none
   * is left. Each comes with the projects under it, and one already under another attached
   * is written once, with it. Several share the room the one would have had, more or less.
   */
  private async projectsBlock(
    paths: string[],
    collections: string[] = []
  ): Promise<{ text: string; statuses: string[]; priorities: string[] } | null> {
    const index = this.plugin.index
    const alive = paths.filter((path) => index.projectRef(path) !== null)
    const unique = withoutNested(alive, (path) => index.ancestorRefs(path).map((ref) => ref.path))
    const gathered = collections.filter((path) => index.collectionRef(path) !== null)
    const budget = projectShare(unique.length + gathered.length)
    const texts: string[] = []
    const statuses = new Set<string>()
    const priorities = new Set<string>()
    const blocks = [
      ...unique.map((path) => () => this.projectBlock(path, budget)),
      ...gathered.map((path) => () => this.collectionBlock(path, budget))
    ]
    for (const block of blocks) {
      const one = await block()
      if (!one) continue
      texts.push(one.text)
      for (const label of one.statuses) statuses.add(label)
      for (const label of one.priorities) priorities.add(label)
    }
    if (!texts.length) return null
    return { text: texts.join('\n\n'), statuses: [...statuses], priorities: [...priorities] }
  }

  /**
   * A collection, written out as it stands now: the tickets it gathers, under the projects
   * that hold them — what its view shows, by the same rule and the same hand-picked
   * additions and removals. Null when it is gone or gathers nothing.
   */
  private async collectionBlock(
    path: string,
    budget: number
  ): Promise<{ text: string; statuses: string[]; priorities: string[] } | null> {
    const ref = this.plugin.index.collectionRef(path)
    if (!ref) return null
    const spec: ScopeSpec = { kind: 'collection', path }
    const statuses = this.plugin.settings.statuses
    const projects = await this.plugin.store.loadProjects(resolveScopePaths(spec, this.plugin.index, statuses))
    if (!projects.length) return null
    const memberIds = collectionMemberIds(ref, this.plugin.index.allTaskRefs(), statuses)
    const scope = new ProjectScope(spec, projects, this.plugin.store, { title: ref.title, memberIds })
    const config = scope.config
    const text = projectContext(
      {
        title: ref.title,
        path: ref.path,
        program: false,
        description: '',
        team: [],
        zones: [],
        parts: collectionParts(scope.tasks(), projects),
        statuses: config.statuses,
        priorities: config.priorities,
        today: today().toString(),
        titleOf: (id) => this.plugin.index.task(id)?.title
      },
      { ...this.projectWords, heading: (title, where) => t('chat.collectionHeading', { title, path: where }) },
      budget
    )
    return {
      text,
      statuses: config.statuses.map((status) => status.label),
      priorities: config.priorities.map((priority) => priority.label)
    }
  }

  /**
   * One project, written out as it stands now; null when it is gone. The projects under it
   * come with it, each with its own tickets.
   */
  private async projectBlock(
    path: string,
    budget: number
  ): Promise<{ text: string; statuses: string[]; priorities: string[] } | null> {
    const ref = this.plugin.index.projectRef(path)
    if (!ref) return null
    // With what is under it: a programme is the projects it groups, and a project's own
    // sub-projects are part of what someone asking about it means.
    const spec: ScopeSpec = { kind: 'subtree', path: ref.path }
    const projects = await this.plugin.store.loadProjects(
      resolveScopePaths(spec, this.plugin.index, this.plugin.settings.statuses)
    )
    const scope = new ProjectScope(spec, projects, this.plugin.store)
    const primary = scope.primary
    if (!primary) return null
    await this.plugin.store.loadProjectBody(primary)
    const config = scope.config
    const text = projectContext(
      {
        title: primary.title,
        path: primary.filePath,
        program: !!primary.program,
        description: primary.description,
        team: primary.teamMembers,
        zones: primary.zones ?? [],
        parts: projectParts(primary, projects),
        statuses: config.statuses,
        priorities: config.priorities,
        today: today().toString(),
        // A dependency on a ticket in another project is named by that ticket's title too.
        titleOf: (id) => this.plugin.index.task(id)?.title
      },
      this.projectWords,
      budget
    )
    return {
      text,
      statuses: config.statuses.map((status) => status.label),
      priorities: config.priorities.map((priority) => priority.label)
    }
  }

  /**
   * How to propose a change the reader can apply with a click, told to the model only when
   * there is something to change: requirements or a project attached. The lists are the
   * reader's own, so a proposed status is one the card can take.
   */
  private changeInstructions(
    requirements: boolean,
    project: { statuses: string[]; priorities: string[] } | null,
    files: boolean
  ): string {
    if (!requirements && !project) return ''
    const lines = [t('chat.changeHow')]
    if (requirements) {
      const options = requirementOptions(this.plugin)
      const labels = (list: { label: string }[]): string => list.map((option) => option.label).join(', ')
      lines.push(
        t('chat.changeRequirement', {
          languages: options.languages.join(', '),
          statuses: labels(options.statuses),
          types: labels(options.types),
          criticalities: labels(options.criticalities),
          verifications: labels(options.verifications)
        })
      )
    }
    if (project) {
      lines.push(
        t('chat.changeTicket', { statuses: project.statuses.join(', '), priorities: project.priorities.join(', ') })
      )
      lines.push(
        t('chat.changeCreate', {
          types: TASK_TYPES.filter((type) => type !== 'subtask')
            .map((type) => typeConfigOf(type).label)
            .join(', ')
        })
      )
      // A planning received, read against the plan: what the whole feature is for.
      if (files) lines.push(t('chat.changePlanning'))
    }
    return lines.join('\n')
  }

  /**
   * How to propose a note: always said, since a note can be asked for about anything. The
   * attached projects' folders are named, so a note about one goes beside it.
   */
  private noteInstructions(): string {
    const folders = currentProjects(this.turns)
      .map((path) => path.slice(0, path.lastIndexOf('/')))
      .filter(Boolean)
    const fallback = notesFallback(this.plugin, this.notePath ?? '')
    return [
      t('chat.noteHow', { folder: fallback || '/' }),
      folders.length ? t('chat.noteProjectFolders', { list: [...new Set(folders)].join(', ') }) : ''
    ]
      .filter(Boolean)
      .join('\n')
  }

  private get projectWords(): ProjectWords {
    return {
      heading: (title, path) => t('chat.projectHeading', { title, path }),
      program: t('chat.projectProgram'),
      field: {
        description: t('chat.projectDescription'),
        team: t('chat.projectTeam'),
        zones: t('chat.projectZones'),
        span: t('chat.projectSpan'),
        summary: t('chat.projectSummary'),
        tickets: t('chat.projectTickets')
      },
      summary: (figures) => t('chat.projectFigures', figures),
      type: (type) => typeConfigOf(type as TaskType).label,
      docState: (state) => docStateConfigOf(state as DocState).label,
      late: t('chat.projectLate'),
      after: t('chat.projectAfter'),
      reference: t('chat.projectReference'),
      issue: t('chat.projectIssue'),
      file: t('chat.projectFile'),
      noTickets: t('chat.projectEmpty'),
      doneLeft: (count) => t('chat.projectDoneLeft', { count }),
      left: (count) => t('chat.projectLeft', { count })
    }
  }

  /**
   * Requirements to talk about, chosen in the library: they go with every question from
   * here on, until taken off, the way the open note does.
   */
  attachRequirements(ids: string[]): void {
    this.attached = [...new Set(ids)]
    this.renderContext()
    window.setTimeout(() => this.inputEl?.focus(), 0)
  }

  /** The reader's words for a requirement, so the model is told about it in their language. */
  private get requirementWords(): RequirementWords {
    const settings = this.plugin.settings
    return {
      heading: (count) => t('chat.reqHeading', { count }),
      field: {
        aliases: t('req.aliases'),
        category: t('req.field.category'),
        type: t('req.field.type'),
        status: t('req.field.status'),
        criticality: t('req.field.criticality'),
        verification: t('req.field.verification'),
        rationale: t('req.field.rationale'),
        source: t('req.field.source'),
        links: t('req.links'),
        text: t('req.field.wording')
      },
      value: (field, value) => {
        if (field === 'type') return reqTypeGlyph(settings, value).label
        if (field === 'status') return reqStatusGlyph(settings, value).label
        if (field === 'criticality') return reqCriticalityGlyph(settings, value).label
        return verificationLabel(value)
      },
      source: t('chat.reqSource'),
      stale: t('chat.reqStale'),
      machine: t('chat.reqMachine'),
      linkKind: (kind) => reqLinkKindLabel(kind),
      left: (count, list) => t('chat.reqLeft', { count, list })
    }
  }

  /** The note a question was asked about, read as it is now. Null when it is gone. */
  private async contextNote(path: string | undefined): Promise<ContextNote | null> {
    if (!path) return null
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return null
    return { path: file.path, title: file.basename, content: readableNote(await this.app.vault.cachedRead(file)) }
  }

  private get words(): ChatNoteWords {
    return {
      user: t('chat.you'),
      assistant: t('chat.assistant'),
      // A link to the requirement's note, shown by its identifier: the record says what
      // was asked about, and the reader can go to it.
      requirement: (id) => {
        const path = this.plugin.index.requirementById(id)?.filePath
        return path ? `[[${path.replace(/\.md$/i, '')}|${id}]]` : id
      }
    }
  }

  private get llm(): LlmClient {
    return new LlmClient({ settings: this.plugin.settings.llm })
  }

  /** The model the chat talks to: the one chosen in the panel, or the settings' text model. */
  private get model(): string {
    return chatModel(this.plugin.settings.chat.model, this.plugin.settings.llm.modelText)
  }

  /** What is missing before a question can be asked, or null when nothing is. */
  private missing(): string | null {
    const settings = this.plugin.settings.llm
    if (!settings.enabled || !settings.baseUrl.trim()) return t('chat.notConfigured')
    if (!this.model) return t('chat.noModel')
    return null
  }

  /**
   * The models the gateway offers, asked for when the list is opened — a gateway gains
   * and loses models, and a list fetched at start would go stale — and shown where the
   * click was. The settings' text model comes first, as the one the chat falls back to.
   */
  private async pickModel(event: MouseEvent): Promise<void> {
    const at = { x: event.clientX, y: event.clientY }
    let offered: string[] = []
    let problem = ''
    try {
      offered = chatModels(await this.llm.models())
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error)
    }
    const chat = this.plugin.settings.chat
    const fallback = this.plugin.settings.llm.modelText.trim()
    const choose = (model: string): void => {
      chat.model = model
      void this.plugin.saveSettings()
      this.render()
    }
    const menu = new Menu()
    if (fallback) {
      menu.addItem((item) =>
        item
          .setTitle(t('chat.modelDefault', { model: fallback }))
          .setChecked(!chat.model.trim())
          .onClick(() => choose(''))
      )
      menu.addSeparator()
    }
    // The model in use stays offered even when the gateway no longer lists it, so the
    // menu never pretends the chat is talking to something else.
    const names = offered.includes(this.model) || !this.model ? offered : [this.model, ...offered]
    for (const name of names) {
      menu.addItem((item) =>
        item
          .setTitle(name)
          .setChecked(!!chat.model.trim() && name === this.model)
          .onClick(() => choose(name))
      )
    }
    if (problem) {
      menu.addItem((item) => item.setTitle(t('chat.modelsUnavailable', { reason: problem })).setDisabled(true))
    } else if (!offered.length) {
      menu.addItem((item) => item.setTitle(t('chat.modelsNone')).setDisabled(true))
    }
    menu.showAtPosition(at)
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root', 'pm-chat')

    const head = root.createDiv('pm-chat-head')
    const titles = head.createDiv('pm-chat-titles')
    titles.createDiv({ cls: 'pm-chat-title', text: t('chat.title') })
    // The model, as a button: the list of what the gateway offers is one click away. On a
    // line of its own under the title and the buttons, so a long name has the panel's
    // whole width rather than what the buttons leave of it.
    const model = this.model
    const configured = this.plugin.settings.llm.enabled && this.plugin.settings.llm.baseUrl.trim() !== ''
    const modelRow = configured ? root.createDiv('pm-chat-model-row') : null
    if (modelRow) {
      const label = model ? `${model} — ${t('chat.modelPick')}` : t('chat.modelPick')
      const pick = modelRow.createEl('button', {
        cls: 'pm-chat-model pm-chat-model-pick',
        attr: { 'aria-label': label, title: label }
      })
      pick.createSpan({ cls: 'pm-chat-model-name', text: model || t('chat.modelNone') })
      setIcon(pick.createSpan({ cls: 'pm-chat-model-caret' }), 'chevron-down')
      pick.disabled = this.pending
      pick.addEventListener(
        'click',
        safeAsync((event: MouseEvent) => this.pickModel(event))
      )
    }
    const button = (icon: string, label: string, run: () => void): void => {
      const el = head.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } })
      setIcon(el, icon)
      el.addEventListener('click', () => {
        if (!this.pending) run()
      })
    }
    if (this.notePath) {
      const path = this.notePath
      button(
        'file-text',
        t('chat.openNote'),
        safeAsync(() => this.app.workspace.openLinkText(path, '', 'tab'))
      )
    }
    // Once the conversation is kept, its branches are one click away — drawn as one line
    // until a question is asked again.
    if (this.notePath) {
      const path = this.notePath
      button(
        'git-fork',
        t('chat.branches'),
        safeAsync(() => this.openBranches(path))
      )
    }
    button('history', t('chat.history'), () => this.pickConversation())
    button('square-pen', t('chat.new'), () => {
      this.turns = []
      this.editing = null
      this.follows = null
      this.branched = false
      this.notePath = null
      this.saved = new WeakSet()
      this.app.workspace.requestSaveLayout()
      this.render()
    })

    if (this.turnsComponent) this.removeChild(this.turnsComponent)
    this.turnsComponent = this.addChild(new Component())
    this.listEl = root.createDiv('pm-chat-list')
    const missing = this.missing()
    if (missing) this.renderSetup(missing)
    else if (!this.turns.length) this.listEl.createDiv({ cls: 'pm-chat-empty', text: t('chat.empty') })
    this.presetsEl = !missing && !this.turns.length ? this.listEl.createDiv('pm-chat-presets') : null
    for (const [at, turn] of this.turns.entries()) this.renderTurn(turn, at === this.turns.length - 1)
    if (this.pending) {
      this.liveEl = this.listEl.createDiv('pm-chat-turn pm-chat-turn--assistant pm-chat-typing')
      this.liveEl.createSpan({ text: t('chat.thinking') })
      if (this.liveText) this.drawLive()
    } else this.liveEl = null

    this.contextEl = missing ? null : root.createDiv('pm-chat-context')
    this.renderContext()

    // A question being rewritten says so, with the way back.
    const editing = this.editing
    if (editing && !missing) {
      const banner = root.createDiv('pm-chat-editing')
      setIcon(banner.createSpan({ cls: 'pm-chat-editing-icon' }), 'pencil')
      banner.createSpan({ text: t('chat.editing', { at: localStamp(editing.at) }) })
      const cancel = banner.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.editCancel') } })
      setIcon(cancel, 'x')
      cancel.addEventListener('click', () => {
        this.editing = null
        this.render()
      })
    }
    const composer = root.createDiv('pm-chat-composer')
    this.inputEl = composer.createEl('textarea', {
      cls: 'pm-chat-input',
      attr: { placeholder: t('chat.placeholder'), rows: '3' }
    })
    this.inputEl.disabled = missing !== null
    this.inputEl.addEventListener('keydown', (event) => {
      // Enter sends, Shift+Enter goes to the line, and a key pressed while an input
      // method is composing a character belongs to that character.
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        void this.send()
      }
    })
    const attach = composer.createEl('button', {
      cls: 'clickable-icon pm-chat-ready',
      attr: { 'aria-label': t('chat.attachFile') }
    })
    setIcon(attach, 'paperclip')
    attach.disabled = missing !== null || this.pending
    attach.addEventListener('click', (event) => this.showAttachMenu(event))
    const ready = composer.createEl('button', {
      cls: 'clickable-icon pm-chat-ready',
      attr: { 'aria-label': t('chat.presets') }
    })
    setIcon(ready, 'zap')
    ready.disabled = missing !== null || this.pending
    ready.addEventListener('click', (event) => this.presetMenu(event))
    const skill = composer.createEl('button', {
      cls: 'clickable-icon pm-chat-ready',
      attr: { 'aria-label': t('chat.skillPick') }
    })
    setIcon(skill, 'sparkles')
    skill.disabled = missing !== null || this.pending
    skill.addEventListener('click', () => this.pickSkill())
    // While a reply is being written, the same button stops it.
    const stoppable = this.pending && this.stopper !== null
    this.sendEl = composer.createEl('button', {
      cls: 'mod-cta pm-chat-send',
      attr: { 'aria-label': stoppable ? t('chat.stop') : t('chat.send') }
    })
    setIcon(this.sendEl, stoppable ? 'square' : 'send')
    this.sendEl.disabled = missing !== null || (this.pending && !stoppable)
    this.sendEl.addEventListener(
      'click',
      safeAsync(async () => {
        if (this.pending) this.stopper?.abort()
        else await this.send()
      })
    )

    this.listEl.scrollTop = this.listEl.scrollHeight
    if (!missing && !this.pending) window.setTimeout(() => this.inputEl.focus(), 0)
  }

  /** Where the model is set up, said plainly, with the way there. */
  private renderSetup(message: string): void {
    const card = this.listEl.createDiv('pm-chat-setup')
    setIcon(card.createDiv('pm-chat-setup-icon'), 'plug-zap')
    card.createDiv({ text: message })
    const open = card.createEl('button', { text: t('chat.openSettings') })
    open.addEventListener('click', () => {
      // Obsidian's settings window is not part of its published API, and is reached the
      // way every plugin reaches it; where it is not there, the Notice says where to go.
      const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting
      if (!setting) {
        new Notice(t('chat.notConfigured'))
        return
      }
      setting.open()
      setting.openTabById(this.plugin.manifest.id)
    })
  }

  private renderTurn(turn: ChatTurn, last: boolean): void {
    const el = this.listEl.createDiv(
      `pm-chat-turn pm-chat-turn--${turn.role}${turn.failed ? ' pm-chat-turn--failed' : ''}`
    )
    const body = el.createDiv('pm-chat-body')
    // Said on the question itself: what the model was shown when it answered.
    if (turn.context) {
      const about = this.listEl.createDiv('pm-chat-about')
      setIcon(about.createSpan(), 'file-text')
      about.createSpan({ text: turn.context.replace(/^.*\//, '').replace(/\.md$/i, '') })
      about.setAttr('title', turn.context)
    }
    if (turn.projects?.length) {
      const names = turn.projects.map(
        (path) => this.plugin.index.projectRef(path)?.title ?? path.replace(/^.*\//, '').replace(/\.md$/i, '')
      )
      const about = this.listEl.createDiv('pm-chat-about')
      setIcon(about.createSpan(), 'folder-kanban')
      about.createSpan({ text: names.join(', ') })
      about.setAttr('title', turn.projects.join('\n'))
    }
    if (turn.collections?.length) {
      const names = turn.collections.map(
        (path) => this.plugin.index.collectionRef(path)?.title ?? path.replace(/^.*\//, '').replace(/\.md$/i, '')
      )
      const about = this.listEl.createDiv('pm-chat-about')
      setIcon(about.createSpan(), 'library')
      about.createSpan({ text: names.join(', ') })
      about.setAttr('title', turn.collections.join('\n'))
    }
    if (turn.files?.length) {
      const names = turn.files.map((path) => path.slice(path.lastIndexOf('/') + 1))
      const about = this.listEl.createDiv('pm-chat-about')
      setIcon(about.createSpan(), 'paperclip')
      about.createSpan({ text: names.join(', ') })
      about.setAttr('title', turn.files.join('\n'))
    }
    if (turn.requirements?.length) {
      const about = this.listEl.createDiv('pm-chat-about')
      setIcon(about.createSpan(), 'list-checks')
      about.createSpan({ text: turn.requirements.join(', ') })
      about.setAttr('title', turn.requirements.join(', '))
    }
    // A reply is written in Markdown more often than not: lists, code, tables. A question
    // is too when it quotes a passage, which reads as a quote rather than as marks.
    const quoting = turn.role === 'user' && /(^|\n)> /.test(turn.content)
    if ((turn.role === 'assistant' && !turn.failed) || quoting) {
      // From the conversation's note: its links, and a note it proposes, know where they come from.
      void MarkdownRenderer.render(this.app, turn.content, body, this.notePath ?? '', this.turnsComponent ?? this)
    } else body.setText(turn.content)

    const actions = el.createDiv('pm-chat-actions')
    if (turn.failed) {
      if (last) {
        const retry = actions.createEl('button', { text: t('chat.retry') })
        retry.addEventListener('click', () => {
          this.turns = withoutFailure(this.turns)
          void this.ask()
        })
      }
      return
    }
    // A question can be copied, rewritten or asked again: the last two take its place and
    // that of everything said after it.
    if (turn.role === 'user') {
      this.turnButton(actions, 'copy', t('chat.copyQuestion'), async () => {
        await navigator.clipboard.writeText(turn.content)
        new Notice(t('chat.copiedQuestion'))
      })
      this.turnButton(actions, 'pencil', t('chat.editQuestion'), () => this.edit(turn))
      this.turnButton(actions, 'refresh-cw', t('chat.askAgain'), () => this.retake(turn))
      return
    }
    // Written again: its question asked again, as it was.
    const question = this.questionOf(turn)
    if (question) this.turnButton(actions, 'refresh-cw', t('chat.regenerate'), () => this.retake(question))
    // A reply the length limit cut short says so, with the way to have the rest.
    if (turn.cut) {
      const note = el.createDiv('pm-chat-cut')
      setIcon(note.createSpan({ cls: 'pm-chat-cut-icon' }), 'scissors')
      note.createSpan({ text: t('chat.cut') })
      if (last) {
        const more = note.createEl('button', { text: t('chat.continue') })
        more.addEventListener(
          'click',
          safeAsync(() => this.send(t('chat.continueQ')))
        )
      }
    }
    // Which model wrote it, once the chat has talked to more than one.
    if (turn.model && this.turns.some((other) => other.model && other.model !== turn.model)) {
      actions.createSpan({
        cls: 'pm-chat-by',
        text: turn.model,
        attr: { title: t('chat.modelBy', { model: turn.model }) }
      })
    }
    // A revised planning is a dozen proposals: one click for all of them, each still
    // checked as its own card would check it.
    const blocks = changeBlocks(turn.content)
    if (blocks.length > 1) {
      const all = actions.createEl('button', { text: t('chat.change.applyAll', { count: blocks.length }) })
      all.addEventListener(
        'click',
        safeAsync(async () => {
          all.disabled = true
          try {
            await this.applyAll(blocks)
          } finally {
            all.disabled = false
          }
        })
      )
    }
    // Where a reply goes once it is worth keeping: into a note of its own, or into the
    // note being written.
    const insert = actions.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': t('chat.insertReply') }
    })
    setIcon(insert, 'text-cursor-input')
    insert.addEventListener(
      'click',
      safeAsync(() => this.insertReply(turn))
    )
    const keep = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.saveReply') } })
    setIcon(keep, 'file-plus-2')
    keep.addEventListener(
      'click',
      safeAsync(() => this.saveReply(turn))
    )
    const copy = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.copy') } })
    setIcon(copy, 'copy')
    copy.addEventListener(
      'click',
      safeAsync(async () => {
        await navigator.clipboard.writeText(turn.content)
        new Notice(t('chat.copied'))
      })
    )
  }

  /** A small button under a turn, doing nothing while a reply is being written. */
  private turnButton(parent: HTMLElement, icon: string, label: string, run: () => void | Promise<void>): void {
    const button = parent.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } })
    setIcon(button, icon)
    button.disabled = this.pending
    button.addEventListener(
      'click',
      safeAsync(async () => {
        if (!this.pending) await run()
      })
    )
  }

  /**
   * A question asked again with what it was asked with — the note, the projects, the
   * files it named — in place of itself and of everything after it.
   */
  private async retake(question: ChatTurn): Promise<void> {
    const at = this.turns.indexOf(question)
    if (at < 0 || this.missing()) return
    this.editing = null
    this.follows = null
    this.branched = true
    this.turns = [...this.turns.slice(0, at), this.again(question, question.content)]
    await this.ask()
  }

  /** The question put back in the box, to be sent rewritten in place of itself. */
  private edit(question: ChatTurn): void {
    this.editing = question
    this.render()
    this.inputEl.value = question.content
    window.setTimeout(() => {
      this.inputEl.focus()
      this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length)
    }, 0)
  }

  /** A question like this one, asked now, saying which one it takes the place of. */
  private again(question: ChatTurn, content: string): ChatTurn {
    const { model: _model, cut: _cut, failed: _failed, retakes: _retakes, follows: _follows, ...kept } = question
    return { ...kept, content, at: new Date().toISOString(), retakes: question.at }
  }

  /** The question a reply answers: the last one asked before it. */
  private questionOf(turn: ChatTurn): ChatTurn | undefined {
    const at = this.turns.indexOf(turn)
    return this.turns
      .slice(0, at < 0 ? this.turns.length : at)
      .reverse()
      .find((each) => each.role === 'user')
  }

  /**
   * A reply as a note of its own, beside the project it is about — or among the
   * conversations when it is about none — named after its first heading or its question,
   * and opened.
   */
  private async saveReply(turn: ChatTurn): Promise<void> {
    const body = withoutChangeBlocks(turn.content)
    if (!body) return
    const question = this.questionOf(turn)
    // The first project the question was about: a report on two projects goes with the first.
    const ref = this.plugin.index.projectRef(question?.projects?.[0] ?? this.projects[0] ?? '')
    // About no project, it goes to the inbox: the notes library.
    const folder = ref ? ref.path.slice(0, Math.max(0, ref.path.lastIndexOf('/'))) : this.plugin.notes.root
    const title = replyTitle(body, chatTitle(question?.content ?? '', t('chat.untitled')))
    try {
      if (folder) await ensureFolder(this.app, normalizePath(folder))
      const path = await freePath(this.app, normalizePath(folder || '/'), sanitizeFileName(title) || 'note', 'md')
      const file = await this.app.vault.create(
        path,
        replyNoteContent(
          {
            created: new Date().toISOString(),
            model: turn.model ?? this.model,
            ...(this.notePath ? { chat: this.notePath } : {}),
            ...(ref ? { project: ref.path } : {})
          },
          body
        )
      )
      await this.app.workspace.getLeaf('tab').openFile(file)
      new Notice(t('chat.savedReply', { path: file.path }))
    } catch (error) {
      new Notice(t('chat.saveFailed', { reason: error instanceof Error ? error.message : String(error) }))
    }
  }

  /**
   * A reply put into the note open beside the chat: at the cursor when the note is being
   * edited, at its end otherwise — never over what the reader wrote.
   */
  private async insertReply(turn: ChatTurn): Promise<void> {
    const file = this.contextFile
    if (!file) {
      new Notice(t('chat.insertNone'))
      return
    }
    const body = withoutChangeBlocks(turn.content)
    if (!body) return
    const view = this.app.workspace
      .getLeavesOfType('markdown')
      .map((leaf) => leaf.view)
      .find((each): each is MarkdownView => each instanceof MarkdownView && each.file === file)
    if (view && view.getMode() === 'source') {
      view.editor.replaceSelection(`${body}\n`)
      new Notice(t('chat.inserted', { name: file.basename }))
      return
    }
    await this.app.vault.process(file, (content) => `${content.replace(/\s+$/, '')}\n\n${body}\n`)
    new Notice(t('chat.appended', { name: file.basename }))
  }

  /** Every proposal of a reply, applied one after the other, with one report at the end. */
  private async applyAll(blocks: string[]): Promise<void> {
    let applied = 0
    let already = 0
    let refused = 0
    const by = this.plugin.settings.globalTeamMembers[0] || 'llm'
    for (const source of blocks) {
      const read = parseChange(source)
      if ('problem' in read) {
        refused++
        continue
      }
      const spec = read.spec
      let done: Applied
      if (spec.kind === 'requirement') {
        const path = this.plugin.index.requirementById(spec.target)?.filePath
        done = path
          ? await applyToRequirement(this.plugin.requirements, path, spec, requirementOptions(this.plugin), by)
          : { ok: false, problem: 'none' }
      } else if (spec.kind === 'create') {
        done = await applyCreate(
          this.plugin.index,
          this.plugin.store,
          spec,
          (type) => typeConfigOf(type as TaskType).label
        )
      } else done = await applyToTicket(this.plugin.index, this.plugin.store, spec)
      if (!done.ok) refused++
      else if (done.changed) applied++
      else already++
    }
    new Notice(t('chat.change.allDone', { applied, already, refused }), 10000)
  }

  /** The ready questions that fit what is attached now. */
  private presets(): ChatPrompt[] {
    const settings = this.plugin.settings.chat
    const all = [...parsePrompts(settings.prompts), ...(settings.builtinPrompts ? builtinPrompts() : [])]
    return availablePrompts(all, {
      note: this.useNote && this.contextFile !== null,
      // A collection is asked about the way a project is: where its tickets stand.
      project:
        this.projects.some((path) => this.plugin.index.projectRef(path) !== null) ||
        this.collections.some((path) => this.plugin.index.collectionRef(path) !== null),
      requirements: this.attached.length > 0,
      file: this.files.length > 0,
      selection: this.selection !== null
    })
  }

  /**
   * The ready questions, as buttons, while nothing has been asked: the moment someone
   * looks at an empty box and wonders what to ask. They go once the conversation starts;
   * the button beside the box still has them.
   */
  private renderPresets(): void {
    const el = this.presetsEl
    if (!el) return
    el.empty()
    const presets = this.presets()
    if (!presets.length) {
      el.createDiv({ cls: 'pm-chat-presets-none', text: t('chat.presetsNone') })
      return
    }
    for (const preset of presets) {
      const chip = el.createEl('button', { cls: 'pm-chat-preset', attr: { title: preset.question } })
      setIcon(chip.createSpan({ cls: 'pm-chat-preset-icon' }), scopeIcon(preset.scope))
      // A question with blanks says so: it asks something before it goes.
      const blanks = promptParams(preset.question).length > 0
      chip.createSpan({ cls: 'pm-chat-preset-label', text: blanks ? `${preset.label}…` : preset.label })
      chip.addEventListener(
        'click',
        safeAsync(() => this.askPreset(preset))
      )
    }
  }

  private presetMenu(event: MouseEvent): void {
    const presets = this.presets()
    if (!presets.length) {
      new Notice(t('chat.presetsNone'))
      return
    }
    const menu = new Menu()
    let scope = presets[0].scope
    for (const preset of presets) {
      if (preset.scope !== scope) {
        menu.addSeparator()
        scope = preset.scope
      }
      menu.addItem((item) =>
        item
          .setTitle(promptParams(preset.question).length ? `${preset.label}…` : preset.label)
          .setIcon(scopeIcon(preset.scope))
          .onClick(safeAsync(() => this.askPreset(preset)))
      )
    }
    menu.showAtMouseEvent(event)
  }

  /**
   * A ready question, its blanks asked for first when it has some, and the ones the chat
   * knows — today, the projects attached — filled in without asking.
   */
  private async askPreset(preset: ChatPrompt): Promise<void> {
    const params = promptParams(preset.question)
    let values: Record<string, string> = {}
    if (params.length) {
      const settings = this.plugin.settings
      const people = [...new Set([...settings.globalTeamMembers, ...this.plugin.index.allAssignees()].map(displayName))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
      const got = await askParams(this.app, preset.label, params, { people, languages: reqLanguages(settings) })
      if (!got) return
      values = got
    }
    const index = this.plugin.index
    const projects = [
      ...this.projects.map((path) => index.projectRef(path)?.title ?? ''),
      ...this.collections.map((path) => index.collectionRef(path)?.title ?? '')
    ]
      .filter(Boolean)
      .join(', ')
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    await this.send(fillPrompt(preset.question, values, { today, projects }))
  }

  /** Sends what is in the box, or a ready question — which leaves the box as it was. */
  private async send(ready?: string): Promise<void> {
    const text = (ready ?? this.inputEl.value).trim()
    if (!text || this.pending || this.missing()) return
    if (ready === undefined) this.inputEl.value = ''
    const context = this.useNote && this.contextFile ? this.contextFile.path : undefined
    // The passage chosen goes with this question, quoted under it, and only this one.
    const chosen = this.selection
    const content = chosen
      ? withSelection(text, chosen.text, (sent, total) => t('chat.selectionCut', { sent, total }))
      : text
    this.selection = null
    // A rewritten question takes the place of the one it rewrites, with what that one was
    // asked with, and of everything said after it.
    const editing = this.editing
    const at = editing ? this.turns.indexOf(editing) : -1
    this.editing = null
    if (editing && at >= 0) {
      this.follows = null
      this.branched = true
      this.turns = [...this.turns.slice(0, at), this.again(editing, content)]
      await this.ask()
      return
    }
    // A skill the question calls by one of its words is taken up, and the reader told.
    for (const called of calledSkills(this.allSkills(), content)) {
      if (this.skills.includes(called.path)) continue
      this.skills = [...this.skills, called.path]
      new Notice(t('chat.skillCalled', { name: called.name }), 6000)
    }
    // On an older branch, the question says where it goes on from.
    const follows = this.follows
    this.follows = null
    if (follows) this.branched = true
    this.turns = [
      ...withoutFailure(this.turns),
      {
        role: 'user',
        content,
        at: new Date().toISOString(),
        ...(context ? { context } : {}),
        ...(this.projects.length ? { projects: [...this.projects] } : {}),
        ...(this.collections.length ? { collections: [...this.collections] } : {}),
        ...(this.files.length ? { files: [...this.files] } : {}),
        ...(this.skills.length ? { skills: [...this.skills] } : {}),
        ...(this.attached.length ? { requirements: [...this.attached] } : {}),
        ...(follows ? { follows } : {})
      }
    ]
    await this.ask()
  }

  /** Sends the conversation as it stands, and adds the reply — or why there is none. */
  /** The reply so far, drawn at most every tenth of a second: Markdown is not free to draw. */
  private showLive(text: string): void {
    this.liveText = text
    if (this.liveTimer !== null) return
    this.liveTimer = window.setTimeout(() => {
      this.liveTimer = null
      this.drawLive()
    }, 100)
  }

  private drawLive(): void {
    const el = this.liveEl
    if (!el || !this.liveText) return
    // Followed down only by a reader who was at the bottom: one who scrolled up to read
    // something is not pulled away from it.
    const list = this.listEl
    const following = list.scrollHeight - list.scrollTop - list.clientHeight < 48
    el.empty()
    el.removeClass('pm-chat-typing')
    if (this.liveComponent) this.removeChild(this.liveComponent)
    this.liveComponent = this.addChild(new Component())
    void MarkdownRenderer.render(
      this.app,
      withoutOpenChange(this.liveText, t('chat.change.pending')),
      el.createDiv('pm-chat-body'),
      '',
      this.liveComponent
    )
    if (following) list.scrollTop = list.scrollHeight
  }

  private async ask(): Promise<void> {
    this.pending = true
    this.liveText = ''
    this.stopper = this.plugin.settings.chat.stream ? new AbortController() : null
    this.render()
    // Taken now: a model chosen while the reply is written is for the next question.
    const model = this.model
    try {
      // The note as it is at the moment of asking: the reader may have just edited it.
      const note = await this.contextNote(currentContext(this.turns))
      const system = withNote(t('chat.system', { date: new Date().toISOString().slice(0, 10) }), note, {
        heading: (title, path) => t('chat.noteHeading', { title, path }),
        truncated: (sent, total) => t('chat.noteTruncated', { sent, total })
      })
      // The requirements as the library holds them now, not as they were when chosen.
      const requirements = currentRequirements(this.turns)
        .map((id) => this.plugin.index.requirementById(id))
        .filter((found): found is Requirement => found !== undefined && found !== null)
      const block = requirementsContext(requirements, this.requirementWords)
      // The project as it stands at the moment of asking, like the note.
      const project = await this.projectsBlock(currentProjects(this.turns), currentCollections(this.turns))
      // The files as they are now: a planning replaced by its next issue is read again.
      const paths = currentFiles(this.turns)
      const asked = [...this.turns].reverse().find((turn) => turn.role === 'user')?.content ?? ''
      const files = await this.filesBlock(paths, asked)
      const lastQuestion = [...this.turns].reverse().find((turn) => turn.role === 'user')
      const skills = await this.skillsBlock(lastQuestion?.skills ?? [])
      const how = [this.changeInstructions(requirements.length > 0, project, paths.length > 0), this.noteInstructions()]
        .filter(Boolean)
        .join('\n\n')
      const request = {
        model,
        messages: chatMessages(
          this.turns,
          [system, project?.text, block, files, skills, how].filter(Boolean).join('\n\n')
        ),
        // The chat's own limit, none by default: a reply proposing thirty changes is long,
        // and one cut at the reviews' thousand tokens stops after seven.
        maxTokens: Math.max(0, this.plugin.settings.chat.maxTokens)
      }
      let reply: string
      let stopped = false
      let truncated = false
      if (this.stopper) {
        const outcome = await this.llm.chatStream(request, (text) => this.showLive(text), {
          signal: this.stopper.signal,
          onFallback: () => new Notice(t('chat.streamFallback'), 10000)
        })
        reply = outcome.text
        stopped = outcome.stopped
        truncated = outcome.truncated
      } else ({ text: reply, truncated } = await this.llm.reply(request))
      if (reply.trim()) {
        // Stopped part way, what had been written is kept: it is what the reader read.
        this.turns = [
          ...this.turns,
          {
            role: 'assistant',
            content: reply.trim(),
            at: new Date().toISOString(),
            model,
            ...(truncated ? { cut: true } : {})
          }
        ]
        await this.persist()
      } else if (stopped) {
        this.turns = [
          ...this.turns,
          { role: 'assistant', content: t('chat.stopped'), at: new Date().toISOString(), failed: true }
        ]
      }
    } catch (error) {
      const reason = error instanceof LlmError || error instanceof Error ? error.message : String(error)
      this.turns = [
        ...this.turns,
        { role: 'assistant', content: t('chat.failed', { reason }), at: new Date().toISOString(), failed: true }
      ]
    } finally {
      if (this.liveTimer !== null) window.clearTimeout(this.liveTimer)
      this.liveTimer = null
      this.liveText = ''
      if (this.liveComponent) this.removeChild(this.liveComponent)
      this.liveComponent = null
      this.stopper = null
      this.pending = false
      this.render()
    }
  }

  /**
   * What has been said since the last save, into the note.
   *
   * The first save makes the note; each one after adds to its end. A note deleted under
   * the panel is made again, with the whole conversation, rather than the exchange being
   * lost. A save that fails says so and leaves the conversation on screen as it was.
   */
  private async persist(): Promise<void> {
    const said = this.turns.filter((turn) => !turn.failed)
    const unsaved = said.filter((turn) => !this.saved.has(turn))
    if (!unsaved.length) return
    try {
      let file = this.notePath ? await this.notes.append(this.notePath, unsaved, this.words) : null
      if (file) for (const turn of unsaved) this.saved.add(turn)
      else {
        const question = said.find((turn) => turn.role === 'user')?.content ?? ''
        file = await this.notes.create(
          {
            title: chatTitle(question, t('chat.untitled')),
            model: this.model,
            created: said[0]?.at ?? new Date().toISOString()
          },
          said,
          this.words
        )
        for (const turn of said) this.saved.add(turn)
      }
      if (file.path !== this.notePath) {
        this.notePath = file.path
        this.app.workspace.requestSaveLayout()
      }
    } catch (error) {
      new Notice(t('chat.saveFailed', { reason: error instanceof Error ? error.message : String(error) }))
    }
  }

  /** A saved conversation, back on screen, where the next exchange will go on with it. */
  private async resume(file: TFile): Promise<void> {
    try {
      const note = await this.notes.load(file)
      this.editing = null
      this.follows = null
      this.branched = note.all.some(branches)
      this.turns = note.turns
      this.saved = new WeakSet(note.all)
      if (this.branched) await this.notes.ensureBranchBlock(file)
      this.notePath = file.path
      this.app.workspace.requestSaveLayout()
      this.render()
    } catch (error) {
      new Notice(t('chat.loadFailed', { reason: error instanceof Error ? error.message : String(error) }))
    }
  }

  /** The branches of the conversation on screen, for the command: none when none is kept. */
  async showBranches(): Promise<boolean> {
    if (!this.notePath) return false
    await this.openBranches(this.notePath)
    return true
  }

  /** The conversation's branches, drawn; a question picked is gone back to. */
  private async openBranches(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return
    const tree = conversationTree((await this.notes.load(file)).all)
    new BranchModal(
      this.app,
      tree,
      safeAsync((index: number) => this.goToBranch(file, index))
    ).open()
  }

  /**
   * A branch gone back to: the thread through the question picked, as far as that branch
   * was taken. The next question goes on from there, and says so in the note, so the
   * branch is the thread again when the conversation is picked up.
   */
  async goToBranch(file: TFile, index: number): Promise<void> {
    if (this.pending) return
    try {
      const note = await this.notes.load(file)
      const tree = conversationTree(note.all)
      if (!tree.exchanges[index]) return
      const end = branchEnd(tree, index)
      this.turns = threadTo(tree, end)
      this.saved = new WeakSet(note.all)
      this.notePath = file.path
      this.branched = note.all.some(branches)
      this.editing = null
      this.follows = end === tree.exchanges.length - 1 ? null : tree.exchanges[end].question.at
      this.app.workspace.requestSaveLayout()
      this.render()
      new Notice(t('chat.branchResumed'))
    } catch (error) {
      new Notice(t('chat.loadFailed', { reason: error instanceof Error ? error.message : String(error) }))
    }
  }

  private pickConversation(): void {
    const files = this.notes.list()
    if (!files.length) {
      new Notice(t('chat.historyEmpty'))
      return
    }
    new ConversationPicker(
      this.app,
      files,
      safeAsync((file: TFile) => this.resume(file))
    ).open()
  }
}

/** The files that can be read, by name, with where they are. */
class FilePicker extends SuggestModal<TFile> {
  constructor(
    app: App,
    private files: TFile[],
    private onChoose: (file: TFile) => void
  ) {
    super(app)
    this.setPlaceholder(t('chat.filePick'))
    this.limit = 200
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase()
    return this.files.filter((file) => file.path.toLowerCase().includes(q))
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createDiv({ text: file.name })
    el.createEl('small', { cls: 'pm-chat-pick-when', text: file.parent?.path ?? '' })
  }

  onChooseSuggestion(file: TFile): void {
    this.onChoose(file)
  }
}

/** Why a file gives no text, as a sentence. */
function fileProblemText(problem: FileProblem): string {
  switch (problem) {
    case 'unsupported':
      return t('chat.fileProblem.unsupported')
    case 'empty':
      return t('chat.fileProblem.empty')
    case 'unreadable':
      return t('chat.fileProblem.unreadable')
  }
}

/** The projects of the vault, by name, a programme said to be one. */
/** A project or a collection, as the picker offers them. */
interface ScopeChoice {
  kind: 'project' | 'collection'
  path: string
  title: string
  detail: string
}

class ScopePicker extends SuggestModal<ScopeChoice> {
  constructor(
    app: App,
    private choices: ScopeChoice[],
    private onChoose: (choice: ScopeChoice) => void
  ) {
    super(app)
    this.setPlaceholder(t('chat.projectPick'))
  }

  getSuggestions(query: string): ScopeChoice[] {
    const q = query.toLowerCase()
    return this.choices.filter(
      (choice) => choice.title.toLowerCase().includes(q) || choice.path.toLowerCase().includes(q)
    )
  }

  renderSuggestion(choice: ScopeChoice, el: HTMLElement): void {
    const line = el.createDiv({ cls: 'pm-chat-pick-line' })
    setIcon(line.createSpan({ cls: 'pm-chat-pick-icon' }), choice.kind === 'project' ? 'folder-kanban' : 'library')
    line.createSpan({ text: choice.title })
    el.createEl('small', { cls: 'pm-chat-pick-when', text: choice.detail })
  }

  onChooseSuggestion(choice: ScopeChoice): void {
    this.onChoose(choice)
  }
}

/** The saved conversations, latest first, by their title and the day they were last touched. */
class ConversationPicker extends SuggestModal<TFile> {
  constructor(
    app: App,
    private files: TFile[],
    private onChoose: (file: TFile) => void
  ) {
    super(app)
    this.setPlaceholder(t('chat.historyPick'))
  }

  private titleOf(file: TFile): string {
    const title: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.title
    return typeof title === 'string' && title ? title : file.basename
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase()
    return this.files.filter((file) => this.titleOf(file).toLowerCase().includes(q))
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createDiv({ text: this.titleOf(file) })
    el.createEl('small', { cls: 'pm-chat-pick-when', text: localStamp(new Date(file.stat.mtime).toISOString()) })
  }

  onChooseSuggestion(file: TFile): void {
    this.onChoose(file)
  }
}

/** The skills in the vault, by name, with what each is for. */
class SkillPicker extends SuggestModal<Skill> {
  constructor(
    app: App,
    private skills: Skill[],
    private onChoose: (skill: Skill) => void
  ) {
    super(app)
    this.setPlaceholder(t('chat.skillPickPlaceholder'))
  }

  getSuggestions(query: string): Skill[] {
    const q = query.toLowerCase()
    return this.skills.filter(
      (skill) => skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q)
    )
  }

  renderSuggestion(skill: Skill, el: HTMLElement): void {
    const line = el.createDiv({ cls: 'pm-chat-pick-line' })
    setIcon(line.createSpan({ cls: 'pm-chat-pick-icon' }), 'sparkles')
    line.createSpan({ text: skill.name })
    if (skill.description) el.createEl('small', { cls: 'pm-chat-pick-when', text: skill.description })
  }

  onChooseSuggestion(skill: Skill): void {
    this.onChoose(skill)
  }
}
