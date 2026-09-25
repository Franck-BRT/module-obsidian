import {
  Component,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
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
  withNote,
  withoutFailure,
  type ChatTurn,
  type ContextNote
} from '../../store/chat/chatSession'
import { chatTitle, isChatNote, localStamp, type ChatNoteWords } from '../../store/chat/chatNote'
import { ChatNotes } from '../../store/chat/ChatNotes'
import { currentRequirements, requirementsContext, type RequirementWords } from '../../store/chat/chatRequirements'
import type { Requirement } from '../../store/requirements/Requirement'
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
  private contextEl: HTMLElement | null = null
  /** The reply being written, drawn as it grows; null when none is. */
  private liveEl: HTMLElement | null = null
  private liveText = ''
  private liveTimer: number | null = null
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
    const el = this.contextEl
    if (!el) return
    el.empty()
    const file = this.contextFile
    const noteRow = el.createDiv('pm-chat-context-row')
    noteRow.toggleClass('pm-chat-context--off', !file || !this.useNote)
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
    return { path: file.path, title: file.basename, content: await this.app.vault.cachedRead(file) }
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

  /** What is missing before a question can be asked, or null when nothing is. */
  private missing(): string | null {
    const settings = this.plugin.settings.llm
    if (!settings.enabled || !settings.baseUrl.trim()) return t('chat.notConfigured')
    if (!settings.modelText.trim()) return t('chat.noModel')
    return null
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root', 'pm-chat')

    const head = root.createDiv('pm-chat-head')
    const titles = head.createDiv('pm-chat-titles')
    titles.createDiv({ cls: 'pm-chat-title', text: t('chat.title') })
    const model = this.plugin.settings.llm.modelText.trim()
    if (model) titles.createDiv({ cls: 'pm-chat-model', text: model })
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

    this.listEl = root.createDiv('pm-chat-list')
    const missing = this.missing()
    if (missing) this.renderSetup(missing)
    else if (!this.turns.length) this.listEl.createDiv({ cls: 'pm-chat-empty', text: t('chat.empty') })
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
    if (turn.requirements?.length) {
      const about = this.listEl.createDiv('pm-chat-about')
      setIcon(about.createSpan(), 'list-checks')
      about.createSpan({ text: turn.requirements.join(', ') })
      about.setAttr('title', turn.requirements.join(', '))
    }
    if (turn.role === 'assistant' && !turn.failed) {
      // A reply is written in Markdown more often than not: lists, code, tables.
      void MarkdownRenderer.render(this.app, turn.content, body, '', this)
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

  private async send(): Promise<void> {
    const text = this.inputEl.value.trim()
    if (!text || this.pending || this.missing()) return
    this.inputEl.value = ''
    const context = this.useNote && this.contextFile ? this.contextFile.path : undefined
    this.turns = [
      ...withoutFailure(this.turns),
      {
        role: 'user',
        content: text,
        at: new Date().toISOString(),
        ...(context ? { context } : {}),
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
    void MarkdownRenderer.render(this.app, this.liveText, el.createDiv('pm-chat-body'), '', this.liveComponent)
    if (following) list.scrollTop = list.scrollHeight
  }

  private async ask(): Promise<void> {
    this.pending = true
    this.liveText = ''
    this.stopper = this.plugin.settings.chat.stream ? new AbortController() : null
    this.render()
    const settings = this.plugin.settings.llm
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
      const request = {
        model: settings.modelText,
        messages: chatMessages(this.turns, block ? `${system}\n\n${block}` : system)
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
        this.turns = [...this.turns, { role: 'assistant', content: reply.trim(), at: new Date().toISOString() }]
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
            model: this.plugin.settings.llm.modelText,
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
