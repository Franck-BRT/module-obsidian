import { Modal, normalizePath, Notice, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { ChangeDecision, ChangeGroup, ChangeRoundNumber, Task } from '../../types'
import type { ProjectScope } from '../../store'
import {
  boardAgenda,
  boardDocument,
  boardNote,
  CHANGE_DECISIONS,
  CHANGE_GROUPS,
  CHANGE_ROUNDS,
  changeOf,
  changeOwner,
  recordDecision,
  statusForChange,
  type BoardLine
} from '../../store/change'
import { buildDocx } from '../../store/docx'
import { buildPdf } from '../../store/pdf'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { today } from '../../dates'
import { displayName, safeAsync, sanitizeFileName } from '../../utils'
import { t } from '../../i18n'
import { boardWords, classLabel, decisionLabel, groupLabel, roundHint, roundLabel } from './changeLabels'

/**
 * A sitting of the local change board (CLM): every change waiting for a round, round 0
 * first — the requests —, then 1 — the proposals —, then 2 — what was carried out —; for
 * each, what the board decides and why. A sitting may take one group of changes only.
 * Saved, the decisions go on the changes, and the sitting is kept in the project's CLM
 * folder — its agenda and its decisions — as a note, and as a record in Word and in PDF.
 */
export class BoardModal extends Modal {
  private date = today().toString()
  private lines: BoardLine[] = []

  constructor(
    private plugin: PMPlugin,
    private projects: ProjectScope,
    private changes: Task[],
    private onDone: () => Promise<void>,
    private group: ChangeGroup | null = null
  ) {
    super(plugin.app)
    this.buildLines()
  }

  /** The changes the sitting takes, by round; what was already entered for one kept when the group changes. */
  private buildLines(): void {
    const before = new Map(this.lines.map((line) => [`${line.task.id}:${line.round}`, line]))
    const agenda = boardAgenda(this.changes, this.group)
    this.lines = CHANGE_ROUNDS.flatMap((round) =>
      agenda[round].map(
        (task): BoardLine => before.get(`${task.id}:${round}`) ?? { task, round, decision: null, comment: '' }
      )
    )
  }

  onOpen(): void {
    this.modalEl.addClass('pm-board-modal')
    this.setTitle(t('change.board.title'))
    this.render()
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    root.createDiv({ cls: 'pm-board-intro', text: t('change.board.intro') })
    const when = root.createDiv('pm-board-date')
    when.createSpan({ text: t('change.board.date') })
    const date = when.createEl('input', { attr: { type: 'date' } })
    date.value = this.date
    date.addEventListener('change', () => (this.date = date.value || today().toString()))
    when.createSpan({ cls: 'pm-board-group-label', text: t('change.group') })
    const group = when.createEl('select', { cls: 'dropdown' })
    group.createEl('option', { value: '', text: t('change.board.allGroups') })
    for (const one of CHANGE_GROUPS) group.createEl('option', { value: String(one), text: groupLabel(one) })
    group.value = this.group ? String(this.group) : ''
    group.addEventListener('change', () => {
      this.group = group.value ? (Number(group.value) as ChangeGroup) : null
      this.buildLines()
      this.render()
    })
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
      const who = [
        classLabel(change.class),
        change.group ? groupLabel(change.group) : '',
        displayName(change.origin),
        changeOwner(line.task)
      ].filter(Boolean)
      what.createDiv({ cls: 'pm-board-meta', text: who.join(' · ') })
      const decide = row.createDiv('pm-board-decide')
      const select = decide.createEl('select', { cls: 'dropdown' })
      select.createEl('option', { value: '', text: t('change.board.notExamined') })
      for (const one of CHANGE_DECISIONS) select.createEl('option', { value: one, text: decisionLabel(one) })
      select.value = line.decision ?? ''
      row.toggleClass('is-decided', !!line.decision)
      select.addEventListener('change', () => {
        line.decision = (select.value || null) as ChangeDecision | null
        row.toggleClass('is-decided', !!line.decision)
      })
      const comment = decide.createEl('input', {
        attr: { type: 'text', placeholder: t('change.commentPlaceholder') }
      })
      comment.value = line.comment
      comment.addEventListener('input', () => (line.comment = comment.value))
    }
  }

  /** The sitting kept as a note and a record — and, when its decisions are taken, they go on the changes. */
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
    const record = await this.writeRecord(lines)
    this.close()
    const path = record?.path ?? ''
    new Notice(
      withDecisions
        ? t('change.board.saved', { count: decided.length, path })
        : t('change.board.agendaWritten', { path })
    )
    await this.onDone()
    if (record) await this.app.workspace.getLeaf('tab').openFile(record)
  }

  /**
   * The sitting written in the project's CLM folder under one name: the note, the Word
   * record to amend and the PDF to send. The PDF comes back — or the note, when the
   * record could not be made.
   */
  private async writeRecord(lines: BoardLine[]): Promise<TFile | null> {
    const project = this.projects.primary ?? this.projects.addableProjects[0]
    if (!project) return null
    const root = folderOf(project.filePath)
    const folder = normalizePath(root ? `${root}/${t('change.board.folder')}` : t('change.board.folder'))
    await ensureFolder(this.app, folder)
    const base = sanitizeFileName(
      [t('change.board.fileName'), this.date, this.group ? groupLabel(this.group) : ''].filter(Boolean).join(' ')
    )
    const taken = (name: string): boolean =>
      ['md', 'docx', 'pdf'].some(
        (ext) => !!this.app.vault.getAbstractFileByPath(normalizePath(`${folder}/${name}.${ext}`))
      )
    let name = base
    for (let n = 2; taken(name); n++) name = `${base} (${n})`
    const words = boardWords()
    const context = { project: project.title, group: this.group }
    const note = await this.app.vault.create(
      normalizePath(`${folder}/${name}.md`),
      boardNote(this.date, lines, words, context)
    )
    try {
      const document = boardDocument(this.date, lines, words, context)
      await this.app.vault.createBinary(normalizePath(`${folder}/${name}.docx`), buildDocx(document).slice().buffer)
      return await this.app.vault.createBinary(
        normalizePath(`${folder}/${name}.pdf`),
        buildPdf(document).slice().buffer
      )
    } catch (error) {
      console.error(error)
      new Notice(t('change.board.recordFailed'))
      return note
    }
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
