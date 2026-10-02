import { MarkdownRenderChild, MarkdownRenderer, Notice, setIcon, TFile, TFolder } from 'obsidian'
import type PMPlugin from '../../main'
import {
  appendProposal,
  appendTarget,
  appendToSection,
  findSection,
  sectionFor,
  holdsKept,
  holdsProposal,
  noteAtTitle,
  noteNamed,
  replaceSection,
  sectionText,
  sectionTitles,
  safeFolder,
  withFolder,
  NOTE_LANGUAGE,
  parseNoteProposal,
  proposalFolder,
  writeProposedNote,
  writtenNote,
  type NoteProposal
} from '../../store/chat/noteProposal'
import { cleanTranscriptIn } from '../../store/chat/ocr'
import { diffWords } from '../../store/requirements/reqDiff'
import { safeAsync } from '../../utils'
import { replaceBlock } from '../../store/chat/chatChange'
import { undoKey } from '../../store/chat/chatUndo'
import type { HistoryKind } from '../../store/chat/chatHistory'
import { FolderPicker, type FolderChoice } from '../folderUi'
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
  /** The block as the reply wrote it, whatever the reader changed of it since. */
  private original: string

  constructor(
    private plugin: PMPlugin,
    private source: string,
    container: HTMLElement,
    private sourcePath: string
  ) {
    super(container)
    this.original = source
    // Changed by the reader already — its folder chosen —, here or where the same card is drawn.
    this.source = plugin.changeEdits.get(source.trim()) ?? source
  }

  /**
   * The block as the reader changed it, kept: in the conversation's note, so the card reads
   * so after a restart, and here, for the other place it is drawn.
   */
  private async keepSource(source: string): Promise<void> {
    const before = this.source
    const edits = this.plugin.changeEdits
    for (const [key, value] of edits) if (value === before) edits.set(key, source)
    edits.set(this.original.trim(), source)
    edits.set(before.trim(), source)
    this.source = source
    const file = this.sourcePath ? this.plugin.app.vault.getAbstractFileByPath(this.sourcePath) : null
    if (file instanceof TFile) {
      await this.plugin.app.vault.process(file, (content) => replaceBlock(content, before, source) ?? content)
    }
  }

  /** What was written, kept in the chat's history: the note, how, and from which conversation. */
  private async log(kind: HistoryKind, file: TFile, lines: string[], key = ''): Promise<void> {
    await this.plugin.chatHistory.add({
      kind,
      label: file.basename,
      lines,
      why: '',
      chat: this.sourcePath,
      projects: [],
      path: file.path,
      key
    })
  }

  /** Where a note was written, as the history says it. */
  private folderLine(file: TFile): string {
    const folder = file.parent && file.parent.path !== '/' ? file.parent.path : t('chat.note.vaultRoot')
    return t('history.inFolder', { folder })
  }

  /** Every folder of the vault but the hidden ones, in order: where a note may go. */
  private vaultFolders(): string[] {
    return this.plugin.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !!file.path && file.path !== '/')
      .map((folder) => folder.path)
      .filter((path) => !path.split('/').some((part) => part.startsWith('.')))
      .sort((a, b) => a.localeCompare(b))
  }

  /** Another folder for the note, picked or named — a new name is made when the note is. */
  private chooseFolder(): void {
    new FolderPicker(
      this.plugin.app,
      this.vaultFolders(),
      t('chat.note.vaultRoot'),
      safeAsync(async (choice: FolderChoice) => {
        const folder = choice.kind === 'new' ? safeFolder(choice.name) : choice.path
        if (choice.kind === 'new' && !folder) return
        await this.keepSource(withFolder(this.source, folder || '/'))
        await this.draw()
      }),
      t('chat.note.folderPlaceholder')
    ).open()
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
    if (proposal.clean) {
      await this.drawClean(proposal.clean, generation)
      return
    }
    if (proposal.replace) {
      await this.drawReplace(proposal, generation)
      return
    }
    const fallback = notesFallback(this.plugin, this.sourcePath)
    const target = proposal.append ? appendTarget(this.plugin.app, proposal, this.sourcePath) : null
    const content = target ? await this.plugin.app.vault.cachedRead(target) : ''
    // Where in the note: the section named, or the one the text is plainly about — a
    // deepening of « Bétons » goes under « Bétons », not after the note's last line.
    const named = proposal.append && proposal.section.trim() ? proposal.section.trim() : ''
    const guessed = proposal.append && !named && target ? sectionFor(content, proposal.body) : null
    const section = named || guessed || ''
    const done = proposal.append
      ? target !== null && holdsProposal(content, proposal)
      : await writtenNote(this.plugin.app, proposal, fallback)
    if (generation !== this.generation) return
    // A note of that name there already, saying something else — or rewritten from here —:
    // what is proposed is most likely that note again, deepened, which a second note of the
    // same name would only stand beside. It is offered as the note rewritten, with the way
    // to make another note all the same.
    const existing = proposal.append ? null : noteAtTitle(this.plugin.app, proposal, fallback)
    if (existing) {
      await this.plugin.noteUndo.ready()
      if (generation !== this.generation) return
      const rewritten = this.plugin.noteUndo.get(this.source)?.path === existing.path
      if (rewritten || !done) {
        await this.drawReplace({ ...proposal, replace: existing.path, section: '' }, generation, proposal)
        return
      }
    }

    this.containerEl.empty()
    const card = this.containerEl.createDiv('pm-change pm-note')
    if (proposal.append) {
      const where = named ? ` › ${named}` : ''
      this.head(card, 'file-pen-line', t('chat.note.appendKind'), `${target?.basename ?? proposal.append}${where}`)
      if (named && target && !done && !findSection(content, named)) {
        card.addClass('pm-change--problem')
        const foot = card.createDiv('pm-change-foot')
        setIcon(foot.createSpan({ cls: 'pm-change-state-icon' }), 'circle-alert')
        foot.createSpan({
          cls: 'pm-change-problem',
          text: t('chat.note.noSection', { section: named, list: sectionTitles(content).join(', ') || '—' })
        })
        return
      }
    } else {
      this.head(card, 'file-plus', t('chat.note.newKind'), proposal.title)
      const folder = proposalFolder(proposal, fallback)
      const tags = proposal.tags.map((tag) => `#${tag}`).join(' ')
      if (done) {
        card.createDiv({
          cls: 'pm-note-where',
          text: [folder ? t('chat.note.in', { folder }) : t('chat.note.atRoot'), tags].filter(Boolean).join(' · ')
        })
      } else {
        // Where it goes, the reader's to choose before it is written: a field, as on a ticket's card.
        const row = card.createDiv('pm-note-folder-row')
        row.createSpan({ cls: 'pm-note-folder-label', text: t('chat.note.folderLabel') })
        const pick = row.createEl('button', {
          cls: 'dropdown pm-note-folder-pick',
          text: folder || t('chat.note.vaultRoot'),
          attr: { 'aria-label': t('chat.note.chooseFolder') }
        })
        pick.addEventListener('click', () => this.chooseFolder())
        // A folder the model named that is not there yet: made with the note, said beforehand.
        if (folder && !(this.plugin.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
          row.createSpan({ cls: 'pm-note-folder-new', text: t('chat.note.newFolder') })
        }
        if (tags) card.createDiv({ cls: 'pm-note-where', text: tags })
      }
    }
    await this.preview(card, proposal)
    this.footer(card, proposal, target, done, section ? { section, guessed: !named } : null)
  }

  /**
   * A transcription to clean of what its printed pages repeat: the lines found, each with
   * how often it went, and the button that takes them out — of the whole note, however
   * much of it the model was shown.
   */
  private async drawClean(name: string, generation: number): Promise<void> {
    const target = noteNamed(this.plugin.app, name, this.sourcePath)
    const cleaned = target ? cleanTranscriptIn(await this.plugin.app.vault.cachedRead(target)) : null
    if (generation !== this.generation) return
    this.containerEl.empty()
    const card = this.containerEl.createDiv('pm-change pm-note')
    this.head(card, 'eraser', t('chat.note.cleanKind'), target?.basename ?? name)
    const foot = (): HTMLElement => card.createDiv('pm-change-foot')
    const problem = (text: string): void => {
      card.addClass('pm-change--problem')
      const el = foot()
      setIcon(el.createSpan({ cls: 'pm-change-state-icon' }), 'circle-alert')
      el.createSpan({ cls: 'pm-change-problem', text })
    }
    if (!target) {
      problem(t('chat.note.noTarget', { name }))
      return
    }
    if (!cleaned) {
      problem(t('chat.note.noTranscript', { name: target.basename }))
      return
    }
    if (!cleaned.removed.length) {
      card.addClass('pm-change--done')
      const el = foot()
      setIcon(el.createSpan({ cls: 'pm-change-state-icon' }), 'check')
      el.createSpan({ cls: 'pm-change-state', text: t('chat.note.cleanNone') })
      const open = el.createEl('a', { cls: 'pm-note-open', href: '#', text: t('chat.note.open') })
      open.addEventListener('click', (event) => {
        event.preventDefault()
        void this.plugin.app.workspace.getLeaf('tab').openFile(target)
      })
      return
    }
    const count = cleaned.removed.reduce((sum, one) => sum + one.count, 0)
    card.createDiv({ cls: 'pm-note-where', text: t('chat.note.cleanFound', { count }) })
    const list = card.createEl('ul', { cls: 'pm-note-clean-list' })
    for (const one of cleaned.removed.slice(0, 8)) {
      const item = list.createEl('li')
      item.createSpan({ text: one.line.length > 110 ? `${one.line.slice(0, 110)}…` : one.line })
      item.createSpan({ cls: 'pm-note-clean-count', text: ` ×${one.count}` })
    }
    if (cleaned.removed.length > 8) {
      list.createEl('li', { text: t('library.andMore', { count: cleaned.removed.length - 8 }) })
    }
    const el = foot()
    const button = el.createEl('button', { cls: 'mod-cta', text: t('chat.note.clean') })
    button.addEventListener(
      'click',
      safeAsync(async () => {
        button.disabled = true
        try {
          await this.plugin.app.vault.process(target, (content) => cleanTranscriptIn(content)?.content ?? content)
          new Notice(t('chat.note.cleaned', { count, name: target.basename }))
        } finally {
          await this.draw()
        }
      })
    )
  }

  /**
   * A section of a note to rewrite: its text now and as proposed, the words that change
   * marked, and a button that rewrites it — then the way to take it back, while the
   * section still reads as it was written.
   */
  private async drawReplace(proposal: NoteProposal, generation: number, asNew?: NoteProposal): Promise<void> {
    const app = this.plugin.app
    const target = noteNamed(app, proposal.replace, this.sourcePath)
    const content = target ? await app.vault.cachedRead(target) : ''
    await this.plugin.noteUndo.ready()
    if (generation !== this.generation) return
    this.containerEl.empty()
    const card = this.containerEl.createDiv('pm-change pm-note')
    const where = proposal.section.trim() ? ` › ${proposal.section.trim()}` : ''
    this.head(
      card,
      'replace',
      asNew ? t('chat.note.rewriteKind') : t('chat.note.replaceKind'),
      `${target?.basename ?? proposal.replace}${where}`
    )
    if (asNew && target) {
      const where = card.createDiv({ cls: 'pm-note-where', text: t('chat.note.exists', { path: target.path }) })
      // Meant as another note after all: written elsewhere, under its own name.
      const change = where.createEl('a', { cls: 'pm-note-folder', href: '#', text: t('chat.note.otherFolder') })
      change.addEventListener('click', (event) => {
        event.preventDefault()
        this.chooseFolder()
      })
    }
    const problem = (text: string): void => {
      card.addClass('pm-change--problem')
      const foot = card.createDiv('pm-change-foot')
      setIcon(foot.createSpan({ cls: 'pm-change-state-icon' }), 'circle-alert')
      foot.createSpan({ cls: 'pm-change-problem', text })
    }
    if (!target) {
      problem(t('chat.note.noTarget', { name: proposal.replace }))
      return
    }
    const current = sectionText(content, proposal.section)
    if (current === null) {
      problem(
        t('chat.note.noSection', {
          section: proposal.section,
          list: sectionTitles(content).join(', ') || '—'
        })
      )
      return
    }
    if (holdsKept(current)) {
      problem(t('chat.note.keptSection'))
      return
    }
    const proposed = proposal.body.trim()
    const same = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()
    const done = same(current, proposed)
    // What changes, marked: removed struck, added underlined.
    const diff = card.createDiv('pm-change-diff pm-req-diff pm-note-replace-diff')
    if (done) diff.createSpan({ text: proposed || t('chat.note.emptySection') })
    else {
      for (const part of diffWords(current, proposed)) {
        if (part.kind === 'same') diff.createSpan({ text: part.text })
        else diff.createSpan({ cls: `pm-req-diff-${part.kind}`, text: part.text })
      }
    }
    const foot = card.createDiv('pm-change-foot')
    const key = this.source
    const undo = this.plugin.noteUndo.get(key)
    if (done) {
      card.addClass('pm-change--done')
      setIcon(foot.createSpan({ cls: 'pm-change-state-icon' }), 'check')
      foot.createSpan({ cls: 'pm-change-state', text: t('chat.note.replaced') })
      const open = foot.createEl('a', { cls: 'pm-note-open', href: '#', text: t('chat.note.open') })
      open.addEventListener('click', (event) => {
        event.preventDefault()
        void app.workspace.getLeaf('tab').openFile(target)
      })
      if (undo && undo.path === target.path) {
        const back = foot.createEl('button', { text: t('chat.change.undo') })
        back.addEventListener(
          'click',
          safeAsync(async () => {
            back.disabled = true
            let restored = false
            await app.vault.process(target, (text) => {
              // Only over what was written: a section changed since is the reader's.
              const now = sectionText(text, undo.section)
              if (now === null || !same(now, undo.after)) return text
              const back = replaceSection(text, undo.section, undo.before)
              restored = back !== null
              return back ?? text
            })
            if (restored) {
              await this.plugin.noteUndo.delete(key)
              await this.plugin.chatHistory.markUndone(undoKey(key))
            }
            new Notice(restored ? t('chat.note.restored', { name: target.basename }) : t('chat.note.changedSince'))
            await this.draw()
          })
        )
      }
      return
    }
    const button = foot.createEl('button', {
      cls: 'mod-cta',
      text: asNew ? t('chat.note.rewrite') : t('chat.note.replace')
    })
    button.addEventListener(
      'click',
      safeAsync(async () => {
        button.disabled = true
        let written = false
        let before = ''
        await app.vault.process(target, (text) => {
          const now = sectionText(text, proposal.section)
          if (now === null) return text
          const next = replaceSection(text, proposal.section, proposed)
          if (next === null) return text
          before = now
          written = true
          return next
        })
        if (written) {
          await this.plugin.noteUndo.set(key, { path: target.path, section: proposal.section, before, after: proposed })
          await this.log(
            'rewrite',
            target,
            [proposal.section ? t('history.inSection', { section: proposal.section }) : t('history.wholeNote')],
            undoKey(key)
          )
          new Notice(t('chat.note.replacedIn', { name: target.basename }))
        }
        await this.draw()
      })
    )
    // Another note after all, beside the one of that name: what the card offered before.
    if (asNew) {
      const another = foot.createEl('button', { text: t('chat.note.createAnother') })
      another.addEventListener(
        'click',
        safeAsync(async () => {
          another.disabled = true
          try {
            const file = await writeProposedNote(
              app,
              asNew,
              notesFallback(this.plugin, this.sourcePath),
              this.sourcePath
            )
            await this.log('note', file, [this.folderLine(file)])
            new Notice(t('chat.note.createdAt', { path: file.path }))
          } finally {
            await this.draw()
          }
        })
      )
    }
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

  private footer(
    card: HTMLElement,
    proposal: NoteProposal,
    target: TFile | null,
    done: TFile | boolean | null,
    into: { section: string; guessed: boolean } | null = null
  ): void {
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
    // Into its section, the text written under that section's heading.
    if (into && target) {
      const inside = foot.createEl('button', {
        cls: 'mod-cta',
        text: into.guessed ? t('chat.note.appendIn', { section: into.section }) : t('chat.note.append')
      })
      inside.addEventListener(
        'click',
        safeAsync(async () => {
          inside.disabled = true
          let written = false
          try {
            await this.plugin.app.vault.process(target, (text) => {
              const next = appendToSection(text, into.section, proposal.body)
              written = next !== null
              return next ?? text
            })
            if (written) await this.log('append', target, [t('history.inSection', { section: into.section })])
            else new Notice(t('chat.note.noSection', { section: into.section, list: '—' }))
          } finally {
            await this.draw()
          }
        })
      )
    }
    // At the note's end, as the model asked — beside the section guessed, the second choice.
    if (into && !into.guessed) {
      this.copyButton(foot, proposal)
      return
    }
    const button = foot.createEl('button', {
      cls: into ? '' : 'mod-cta',
      text: into ? t('chat.note.appendAtEnd') : proposal.append ? t('chat.note.append') : t('chat.note.create')
    })
    button.addEventListener(
      'click',
      safeAsync(async () => {
        button.disabled = true
        try {
          if (proposal.append && target) {
            await appendProposal(this.plugin.app, target, proposal)
            await this.log('append', target, [])
          } else {
            const file = await writeProposedNote(
              this.plugin.app,
              proposal,
              notesFallback(this.plugin, this.sourcePath),
              this.sourcePath
            )
            await this.log('note', file, [this.folderLine(file)])
            new Notice(t('chat.note.createdAt', { path: file.path }))
          }
        } catch (error) {
          new Notice(t('chat.change.failed', { reason: error instanceof Error ? error.message : String(error) }))
        } finally {
          await this.draw()
        }
      })
    )
    this.copyButton(foot, proposal)
  }

  private copyButton(foot: HTMLElement, proposal: NoteProposal): void {
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
