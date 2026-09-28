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
import { chatTitle, isChatNote, localStamp, type ChatNoteWords } from '../../store/chat/chatNote'
import { ChatNotes } from '../../store/chat/ChatNotes'
import { currentRequirements, requirementsContext, type RequirementWords } from '../../store/chat/chatRequirements'
import { currentProject, projectContext, projectParts, type ProjectWords } from '../../store/chat/chatProject'
import { changeBlocks, parseChange, withoutOpenChange } from '../../store/chat/chatChange'
import { applyCreate, applyToRequirement, applyToTicket, type Applied } from '../../store/chat/applyChange'
import {
  currentFiles,
  fileText,
  filesContext,
  FileReadError,
  imageDataUrl,
  isImage,
  isReadable,
  readPdfText,
  type ContextFile,
  type FileProblem
} from '../../store/chat/chatFile'
import {
  needsOcr,
  readTranscript,
  transcribe,
  transcriptNote,
  transcriptPath,
  type OcrSource
} from '../../store/chat/ocr'
import { pdfPages } from './pdfPages'
import { keepDroppedFile } from '../../store/chat/keepFile'
import { chatModel, chatModels } from '../../store/chat/chatModels'
import { availablePrompts, parsePrompts, type ChatPrompt } from '../../store/chat/chatPrompts'
import { builtinPrompts, scopeIcon } from './chatPresets'
import { requirementOptions } from './changeCard'
import type { Requirement } from '../../store/requirements/Requirement'
import { ProjectScope, resolveScopePaths, type ScopeSpec } from '../../store/ProjectScope'
import type { ProjectRef } from '../../store/VaultIndex'
import { docStateConfigOf, typeConfigOf } from '../../store/TicketPalette'
import { TASK_TYPES, type DocState, type TaskType } from '../../types'
import { today } from '../../dates'
import {
  reqCriticalityGlyph,
  reqLinkKindLabel,
  reqStatusGlyph,
  reqTypeGlyph,
  verificationLabel
} from '../requirements/reqPalette'
import { LlmClient, LlmError } from '../../store/llm'
import { safeAsync } from '../../utils'
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
  /** The project talked about, by the path of its note: sent with every question until taken off. */
  private project: string | null = null
  private contextEl: HTMLElement | null = null
  /** The ready questions offered while the conversation is empty. */
  private presetsEl: HTMLElement | null = null
  /** Files attached — a planning, a report — by path, sent with every question until taken off. */
  private files: string[] = []
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
        if (oldPath === this.project) {
          this.project = file.path
          this.renderContext()
        }
        if (this.files.includes(oldPath)) {
          this.files = this.files.map((path) => (path === oldPath ? file.path : path))
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
      void this.dropFiles(Array.from(dropped))
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

    this.renderProjectRow(el)
    this.renderFileRows(el)

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

  /** The project row: the one attached, with the way to take it off, or the way to choose one. */
  private renderProjectRow(el: HTMLElement): void {
    const row = el.createDiv('pm-chat-context-row')
    setIcon(row.createSpan({ cls: 'pm-chat-context-icon' }), 'folder-kanban')
    const ref = this.project ? this.plugin.index.projectRef(this.project) : null
    if (!ref) {
      row.addClass('pm-chat-context--empty')
      row.createSpan({ cls: 'pm-chat-context-name', text: t('chat.noProject') })
      const pick = row.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.pickProject') } })
      setIcon(pick, 'plus')
      pick.addEventListener('click', () => this.pickProject())
      return
    }
    const name = row.createEl('a', {
      cls: 'pm-chat-context-name',
      text: ref.program ? `${ref.title} (${t('chat.projectProgram')})` : ref.title,
      attr: { title: t('chat.projectOpen') }
    })
    name.addEventListener(
      'click',
      safeAsync(() => this.plugin.router.openProjectLink(ref.path))
    )
    const off = row.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.projectOff') } })
    setIcon(off, 'x')
    off.addEventListener('click', () => {
      this.project = null
      this.renderContext()
    })
  }

  /** One row a file attached, with the way to open it and the way to take it off. */
  private renderFileRows(el: HTMLElement): void {
    for (const path of this.files) {
      const row = el.createDiv('pm-chat-context-row')
      setIcon(row.createSpan({ cls: 'pm-chat-context-icon' }), 'paperclip')
      const name = row.createEl('a', {
        cls: 'pm-chat-context-name',
        text: path.slice(path.lastIndexOf('/') + 1),
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

  /**
   * A file to read with the questions: it goes with every one from here on, until taken
   * off, like the note and the project.
   */
  attachFile(path: string): void {
    if (!this.files.includes(path)) this.files = [...this.files, path]
    this.renderContext()
    window.setTimeout(() => this.inputEl?.focus(), 0)
  }

  /**
   * The files that can be read, the attached project's own first — its documents are what
   * a question about it is most likely about — then the most recently changed.
   */
  private pickFile(): void {
    const ref = this.project ? this.plugin.index.projectRef(this.project) : null
    const folder = ref ? ref.path.slice(0, ref.path.lastIndexOf('/') + 1) : null
    const files = this.app.vault
      .getFiles()
      .filter((file) => isReadable(file.extension) && !this.files.includes(file.path))
      .filter((file) => file.extension !== 'md' || !isChatNote(this.app.metadataCache.getFileCache(file)?.frontmatter))
      .sort((a, b) => {
        const own = (file: TFile): number => (folder && file.path.startsWith(folder) ? 0 : 1)
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
  private async dropFiles(files: File[]): Promise<void> {
    const settings = this.plugin.settings
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
          this.project
        )
        this.attachFile(kept.path)
        const project = this.project ? (this.plugin.index.projectRef(this.project)?.title ?? '') : ''
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
  private async filesBlock(paths: string[]): Promise<string> {
    const read: ContextFile[] = []
    const unread: string[] = []
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) continue
      const key = `${path}|${this.ocrForced.has(path) ? 'ocr' : 'text'}`
      const cached = this.fileCache.get(key)
      let text = cached && cached.mtime === file.stat.mtime ? cached.text : null
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
    const block = filesContext(read, {
      heading: (name, path) => t('chat.fileHeading', { name, path }),
      truncated: (sent, total) => t('chat.fileTruncated', { sent, total })
    })
    return [block, ...unread].filter(Boolean).join('\n\n')
  }

  /**
   * A file's text, however it has to be had: a picture read by a model that sees, a PDF
   * with no text to speak of drawn page by page and read the same way, anything else by
   * its reader.
   */
  private async readAttached(file: TFile): Promise<string> {
    const bytes = new Uint8Array(await this.app.vault.readBinary(file))
    if (isImage(file.extension)) {
      return this.transcribed(file, { pages: 1, render: () => Promise.resolve(imageDataUrl(file.extension, bytes)) })
    }
    if (file.extension.toLowerCase() !== 'pdf') return fileText(file.extension, bytes)
    let text = ''
    let pages = 1
    try {
      ;({ text, pages } = await readPdfText(bytes))
    } catch {
      // A PDF this plugin cannot take apart may still be one the viewer can draw.
    }
    if (!this.ocrForced.has(file.path) && !needsOcr(text, pages)) return text
    const source = await pdfPages(bytes)
    try {
      return await this.transcribed(file, source)
    } finally {
      source.close()
    }
  }

  /**
   * A document read by a model that sees, page by page, its transcription kept in a note
   * beside it — and that note read instead, as long as the document has not changed: a
   * scan is slow and not free to read, and the reader may have corrected what the model
   * made of a blurred date.
   */
  private async transcribed(file: TFile, source: OcrSource): Promise<string> {
    const path = normalizePath(transcriptPath(file.path, t('chat.ocrSuffix')))
    const existing = this.app.vault.getAbstractFileByPath(path)
    if (existing instanceof TFile) {
      const kept = readTranscript(await this.app.vault.cachedRead(existing))
      if (kept && kept.sourceMtime === file.stat.mtime && kept.text) return kept.text
    }
    const model = this.plugin.settings.llm.modelOcr.trim() || this.model
    const notice = new Notice(t('chat.ocrReading', { name: file.name, page: 1, total: source.pages }), 0)
    try {
      const result = await transcribe(
        source,
        (image, page, total) => this.llm.readImage({ model, prompt: t('chat.ocrPrompt', { page, total }), image }),
        {
          page: (page, total) => t('chat.ocrPage', { page, total }),
          failed: (page, reason) => t('chat.ocrPageFailed', { page, reason }),
          skipped: (count) => t('chat.ocrSkipped', { count })
        },
        (page, total) => notice.setMessage(t('chat.ocrReading', { name: file.name, page, total }))
      )
      // Nothing read at all is a model that does not see, most likely: said as such.
      if (!result.read) throw new Error(t('chat.ocrNothing', { model }))
      const note = transcriptNote(
        { source: file.path, sourceMtime: file.stat.mtime, model, at: new Date().toISOString(), pages: source.pages },
        result.text,
        t('chat.ocrHeading', { model })
      )
      if (existing instanceof TFile) await this.app.vault.modify(existing, note)
      else await this.app.vault.create(path, note)
      new Notice(t('chat.ocrDone', { name: file.name, path }), 8000)
      this.renderContext()
      return result.text
    } finally {
      notice.hide()
    }
  }

  private pickProject(): void {
    new ProjectPicker(this.app, this.plugin.index.projectRefs(), (ref) => this.attachProject(ref.path)).open()
  }

  /**
   * A project to talk about: it goes with every question from here on, until taken off,
   * the way the open note does. One at a time — a programme stands for the projects it
   * groups.
   */
  attachProject(path: string): void {
    this.project = path
    this.renderContext()
    window.setTimeout(() => this.inputEl?.focus(), 0)
  }

  /**
   * The project a question was asked about, written out as it stands now; '' when it is
   * gone. The projects under it come with it, each with its own tickets.
   */
  private async projectBlock(
    path: string | undefined
  ): Promise<{ text: string; statuses: string[]; priorities: string[] } | null> {
    const ref = path ? this.plugin.index.projectRef(path) : null
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
      this.projectWords
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
    // The model, as a button: the list of what the gateway offers is one click away.
    const model = this.model
    const configured = this.plugin.settings.llm.enabled && this.plugin.settings.llm.baseUrl.trim() !== ''
    if (configured) {
      const pick = titles.createEl('button', {
        cls: 'pm-chat-model pm-chat-model-pick',
        attr: { 'aria-label': t('chat.modelPick'), title: t('chat.modelPick') }
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
    button('history', t('chat.history'), () => this.pickConversation())
    button('square-pen', t('chat.new'), () => {
      this.turns = []
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
    attach.addEventListener('click', () => this.pickFile())
    const ready = composer.createEl('button', {
      cls: 'clickable-icon pm-chat-ready',
      attr: { 'aria-label': t('chat.presets') }
    })
    setIcon(ready, 'zap')
    ready.disabled = missing !== null || this.pending
    ready.addEventListener('click', (event) => this.presetMenu(event))
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
    if (turn.project) {
      const about = this.listEl.createDiv('pm-chat-about')
      setIcon(about.createSpan(), 'folder-kanban')
      about.createSpan({
        text:
          this.plugin.index.projectRef(turn.project)?.title ?? turn.project.replace(/^.*\//, '').replace(/\.md$/i, '')
      })
      about.setAttr('title', turn.project)
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
    if (turn.role === 'assistant' && !turn.failed) {
      // A reply is written in Markdown more often than not: lists, code, tables.
      void MarkdownRenderer.render(this.app, turn.content, body, '', this.turnsComponent ?? this)
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
    // A reply is copied into a note; a question is still in the reader's head.
    if (turn.role !== 'assistant') return
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
      project: this.project !== null && this.plugin.index.projectRef(this.project) !== null,
      requirements: this.attached.length > 0,
      file: this.files.length > 0
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
      chip.createSpan({ cls: 'pm-chat-preset-label', text: preset.label })
      chip.addEventListener(
        'click',
        safeAsync(() => this.send(preset.question))
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
          .setTitle(preset.label)
          .setIcon(scopeIcon(preset.scope))
          .onClick(safeAsync(() => this.send(preset.question)))
      )
    }
    menu.showAtMouseEvent(event)
  }

  /** Sends what is in the box, or a ready question — which leaves the box as it was. */
  private async send(ready?: string): Promise<void> {
    const text = (ready ?? this.inputEl.value).trim()
    if (!text || this.pending || this.missing()) return
    if (ready === undefined) this.inputEl.value = ''
    const context = this.useNote && this.contextFile ? this.contextFile.path : undefined
    this.turns = [
      ...withoutFailure(this.turns),
      {
        role: 'user',
        content: text,
        at: new Date().toISOString(),
        ...(context ? { context } : {}),
        ...(this.project ? { project: this.project } : {}),
        ...(this.files.length ? { files: [...this.files] } : {}),
        ...(this.attached.length ? { requirements: [...this.attached] } : {})
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
      const project = await this.projectBlock(currentProject(this.turns))
      // The files as they are now: a planning replaced by its next issue is read again.
      const paths = currentFiles(this.turns)
      const files = await this.filesBlock(paths)
      const how = this.changeInstructions(requirements.length > 0, project, paths.length > 0)
      const request = {
        model,
        messages: chatMessages(this.turns, [system, project?.text, block, files, how].filter(Boolean).join('\n\n'))
      }
      let reply: string
      let stopped = false
      if (this.stopper) {
        const outcome = await this.llm.chatStream(request, (text) => this.showLive(text), {
          signal: this.stopper.signal,
          onFallback: () => new Notice(t('chat.streamFallback'), 10000)
        })
        reply = outcome.text
        stopped = outcome.stopped
      } else reply = await this.llm.chat(request)
      if (reply.trim()) {
        // Stopped part way, what had been written is kept: it is what the reader read.
        this.turns = [...this.turns, { role: 'assistant', content: reply.trim(), at: new Date().toISOString(), model }]
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
      this.turns = note.turns
      this.saved = new WeakSet(note.turns)
      this.notePath = file.path
      this.app.workspace.requestSaveLayout()
      this.render()
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
class ProjectPicker extends SuggestModal<ProjectRef> {
  constructor(
    app: App,
    private refs: ProjectRef[],
    private onChoose: (ref: ProjectRef) => void
  ) {
    super(app)
    this.setPlaceholder(t('chat.projectPick'))
  }

  getSuggestions(query: string): ProjectRef[] {
    const q = query.toLowerCase()
    return this.refs.filter((ref) => ref.title.toLowerCase().includes(q) || ref.path.toLowerCase().includes(q))
  }

  renderSuggestion(ref: ProjectRef, el: HTMLElement): void {
    el.createDiv({ text: ref.title })
    el.createEl('small', {
      cls: 'pm-chat-pick-when',
      text: ref.program ? `${t('chat.projectProgram')} · ${ref.path}` : ref.path
    })
  }

  onChooseSuggestion(ref: ProjectRef): void {
    this.onChoose(ref)
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
