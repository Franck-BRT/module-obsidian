import { ItemView, Menu, Notice, setIcon, TFile, type WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../../main'
import { parsePrompts, type ChatPrompt } from '../../store/chat/chatPrompts'
import { promptParams } from '../../store/chat/promptParams'
import {
  asChatPrompt,
  groupPrompts,
  matchesPrompt,
  promptCategories,
  type PromptNote
} from '../../store/chat/promptLibrary'
import { fold } from '../../store/library/libraryDoc'
import { builtinPrompts, scopeIcon, scopeWord } from '../chat/chatPresets'
import { confirmDialog } from '../../ui/ModalFactory'
import { explain } from '../../ui/explain'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'
import { PromptModal, type PromptEdit } from './PromptModal'
import { allPrompts, createPrompt, updatePrompt } from './promptVault'

export const PM_PROMPTS_VIEW_TYPE = 'pm-prompts'

/**
 * The prompt library: the reader's questions for the chat, by category, each to use at
 * once, to put in the chat's box to adjust first, to change, to mark as a favourite —
 * then the plugin's own, to use as they are or to copy and make one's own.
 */
export class PromptsView extends ItemView {
  private prompts: PromptNote[] = []
  private search = ''
  private category = ''
  private bodyEl!: HTMLElement
  private categoryEl!: HTMLSelectElement
  private redrawTimer: number | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
  }

  getViewType(): string {
    return PM_PROMPTS_VIEW_TYPE
  }

  getDisplayText(): string {
    return t('prompts.title')
  }

  getIcon(): string {
    return 'message-square-quote'
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root', 'pm-prompts')
    this.buildHead(root)
    this.bodyEl = root.createDiv('pm-prompts-body')
    // A prompt written, changed, moved or thrown away, here or in its note: drawn again.
    const later = (): void => this.reloadSoon()
    this.registerEvent(this.app.metadataCache.on('changed', later))
    this.registerEvent(this.app.vault.on('delete', later))
    this.registerEvent(this.app.vault.on('rename', later))
    await this.reload()
  }

  onClose(): Promise<void> {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    return Promise.resolve()
  }

  private reloadSoon(): void {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    this.redrawTimer = window.setTimeout(
      safeAsync(async () => {
        this.redrawTimer = null
        await this.reload()
      }),
      300
    )
  }

  private async reload(): Promise<void> {
    this.prompts = await allPrompts(this.app)
    this.renderCategories()
    this.renderBody()
  }

  private buildHead(root: HTMLElement): void {
    const head = root.createDiv('pm-prompts-head')
    const title = head.createDiv('pm-prompts-title')
    setIcon(title.createSpan('pm-prompts-title-icon'), 'message-square-quote')
    title.createEl('h2', { text: t('prompts.title') })
    head.createDiv({ cls: 'pm-prompts-intro', text: t('prompts.intro') })
    const bar = head.createDiv('pm-prompts-bar')
    const search = bar.createEl('input', {
      cls: 'pm-prompts-search',
      attr: { type: 'search', placeholder: t('prompts.search') }
    })
    search.addEventListener('input', () => {
      this.search = search.value
      this.renderBody()
    })
    this.categoryEl = bar.createEl('select', { cls: 'dropdown pm-prompts-category' })
    this.categoryEl.addEventListener('change', () => {
      this.category = this.categoryEl.value
      this.renderBody()
    })
    const own = parsePrompts(this.plugin.settings.chat.prompts)
    if (own.length) {
      const bring = bar.createEl('button', { text: t('prompts.import') })
      explain(bring, t('prompts.import'), t('prompts.importHint'))
      bring.addEventListener(
        'click',
        safeAsync(() => this.importSettings())
      )
    }
    const add = bar.createEl('button', { cls: 'mod-cta' })
    setIcon(add.createSpan('pm-prompts-button-icon'), 'plus')
    add.createSpan({ text: t('prompts.new') })
    add.addEventListener('click', () => this.edit())
  }

  private renderCategories(): void {
    const select = this.categoryEl
    select.empty()
    select.createEl('option', { text: t('prompts.allCategories'), attr: { value: '' } })
    for (const category of promptCategories(this.prompts)) {
      select.createEl('option', { text: category, attr: { value: category } })
    }
    if (this.category && !promptCategories(this.prompts).some((one) => fold(one) === fold(this.category))) {
      this.category = ''
    }
    select.value = this.category
  }

  private renderBody(): void {
    const body = this.bodyEl
    body.empty()
    const shown = this.prompts.filter(
      (prompt) =>
        matchesPrompt(prompt, this.search) && (!this.category || fold(prompt.category) === fold(this.category))
    )
    if (!this.prompts.length) {
      const empty = body.createDiv('pm-prompts-empty')
      setIcon(empty.createDiv('pm-prompts-empty-icon'), 'message-square-quote')
      empty.createDiv({ cls: 'pm-prompts-empty-title', text: t('prompts.emptyTitle') })
      empty.createDiv({ cls: 'pm-prompts-empty-text', text: t('prompts.emptyText') })
    } else if (!shown.length) {
      body.createDiv({ cls: 'pm-prompts-none', text: t('prompts.nothingFound') })
    }
    for (const group of groupPrompts(shown)) {
      const section = body.createDiv('pm-prompts-section')
      section.createEl('h3', {
        cls: 'pm-prompts-section-title',
        text: group.category || t('prompts.noCategory')
      })
      const grid = section.createDiv('pm-prompts-grid')
      for (const prompt of group.prompts) this.renderCard(grid, prompt)
    }
    this.renderBuiltins(body)
  }

  private renderCard(grid: HTMLElement, prompt: PromptNote): void {
    const card = grid.createDiv('pm-prompt-card')
    const head = card.createDiv('pm-prompt-card-head')
    setIcon(head.createSpan('pm-prompt-card-icon'), scopeIcon(prompt.scope))
    const name = head.createEl('a', { cls: 'pm-prompt-card-name', text: prompt.name, href: '#' })
    name.addEventListener('click', (event) => {
      event.preventDefault()
      this.edit(prompt)
    })
    const star = head.createEl('button', {
      cls: `clickable-icon pm-prompt-star${prompt.favorite ? ' is-on' : ''}`,
      attr: { 'aria-label': prompt.favorite ? t('prompts.unfavorite') : t('prompts.favorite') }
    })
    setIcon(star, 'star')
    explain(star, prompt.favorite ? t('prompts.unfavorite') : t('prompts.favorite'), t('prompts.favoriteHint'))
    star.addEventListener(
      'click',
      safeAsync(() => this.save(prompt, { name: prompt.name, draft: this.draftOf(prompt, !prompt.favorite) }))
    )
    const meta = card.createDiv('pm-prompt-card-meta')
    const word = scopeWord(prompt.scope)
    if (word) meta.createSpan({ cls: 'pm-prompt-chip', text: t('prompts.needs', { what: word }) })
    if (promptParams(prompt.question).length) meta.createSpan({ cls: 'pm-prompt-chip', text: t('prompts.blanks') })
    card.createDiv({ cls: 'pm-prompt-card-text', text: prompt.description || prompt.question })
    this.renderActions(card, asChatPrompt(prompt), prompt)
  }

  /** Use, put in the box, and — for one of the reader's — change, open, copy, delete. */
  private renderActions(card: HTMLElement, chat: ChatPrompt, prompt?: PromptNote): void {
    const actions = card.createDiv('pm-prompt-card-actions')
    const use = actions.createEl('button', { cls: 'mod-cta', text: t('prompts.use') })
    explain(use, t('prompts.use'), t('prompts.useHint'))
    use.addEventListener(
      'click',
      safeAsync(() => this.plugin.usePrompt(chat, 'send'))
    )
    const insert = actions.createEl('button', { text: t('prompts.insert') })
    explain(insert, t('prompts.insert'), t('prompts.insertHint'))
    insert.addEventListener(
      'click',
      safeAsync(() => this.plugin.usePrompt(chat, 'insert'))
    )
    const more = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('prompts.more') } })
    setIcon(more, 'more-horizontal')
    more.addEventListener('click', (event) => {
      const menu = new Menu()
      if (prompt) {
        menu.addItem((item) =>
          item
            .setTitle(t('prompts.edit'))
            .setIcon('pencil')
            .onClick(() => this.edit(prompt))
        )
        menu.addItem((item) =>
          item
            .setTitle(t('prompts.openNote'))
            .setIcon('file-text')
            .onClick(
              safeAsync(async () => {
                const file = this.app.vault.getAbstractFileByPath(prompt.path)
                if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file)
              })
            )
        )
      }
      menu.addItem((item) =>
        item
          .setTitle(prompt ? t('prompts.duplicate') : t('prompts.copyBuiltin'))
          .setIcon('copy')
          .onClick(() => this.copy(chat, prompt))
      )
      if (prompt) {
        menu.addSeparator()
        menu.addItem((item) =>
          item
            .setTitle(t('prompts.delete'))
            .setIcon('trash-2')
            .onClick(safeAsync(() => this.remove(prompt)))
        )
      }
      menu.showAtMouseEvent(event)
    })
  }

  /** The plugin's own questions, folded away: to use as they are, or to copy and adjust. */
  private renderBuiltins(body: HTMLElement): void {
    const builtins = builtinPrompts().filter((prompt) => {
      const words = fold(this.search).split(/\s+/).filter(Boolean)
      const hay = fold(`${prompt.label}\n${prompt.question}`)
      return words.every((word) => hay.includes(word))
    })
    if (!builtins.length || this.category) return
    const details = body.createEl('details', { cls: 'pm-prompts-builtins' })
    if (this.search.trim()) details.open = true
    details.createEl('summary', { text: t('prompts.builtins', { count: builtins.length }) })
    details.createDiv({ cls: 'pm-prompts-builtins-intro', text: t('prompts.builtinsIntro') })
    const grid = details.createDiv('pm-prompts-grid')
    for (const prompt of builtins) {
      const card = grid.createDiv('pm-prompt-card is-builtin')
      const head = card.createDiv('pm-prompt-card-head')
      setIcon(head.createSpan('pm-prompt-card-icon'), scopeIcon(prompt.scope))
      head.createSpan({ cls: 'pm-prompt-card-name', text: prompt.label })
      const word = scopeWord(prompt.scope)
      if (word) {
        const meta = card.createDiv('pm-prompt-card-meta')
        meta.createSpan({ cls: 'pm-prompt-chip', text: t('prompts.needs', { what: word }) })
      }
      card.createDiv({ cls: 'pm-prompt-card-text', text: prompt.question })
      this.renderActions(card, prompt)
    }
  }

  private draftOf(prompt: PromptNote, favorite = prompt.favorite): PromptEdit['draft'] {
    return {
      scope: prompt.scope,
      scopeWord: scopeWord(prompt.scope),
      category: prompt.category,
      description: prompt.description,
      favorite,
      question: prompt.question
    }
  }

  private edit(prompt?: PromptNote): void {
    new PromptModal(
      this.app,
      promptCategories(this.prompts),
      (edit) => this.save(prompt, edit),
      prompt ??
        (this.category
          ? { name: '', question: '', scope: 'any', category: this.category, description: '', favorite: false }
          : undefined),
      !!prompt
    ).open()
  }

  private copy(chat: ChatPrompt, prompt?: PromptNote): void {
    new PromptModal(this.app, promptCategories(this.prompts), (edit) => this.save(undefined, edit), {
      name: prompt ? t('prompts.copyName', { name: prompt.name }) : chat.label,
      question: chat.question,
      scope: chat.scope,
      category: prompt?.category ?? '',
      description: prompt?.description ?? '',
      favorite: false
    }).open()
  }

  private async save(prompt: PromptNote | undefined, edit: PromptEdit): Promise<void> {
    if (prompt) await updatePrompt(this.app, prompt.path, edit.name, edit.draft)
    else {
      await createPrompt(this.app, this.plugin.settings.chat.promptsFolder.trim(), edit.name, edit.draft)
      new Notice(t('prompts.created', { name: edit.name }))
    }
    this.reloadSoon()
  }

  private async remove(prompt: PromptNote): Promise<void> {
    if (!(await confirmDialog(this.app, t('prompts.deleteConfirm', { name: prompt.name })))) return
    const file = this.app.vault.getAbstractFileByPath(prompt.path)
    if (file instanceof TFile) await this.app.fileManager.trashFile(file)
  }

  /** The questions of the settings' list, each made a prompt of the library, but those already in it. */
  private async importSettings(): Promise<void> {
    const known = new Set(this.prompts.map((prompt) => fold(prompt.question).replace(/\s+/g, ' ')))
    const fresh = parsePrompts(this.plugin.settings.chat.prompts).filter(
      (prompt) => !known.has(fold(prompt.question).replace(/\s+/g, ' '))
    )
    if (!fresh.length) {
      new Notice(t('prompts.importNone'))
      return
    }
    const folder = this.plugin.settings.chat.promptsFolder.trim()
    for (const prompt of fresh) {
      const name = prompt.label.length > 60 ? `${prompt.label.slice(0, 59)}…` : prompt.label
      await createPrompt(this.app, folder, name, {
        scope: prompt.scope,
        scopeWord: scopeWord(prompt.scope),
        category: t('prompts.importedCategory'),
        description: '',
        favorite: false,
        question: prompt.question
      })
    }
    new Notice(t('prompts.imported', { count: fresh.length }))
    this.reloadSoon()
  }
}
