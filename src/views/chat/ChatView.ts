import {
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
  private contextEl: HTMLElement | null = null
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

  /** The strip above the box: which note goes with the question, and the switch for it. */
  private renderContext(): void {
    const el = this.contextEl
    if (!el) return
    el.empty()
    const file = this.contextFile
    el.toggleClass('pm-chat-context--off', !file || !this.useNote)
    setIcon(el.createSpan({ cls: 'pm-chat-context-icon' }), 'file-text')
    if (!file) {
      el.createSpan({ cls: 'pm-chat-context-name', text: t('chat.noNote') })
      return
    }
    const name = el.createEl('a', { cls: 'pm-chat-context-name', text: file.basename, attr: { title: file.path } })
    name.addEventListener(
      'click',
      safeAsync(() => this.app.workspace.getLeaf(false).openFile(file))
    )
    const toggle = el.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': this.useNote ? t('chat.noteOff') : t('chat.noteOn') }
    })
    setIcon(toggle, this.useNote ? 'eye' : 'eye-off')
    toggle.addEventListener('click', () => {
      this.useNote = !this.useNote
      this.renderContext()
    })
  }

  /** The note a question was asked about, read as it is now. Null when it is gone. */
  private async contextNote(path: string | undefined): Promise<ContextNote | null> {
    if (!path) return null
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return null
    return { path: file.path, title: file.basename, content: await this.app.vault.cachedRead(file) }
  }

  private get words(): ChatNoteWords {
    return { user: t('chat.you'), assistant: t('chat.assistant') }
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
      const typing = this.listEl.createDiv('pm-chat-turn pm-chat-turn--assistant pm-chat-typing')
      typing.createSpan({ text: t('chat.thinking') })
    }

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
    this.sendEl = composer.createEl('button', { cls: 'mod-cta pm-chat-send', attr: { 'aria-label': t('chat.send') } })
    setIcon(this.sendEl, 'send')
    this.sendEl.disabled = missing !== null || this.pending
    this.sendEl.addEventListener(
      'click',
      safeAsync(() => this.send())
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
    if (turn.context) {
      // Said on the question itself: what the model was shown when it answered.
      const about = this.listEl.createDiv('pm-chat-about')
      setIcon(about.createSpan(), 'file-text')
      about.createSpan({ text: turn.context.replace(/^.*\//, '').replace(/\.md$/i, '') })
      about.setAttr('title', turn.context)
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
      { role: 'user', content: text, at: new Date().toISOString(), ...(context ? { context } : {}) }
    ]
    await this.ask()
  }

  /** Sends the conversation as it stands, and adds the reply — or why there is none. */
  private async ask(): Promise<void> {
    this.pending = true
    this.render()
    const settings = this.plugin.settings.llm
    try {
      // The note as it is at the moment of asking: the reader may have just edited it.
      const note = await this.contextNote(currentContext(this.turns))
      const system = withNote(t('chat.system', { date: new Date().toISOString().slice(0, 10) }), note, {
        heading: (title, path) => t('chat.noteHeading', { title, path }),
        truncated: (sent, total) => t('chat.noteTruncated', { sent, total })
      })
      const reply = await this.llm.chat({ model: settings.modelText, messages: chatMessages(this.turns, system) })
      this.turns = [...this.turns, { role: 'assistant', content: reply.trim(), at: new Date().toISOString() }]
      await this.persist()
    } catch (error) {
      const reason = error instanceof LlmError || error instanceof Error ? error.message : String(error)
      this.turns = [
        ...this.turns,
        { role: 'assistant', content: t('chat.failed', { reason }), at: new Date().toISOString(), failed: true }
      ]
    } finally {
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
