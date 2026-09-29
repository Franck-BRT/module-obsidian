import { MarkdownRenderChild, MarkdownRenderer, Notice, setIcon, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import {
  appendProposal,
  appendTarget,
  holdsProposal,
  NOTE_LANGUAGE,
  parseNoteProposal,
  proposalFolder,
  writeProposedNote,
  writtenNote,
  type NoteProposal
} from '../../store/chat/noteProposal'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

/**
 * A note the model proposed, drawn as a card: its title and folder — or the note it adds
 * to —, the note itself as it will read, and a button that writes it. Drawn the same in
 * the chat panel and in the conversation's note, and drawn again when the vault changes,
 * so a note written once says so wherever the card is read.
 */
export function registerNoteBlock(plugin: PMPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor(NOTE_LANGUAGE, (source, el, ctx) => {
    ctx.addChild(new NoteCard(plugin, source, el, ctx.sourcePath))
  })
}

/** Where a note naming no folder is written: the chat's own setting, or the notes library — the inbox. */
export function notesFallback(plugin: PMPlugin, _sourcePath: string): string {
  return plugin.settings.chat.notesFolder.trim() || plugin.notes.root
}

class NoteCard extends MarkdownRenderChild {
  private timer: number | null = null
  private generation = 0
  private open = false

  constructor(
    private plugin: PMPlugin,
    private source: string,
    container: HTMLElement,
    private sourcePath: string
  ) {
    super(container)
  }

  onload(): void {
    void this.draw()
    // A note written, from here or from the other place this card is drawn, says so.
    const later = (): void => {
      if (this.timer !== null) window.clearTimeout(this.timer)
      this.timer = window.setTimeout(() => {
        this.timer = null
        void this.draw()
      }, 300)
    }
    this.registerEvent(this.plugin.app.vault.on('create', later))
    this.registerEvent(
      this.plugin.app.vault.on('modify', (file) => {
        if (file.path !== this.sourcePath) later()
      })
    )
  }

  onunload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
  }

  private async draw(): Promise<void> {
    const generation = ++this.generation
    const proposal = parseNoteProposal(this.source)
    if (!proposal) {
      this.containerEl.empty()
      const card = this.containerEl.createDiv('pm-change pm-change--problem')
      this.head(card, 'circle-alert', t('chat.note.unreadable'), '')
      card.createEl('pre', { cls: 'pm-change-source', text: this.source.trim() })
      return
    }
    const fallback = notesFallback(this.plugin, this.sourcePath)
    const target = proposal.append ? appendTarget(this.plugin.app, proposal, this.sourcePath) : null
    const done = proposal.append
      ? target !== null && holdsProposal(await this.plugin.app.vault.cachedRead(target), proposal)
      : await writtenNote(this.plugin.app, proposal, fallback)
    if (generation !== this.generation) return

    this.containerEl.empty()
    const card = this.containerEl.createDiv('pm-change pm-note')
    if (proposal.append) {
      this.head(card, 'file-pen-line', t('chat.note.appendKind'), target?.basename ?? proposal.append)
    } else {
      this.head(card, 'file-plus', t('chat.note.newKind'), proposal.title)
      const folder = proposalFolder(proposal, fallback)
      card.createDiv({
        cls: 'pm-note-where',
        text: [
          folder ? t('chat.note.in', { folder }) : t('chat.note.atRoot'),
          proposal.tags.map((tag) => `#${tag}`).join(' ')
        ]
          .filter(Boolean)
          .join(' · ')
      })
    }
    await this.preview(card, proposal)
    this.footer(card, proposal, target, done)
  }

  private head(card: HTMLElement, icon: string, kind: string, name: string): void {
    const head = card.createDiv('pm-change-head')
    setIcon(head.createSpan({ cls: 'pm-change-icon' }), icon)
    head.createSpan({ cls: 'pm-change-kind', text: kind })
    if (name) head.createSpan({ cls: 'pm-change-target', text: name })
  }

  /** The note as it will read, folded to a few lines until opened — when it is longer than that. */
  private async preview(card: HTMLElement, proposal: NoteProposal): Promise<void> {
    const box = card.createDiv(`pm-note-preview${this.open ? ' is-open' : ''}`)
    await MarkdownRenderer.render(this.plugin.app, proposal.body, box, this.sourcePath, this)
    const toggle = card.createEl('a', {
      cls: 'pm-note-toggle',
      href: '#',
      text: this.open ? t('chat.note.less') : t('chat.note.more')
    })
    toggle.addEventListener('click', (event) => {
      event.preventDefault()
      this.open = !this.open
      box.toggleClass('is-open', this.open)
      toggle.setText(this.open ? t('chat.note.less') : t('chat.note.more'))
    })
    // Once laid out: a note short enough to be seen whole has nothing to unfold.
    window.requestAnimationFrame(() => {
      const short = !this.open && box.scrollHeight <= box.clientHeight + 2
      box.toggleClass('is-short', short)
      toggle.toggleClass('is-hidden', short)
    })
  }

  private footer(card: HTMLElement, proposal: NoteProposal, target: TFile | null, done: TFile | boolean | null): void {
    const foot = card.createDiv('pm-change-foot')
    const written = done instanceof TFile ? done : done === true ? target : null
    if (written) {
      card.addClass('pm-change--done')
      setIcon(foot.createSpan({ cls: 'pm-change-state-icon' }), 'check')
      foot.createSpan({
        cls: 'pm-change-state',
        text: proposal.append ? t('chat.note.appended') : t('chat.note.created')
      })
      const open = foot.createEl('a', { cls: 'pm-note-open', href: '#', text: t('chat.note.open') })
      open.addEventListener('click', (event) => {
        event.preventDefault()
        void this.plugin.app.workspace.getLeaf('tab').openFile(written)
      })
      return
    }
    if (proposal.append && !target) {
      card.addClass('pm-change--problem')
      setIcon(foot.createSpan({ cls: 'pm-change-state-icon' }), 'circle-alert')
      foot.createSpan({ cls: 'pm-change-problem', text: t('chat.note.noTarget', { name: proposal.append }) })
      return
    }
    const button = foot.createEl('button', {
      cls: 'mod-cta',
      text: proposal.append ? t('chat.note.append') : t('chat.note.create')
    })
    button.addEventListener(
      'click',
      safeAsync(async () => {
        button.disabled = true
        try {
          if (proposal.append && target) await appendProposal(this.plugin.app, target, proposal)
          else {
            const file = await writeProposedNote(
              this.plugin.app,
              proposal,
              notesFallback(this.plugin, this.sourcePath),
              this.sourcePath
            )
            new Notice(t('chat.note.createdAt', { path: file.path }))
          }
        } catch (error) {
          new Notice(t('chat.change.failed', { reason: error instanceof Error ? error.message : String(error) }))
        } finally {
          await this.draw()
        }
      })
    )
    const copy = foot.createEl('button', { text: t('chat.note.copy') })
    copy.addEventListener(
      'click',
      safeAsync(async () => {
        await navigator.clipboard.writeText(proposal.body)
        new Notice(t('chat.note.copied'))
      })
    )
  }
}
