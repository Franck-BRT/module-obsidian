import { ItemView, Notice, setIcon, TFile, type WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../../main'
import type { HistoryEntry, HistoryKind } from '../../store/chat/chatHistory'
import { undoChange } from '../../store/chat/applyChange'
import { restoreRewrite } from '../../store/chat/noteProposal'
import { formatDate } from '../../dates'
import { EmptyState } from '../../ui/primitives/EmptyState'
import { safeAsync } from '../../utils'
import { reportUndone } from './changeCard'
import { t } from '../../i18n'

export const PM_CHAT_HISTORY_VIEW_TYPE = 'pm-chat-history'

/** Stands for the changes that touched no project — notes, mostly — in the filter. */
const NO_PROJECT = ':none'

function kindIcon(kind: HistoryKind): string {
  switch (kind) {
    case 'ticket':
      return 'square-pen'
    case 'create':
      return 'square-plus'
    case 'delete':
      return 'trash-2'
    case 'note':
      return 'file-plus'
    case 'append':
      return 'file-pen-line'
    case 'rewrite':
      return 'replace'
  }
}

function kindLabel(kind: HistoryKind): string {
  switch (kind) {
    case 'ticket':
      return t('history.kind.ticket')
    case 'create':
      return t('history.kind.create')
    case 'delete':
      return t('history.kind.delete')
    case 'note':
      return t('history.kind.note')
    case 'append':
      return t('history.kind.append')
    case 'rewrite':
      return t('history.kind.rewrite')
  }
}

/** A moment as the reader's day, YYYY-MM-DD, and hour, HH:MM. */
function localParts(iso: string): { day: string; time: string } {
  const at = new Date(iso)
  const two = (value: number): string => String(value).padStart(2, '0')
  return {
    day: `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`,
    time: `${two(at.getHours())}:${two(at.getMinutes())}`
  }
}

/**
 * What the chat changed, kept: every proposal applied, the latest first, by day — what it
 * did, why, from which conversation —, narrowed to a project, and taken back from here
 * while it still can be.
 */
export class ChatHistoryView extends ItemView {
  private project = ''
  private showUndone = true

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
  }

  getViewType(): string {
    return PM_CHAT_HISTORY_VIEW_TYPE
  }

  getIcon(): string {
    return 'clipboard-list'
  }

  getDisplayText(): string {
    return t('history.title')
  }

  async onOpen(): Promise<void> {
    this.register(this.plugin.chatHistory.onChange(() => this.render()))
    await this.plugin.chatHistory.ready()
    await this.plugin.chatUndo.ready()
    await this.plugin.noteUndo.ready()
    this.render()
  }

  private projectTitle(path: string): string {
    return this.plugin.index.projectRef(path)?.title ?? path.replace(/^.*\//, '').replace(/\.md$/, '')
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    root.addClass('pm-history')
    root.createEl('h2', { cls: 'pm-history-title', text: t('history.title') })
    const all = this.plugin.chatHistory.list()

    const bar = root.createDiv('pm-history-bar')
    const select = bar.createEl('select', { cls: 'dropdown' })
    select.createEl('option', { value: '', text: t('history.allProjects') })
    const projects = [...new Set(all.flatMap((entry) => entry.projects))]
      .map((path) => ({ path, title: this.projectTitle(path) }))
      .sort((a, b) => a.title.localeCompare(b.title))
    for (const one of projects) select.createEl('option', { value: one.path, text: one.title })
    if (all.some((entry) => !entry.projects.length)) {
      select.createEl('option', { value: NO_PROJECT, text: t('history.noProject') })
    }
    select.value = this.project
    select.addEventListener('change', () => {
      this.project = select.value
      this.render()
    })
    const toggle = bar.createEl('label', { cls: 'pm-history-toggle' })
    const box = toggle.createEl('input', { attr: { type: 'checkbox' } })
    box.checked = this.showUndone
    toggle.appendText(t('history.showUndone'))
    box.addEventListener('change', () => {
      this.showUndone = box.checked
      this.render()
    })

    const shown = all.filter(
      (entry) =>
        (this.showUndone || !entry.undone) &&
        (!this.project ||
          (this.project === NO_PROJECT ? !entry.projects.length : entry.projects.includes(this.project)))
    )
    if (!shown.length) {
      new EmptyState(root.createDiv())
        .setIcon('🕘')
        .setTitle(all.length ? t('history.noneHere') : t('history.none'))
        .setBody(t('history.noneDesc'))
      return
    }
    let day = ''
    let list: HTMLElement | null = null
    for (const entry of shown) {
      const parts = localParts(entry.at)
      if (parts.day !== day || !list) {
        day = parts.day
        root.createEl('h3', { cls: 'pm-history-day', text: formatDate(day) })
        list = root.createDiv('pm-history-list')
      }
      this.renderEntry(list, entry, parts.time)
    }
  }

  private renderEntry(list: HTMLElement, entry: HistoryEntry, time: string): void {
    const row = list.createDiv(`pm-history-entry${entry.undone ? ' is-undone' : ''}`)
    const head = row.createDiv('pm-history-head')
    head.createSpan({ cls: 'pm-history-time', text: time })
    setIcon(head.createSpan({ cls: 'pm-history-icon' }), kindIcon(entry.kind))
    head.createSpan({ cls: 'pm-history-kind', text: kindLabel(entry.kind) })
    const path = entry.path || (entry.ticket ? (this.plugin.index.task(entry.ticket)?.path ?? '') : '')
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null
    if (file instanceof TFile) {
      const link = head.createEl('a', { cls: 'pm-history-label', href: '#', text: entry.label })
      link.addEventListener('click', (event) => {
        event.preventDefault()
        void this.app.workspace.getLeaf('tab').openFile(file)
      })
    } else head.createSpan({ cls: 'pm-history-label', text: entry.label })
    if (entry.projects.length) {
      head.createSpan({
        cls: 'pm-history-projects',
        text: entry.projects.map((path) => this.projectTitle(path)).join(', ')
      })
    }
    if (entry.lines.length) {
      const lines = row.createEl('ul', { cls: 'pm-history-lines' })
      for (const line of entry.lines) lines.createEl('li', { text: line })
    }
    if (entry.why) row.createDiv({ cls: 'pm-history-why', text: entry.why })

    const foot = row.createDiv('pm-history-foot')
    const chat = entry.chat ? this.app.vault.getAbstractFileByPath(entry.chat) : null
    if (chat instanceof TFile) {
      const link = foot.createEl('a', { cls: 'pm-history-chat', href: '#', text: t('history.conversation') })
      link.addEventListener('click', (event) => {
        event.preventDefault()
        void this.app.workspace.getLeaf('tab').openFile(chat)
      })
    }
    if (entry.undone) {
      const undone = localParts(entry.undone)
      foot.createSpan({
        cls: 'pm-history-undone',
        text: t('history.undoneOn', { date: formatDate(undone.day), time: undone.time })
      })
      return
    }
    if (!this.undoable(entry)) return
    const button = foot.createEl('button', { text: t('chat.change.undo') })
    button.addEventListener(
      'click',
      safeAsync(async () => {
        button.disabled = true
        await this.undo(entry)
      })
    )
  }

  /** Whether what it did can still be taken back: its undo record is still kept. */
  private undoable(entry: HistoryEntry): boolean {
    if (!entry.key) return false
    if (entry.kind === 'rewrite') return this.plugin.noteUndo.getByKey(entry.key) !== null
    return this.plugin.chatUndo.getByKey(entry.key) !== null
  }

  private async undo(entry: HistoryEntry): Promise<void> {
    if (entry.kind === 'rewrite') {
      const kept = this.plugin.noteUndo.getByKey(entry.key)
      if (!kept) return
      const restored = await restoreRewrite(this.app, kept)
      if (restored) {
        await this.plugin.noteUndo.deleteByKey(entry.key)
        await this.plugin.chatHistory.markUndone(entry.key)
      }
      new Notice(restored ? t('chat.note.restored', { name: entry.label }) : t('chat.note.changedSince'))
      return
    }
    const record = this.plugin.chatUndo.getByKey(entry.key)
    if (!record) return
    const undone = await undoChange(this.plugin.store, record)
    await this.plugin.chatUndo.deleteByKey(entry.key)
    await this.plugin.chatHistory.markUndone(entry.key)
    reportUndone(undone, record.label)
  }
}
