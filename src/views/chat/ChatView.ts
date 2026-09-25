import { ItemView, MarkdownRenderer, Notice, setIcon, type WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../../main'
import { chatMessages, withoutFailure, type ChatTurn } from '../../store/chat/chatSession'
import { LlmClient, LlmError } from '../../store/llm'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

export const PM_CHAT_VIEW_TYPE = 'pm-chat'

/**
 * A conversation with the language model the plugin is already set up to use.
 *
 * The same gateway, the same text model and the same limits as the requirement reviews,
 * so there is one place where the model is chosen and one where it is switched off. The
 * conversation lives in the panel for now; closing the panel ends it.
 */
export class ChatView extends ItemView {
  private turns: ChatTurn[] = []
  private pending = false
  private listEl!: HTMLElement
  private inputEl!: HTMLTextAreaElement
  private sendEl!: HTMLButtonElement

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
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
    this.render()
    return Promise.resolve()
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
    const fresh = head.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('chat.new') } })
    setIcon(fresh, 'square-pen')
    fresh.addEventListener('click', () => {
      if (this.pending) return
      this.turns = []
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
}
