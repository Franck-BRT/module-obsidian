import { Modal, normalizePath, Notice, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { ChangeDecision, ChangeRoundNumber, Task } from '../../types'
import type { ProjectScope } from '../../store'
import {
  boardAgenda,
  boardNote,
  CHANGE_DECISIONS,
  CHANGE_ROUNDS,
  changeOf,
  changeOwner,
  recordDecision,
  statusForChange,
  type BoardLine
} from '../../store/change'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { today } from '../../dates'
import { displayName, safeAsync } from '../../utils'
import { t } from '../../i18n'
import { boardWords, classLabel, decisionLabel, roundHint, roundLabel } from './changeLabels'

/**
 * A sitting of the local change board (CLM): every change waiting for a round, round 0
 * first — the requests —, then 1 — the proposals —, then 2 — what was carried out —; for
 * each, what the board decides and why. Saved, the decisions go on the changes, and the
 * sitting is kept as a note — its agenda and its decisions — in the project's CLM folder.
 */
export class BoardModal extends Modal {
  private date = today().toString()
  private lines: BoardLine[]

  constructor(
    private plugin: PMPlugin,
    private projects: ProjectScope,
    changes: Task[],
    private onDone: () => Promise<void>
  ) {
    super(plugin.app)
    const agenda = boardAgenda(changes)
    this.lines = CHANGE_ROUNDS.flatMap((round) =>
      agenda[round].map((task): BoardLine => ({ task, round, decision: null, comment: '' }))
    )
  }

  onOpen(): void {
    this.modalEl.addClass('pm-board-modal')
    this.setTitle(t('change.board.title'))
    const root = this.contentEl
    root.createDiv({ cls: 'pm-board-intro', text: t('change.board.intro') })
    const when = root.createDiv('pm-board-date')
    when.createSpan({ text: t('change.board.date') })
    const date = when.createEl('input', { attr: { type: 'date' } })
    date.value = this.date
    date.addEventListener('change', () => (this.date = date.value || today().toString()))
    for (const round of CHANGE_ROUNDS) this.renderRound(root, round)
    const foot = root.createDiv('pm-board-foot')
    foot.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close())
    const agenda = foot.createEl('button', { text: t('change.board.agendaOnly') })
    agenda.addEventListener(
      'click',
      safeAsync(() => this.save(false))
    )
    const save = foot.createEl('button', { cls: 'mod-cta', text: t('change.board.save') })
    save.addEventListener(
      'click',
      safeAsync(async () => {
        save.disabled = true
        try {
          await this.save(true)
        } finally {
          save.disabled = false
        }
      })
    )
  }

  private renderRound(root: HTMLElement, round: ChangeRoundNumber): void {
    const lines = this.lines.filter((line) => line.round === round)
    const section = root.createDiv('pm-board-round')
    const head = section.createDiv('pm-board-round-head')
    head.createSpan({ cls: 'pm-board-round-title', text: roundLabel(round) })
    head.createSpan({ cls: 'pm-board-round-count', text: String(lines.length) })
    section.createDiv({ cls: 'pm-board-round-hint', text: roundHint(round) })
    if (!lines.length) {
      section.createDiv({ cls: 'pm-board-none', text: t('change.board.noneAtRound') })
      return
    }
    for (const line of lines) {
      const change = changeOf(line.task)
      const row = section.createDiv('pm-board-line')
      const what = row.createDiv('pm-board-what')
      what.createSpan({ cls: 'pm-board-number', text: change.number || '—' })
      what.createSpan({ cls: 'pm-board-subject', text: line.task.title })
      const who = [classLabel(change.class), displayName(change.origin), changeOwner(line.task)].filter(Boolean)
      what.createDiv({ cls: 'pm-board-meta', text: who.join(' · ') })
      const decide = row.createDiv('pm-board-decide')
      const select = decide.createEl('select', { cls: 'dropdown' })
      select.createEl('option', { value: '', text: t('change.board.notExamined') })
      for (const one of CHANGE_DECISIONS) select.createEl('option', { value: one, text: decisionLabel(one) })
      select.addEventListener('change', () => {
        line.decision = (select.value || null) as ChangeDecision | null
        row.toggleClass('is-decided', !!line.decision)
      })
      const comment = decide.createEl('input', {
        attr: { type: 'text', placeholder: t('change.commentPlaceholder') }
      })
      comment.addEventListener('input', () => (line.comment = comment.value))
    }
  }

  /** The sitting kept as a note — and, when its decisions are taken, they go on the changes. */
  private async save(withDecisions: boolean): Promise<void> {
    const decided = withDecisions ? this.lines.filter((line) => line.decision) : []
    if (withDecisions && !decided.length) {
      new Notice(t('change.board.nothingDecided'))
      return
    }
    for (const line of decided) {
      const project = this.projects.projectOf(line.task.id)
      if (!project || !line.decision) continue
      const change = recordDecision(changeOf(line.task), line.round, line.decision, this.date, line.comment)
      const patch: Partial<Task> = { change }
      const status = statusForChange(change, line.task.status, this.plugin.store.configFor(project).statuses)
      if (status) patch.status = status
      await this.plugin.store.updateTask(project, line.task.id, patch)
    }
    const lines = withDecisions ? this.lines : this.lines.map((line) => ({ ...line, decision: null, comment: '' }))
    const note = await this.writeNote(lines)
    this.close()
    new Notice(
      withDecisions
        ? t('change.board.saved', { count: decided.length, path: note?.path ?? '' })
        : t('change.board.agendaWritten', { path: note?.path ?? '' })
    )
    await this.onDone()
    if (note) await this.app.workspace.getLeaf('tab').openFile(note)
  }

  private async writeNote(lines: BoardLine[]): Promise<TFile | null> {
    const project = this.projects.primary ?? this.projects.addableProjects[0]
    if (!project) return null
    const root = folderOf(project.filePath)
    const folder = normalizePath(root ? `${root}/${t('change.board.folder')}` : t('change.board.folder'))
    await ensureFolder(this.app, folder)
    const base = `${t('change.board.fileName')} ${this.date}`
    let path = normalizePath(`${folder}/${base}.md`)
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} (${n}).md`)
    return this.app.vault.create(path, boardNote(this.date, lines, boardWords()))
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
