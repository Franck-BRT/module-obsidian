import {
  ItemView,
  MarkdownRenderer,
  Notice,
  setIcon,
  SuggestModal,
  TFile,
  type App,
  type ViewStateResult,
  type WorkspaceLeaf
} from 'obsidian'
import type PMPlugin from '../../main'
import { chatMessages, withoutFailure, type ChatTurn } from '../../store/chat/chatSession'
import { chatTitle, localStamp, type ChatNoteWords } from '../../store/chat/chatNote'
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
    this.turns = [...withoutFailure(this.turns), { role: 'user', content: text, at: new Date().toISOString() }]
    await this.ask()
  }

  /** Sends the conversation as it stands, and adds the reply — or why there is none. */
  private async ask(): Promise<void> {
    this.pending = true
    this.render()
    const settings = this.plugin.settings.llm
    try {
      const reply = await this.llm.chat({
        model: settings.modelText,
        messages: chatMessages(this.turns, t('chat.system', { date: new Date().toISOString().slice(0, 10) }))
      })
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
