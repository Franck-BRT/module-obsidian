import { Modal, Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project } from '../../types'
import { documentOf } from '../../store/Document'
import { findTaskById } from '../../store/TaskIndex'
import { flattenTasks } from '../../store/TaskTreeOps'
import { askedBy, awaitedDocuments, chaseGroups, chaseMail, recordChase, type ChaseGroup } from '../../store/chasing'
import { formatDate, today } from '../../dates'
import { safeAsync } from '../../utils'
import { chaseWords } from './chaseWords'
import { t } from '../../i18n'

/** How many days the reminder gives them, by default. */
const DEFAULT_DELAY = 7

interface ProjectGroup {
  project: Project
  group: ChaseGroup
}

/** The documents the projects still wait for past their date, gathered by who owes them. */
export function chaseList(projects: Project[], day: string): ProjectGroup[] {
  return projects
    .filter((project) => !project.program && !project.template)
    .flatMap((project) =>
      chaseGroups(
        awaitedDocuments(
          flattenTasks(project.tasks).map((flat) => flat.task),
          day
        )
      ).map((group) => ({ project, group }))
    )
}

/**
 * Opens the reminders for what the projects still wait for — or says there is nothing
 * to chase.
 */
export function openChase(plugin: PMPlugin, projects: Project[], onRefresh: () => Promise<void>): void {
  const list = chaseList(projects, today().toString())
  if (!list.length) {
    new Notice(t('view.awaitedNone'))
    return
  }
  new ChaseModal(plugin, projects, list, onRefresh).open()
}

/**
 * The reminders, one for each who owes documents: what is missing, since when, and how
 * often they were chased already, with the mail ready — to copy, to open in the mail
 * client, or to have the chat write in its own words. A reminder sent is noted on its
 * documents, so the next one knows it is the second.
 */
class ChaseModal extends Modal {
  private asked: string
  private note = true

  constructor(
    private plugin: PMPlugin,
    private projects: Project[],
    private list: ProjectGroup[],
    private onRefresh: () => Promise<void>
  ) {
    super(plugin.app)
    this.asked = askedBy(today().toString(), DEFAULT_DELAY)
  }

  onOpen(): void {
    this.modalEl.addClass('pm-chase-modal')
    this.setTitle(t('chase.title'))
    this.render()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    const count = this.list.reduce((sum, one) => sum + one.group.items.length, 0)
    root.createDiv({ cls: 'pm-chase-intro', text: t('chase.intro', { count }) })

    const options = root.createDiv('pm-chase-options')
    const date = options.createEl('label', { cls: 'pm-chase-option' })
    date.createSpan({ text: t('chase.askedBy') })
    const input = date.createEl('input', { attr: { type: 'date' } })
    input.value = this.asked
    input.addEventListener('change', () => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(input.value)) this.asked = input.value
      this.render()
    })
    const note = options.createEl('label', { cls: 'pm-chase-option' })
    const box = note.createEl('input', { attr: { type: 'checkbox' } })
    box.checked = this.note
    box.addEventListener('change', () => {
      this.note = box.checked
    })
    note.createSpan({ text: t('chase.noteOnSend') })

    const several = new Set(this.list.map((one) => one.project.filePath)).size > 1
    for (const one of this.list) this.renderGroup(root.createDiv('pm-chase-group'), one, several)

    const foot = root.createDiv('pm-chase-foot')
    const chat = foot.createEl('button', { cls: 'mod-cta' })
    setIcon(chat.createSpan({ cls: 'pm-chase-icon' }), 'message-square')
    chat.createSpan({ text: t('chase.withChat') })
    chat.addEventListener(
      'click',
      safeAsync(async () => {
        this.close()
        const paths = [...new Set(this.list.map((one) => one.project.filePath))]
        await this.plugin.chatChase(paths, this.asked)
      })
    )
    foot.createEl('button', { text: t('common.close') }).addEventListener('click', () => this.close())
  }

  private renderGroup(el: HTMLElement, { project, group }: ProjectGroup, several: boolean): void {
    const head = el.createDiv('pm-chase-head')
    setIcon(head.createSpan({ cls: 'pm-chase-icon' }), group.issuer ? 'building-2' : 'circle-help')
    head.createSpan({ cls: 'pm-chase-issuer', text: group.issuer || t('chase.noIssuer') })
    if (several) head.createSpan({ cls: 'pm-chase-project', text: project.title })
    const day = today().toString()
    if (group.lastChase) {
      head.createSpan({
        cls: `pm-chase-chased${group.lastChase === day ? ' is-today' : ''}`,
        text:
          group.lastChase === day
            ? t('chase.chasedToday')
            : group.chaseCount > 1
              ? t('chase.chasedMany', { count: group.chaseCount, date: formatDate(group.lastChase) })
              : t('chase.chasedOnce', { date: formatDate(group.lastChase) })
      })
    }
    if (!group.issuer) el.createDiv({ cls: 'pm-chase-hint', text: t('chase.noIssuerHint') })

    const list = el.createEl('ul', { cls: 'pm-chase-items' })
    for (const item of group.items) {
      const row = list.createEl('li')
      row.createSpan({
        cls: 'pm-chase-item',
        text: [item.reference, item.title, item.issue ? t('chase.mail.issue', { issue: item.issue }) : '']
          .filter(Boolean)
          .join(' — ')
      })
      row.createSpan({
        cls: 'pm-chase-late',
        text: `${t('chase.mail.due', { date: formatDate(item.due) })} · ${t('chase.daysLate', { count: item.daysLate })}`
      })
    }

    const mail = chaseMail(group, { project: project.title, askedBy: this.asked }, chaseWords())
    const preview = el.createEl('details', { cls: 'pm-chase-preview' })
    preview.createEl('summary', { text: t('chase.preview') })
    preview.createDiv({ cls: 'pm-chase-subject', text: mail.subject })
    preview.createEl('pre', { cls: 'pm-chase-body', text: mail.body })

    const actions = el.createDiv('pm-chase-actions')
    const button = (icon: string, label: string, run: () => Promise<void>): HTMLButtonElement => {
      const one = actions.createEl('button')
      setIcon(one.createSpan({ cls: 'pm-chase-icon' }), icon)
      one.createSpan({ text: label })
      one.addEventListener('click', safeAsync(run))
      return one
    }
    button('copy', t('chase.copy'), async () => {
      await navigator.clipboard.writeText(`${t('chase.subjectLine', { subject: mail.subject })}\n\n${mail.body}`)
      new Notice(t('chase.copied'))
      if (this.note) await this.noteChase(project, group)
    })
    button('mail', t('chase.openMail'), async () => {
      window.open(`mailto:?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`)
      if (this.note) await this.noteChase(project, group)
    })
    const noted = button('calendar-check', t('chase.noteNow'), () => this.noteChase(project, group))
    noted.disabled = group.lastChase === day
  }

  /** The reminder noted on each of its documents, today. */
  private async noteChase(project: Project, group: ChaseGroup): Promise<void> {
    const day = today().toString()
    if (group.lastChase === day && group.items.every((item) => item.chases.includes(day))) return
    for (const item of group.items) {
      const task = findTaskById(project, item.id)
      if (!task) continue
      const next = recordChase(documentOf(task), day)
      task.document = next
      await this.plugin.store.updateTask(project, task.id, { document: next })
    }
    await this.onRefresh()
    new Notice(t('chase.noted', { count: group.items.length }))
    this.list = chaseList(this.projects, day)
    this.render()
  }
}
