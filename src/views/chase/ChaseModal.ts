import { Modal, Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project } from '../../types'
import { documentOf } from '../../store/Document'
import { findTaskById } from '../../store/TaskIndex'
import { flattenTasks } from '../../store/TaskTreeOps'
import {
  askedBy,
  awaitedDocuments,
  CHASE_TONES,
  chaseGroups,
  chaseMail,
  daysSinceChase,
  delayFor,
  recordChase,
  toneFor,
  unansweredChases,
  type ChaseGroup,
  type ChaseTone
} from '../../store/chasing'
import { fold } from '../../store/library/libraryDoc'
import { ContactBook, contactKey, readContacts } from '../../store/contacts'
import { formatDate, today } from '../../dates'
import { safeAsync } from '../../utils'
import { openContactModal } from '../contacts/ContactModal'
import { chaseWords } from './chaseWords'
import { t } from '../../i18n'
import { explain } from '../../ui/explain'

interface ProjectGroup {
  project: Project
  group: ChaseGroup
}

/** A reminder's own key: its project, and who owes. */
function groupKey({ project, group }: ProjectGroup): string {
  return `${project.filePath}|${fold(group.issuer).replace(/\s+/g, ' ')}`
}

/** A tone's name for the reader. */
export function toneLabel(tone: ChaseTone): string {
  switch (tone) {
    case 'courteous':
      return t('chase.tone.courteous')
    case 'firm':
      return t('chase.tone.firm')
    case 'final':
      return t('chase.tone.final')
  }
}

/**
 * The documents the projects still wait for past their date, gathered by who owes them —
 * only those `only` keeps, when given.
 */
export function chaseList(projects: Project[], day: string, only?: (issuer: string) => boolean): ProjectGroup[] {
  return projects
    .filter((project) => !project.program && !project.template)
    .flatMap((project) =>
      chaseGroups(
        awaitedDocuments(
          flattenTasks(project.tasks).map((flat) => flat.task),
          day
        )
      )
        .filter((group) => !only || only(group.issuer))
        .map((group) => ({ project, group }))
    )
}

/**
 * Opens the reminders for what the projects still wait for — or says there is nothing
 * to chase.
 */
export function openChase(
  plugin: PMPlugin,
  projects: Project[],
  onRefresh: () => Promise<void>,
  issuer?: string
): void {
  // One contact's reminders: the documents whose issuer is that contact, however written.
  const only = issuer
    ? (() => {
        const book = new ContactBook(readContacts(plugin.app, plugin.settings.peopleFolder))
        const wanted = book.find(issuer)?.path ?? contactKey(issuer)
        return (one: string): boolean => (book.find(one)?.path ?? contactKey(one)) === wanted
      })()
    : undefined
  const list = chaseList(projects, today().toString(), only)
  if (!list.length) {
    new Notice(t('view.awaitedNone'))
    return
  }
  new ChaseModal(plugin, projects, list, onRefresh, { only }).open()
}

/**
 * The reminders left unanswered `days` or more, opened on the next one each — firmer —
 * or false when there is none.
 */
export function openUnansweredChases(
  plugin: PMPlugin,
  projects: Project[],
  days: number,
  onRefresh: () => Promise<void>
): boolean {
  const list = unansweredChases(chaseList(projects, today().toString()), today().toString(), days)
  if (!list.length) return false
  new ChaseModal(plugin, projects, list, onRefresh, { unanswered: true }).open()
  return true
}

/**
 * The reminders, one for each who owes documents: what is missing, since when, and how
 * often they were chased already, with the mail ready — to copy, to open in the mail
 * client, or to have the chat write in its own words. A reminder sent is noted on its
 * documents, so the next one knows it is the second.
 */
class ChaseModal extends Modal {
  private note = true
  /** Each reminder's tone and date, as the reader set them. */
  private choices = new Map<string, { tone: ChaseTone; asked: string; dated: boolean }>()
  /** The reminders shown: those first listed, however their chases change. */
  private shown: Set<string>

  constructor(
    private plugin: PMPlugin,
    private projects: Project[],
    private list: ProjectGroup[],
    private onRefresh: () => Promise<void>,
    private mode: { only?: (issuer: string) => boolean; unanswered?: boolean } = {}
  ) {
    super(plugin.app)
    this.shown = new Set(list.map(groupKey))
  }

  /** A reminder's tone and date: the next its earlier ones call for, unless changed. */
  private choice(one: ProjectGroup): { tone: ChaseTone; asked: string; dated: boolean } {
    const key = groupKey(one)
    let choice = this.choices.get(key)
    if (!choice) {
      // Noted today, it was the reminder of today: its tone is the one it went with.
      const sent = one.group.lastChase === today().toString() ? one.group.chaseCount - 1 : one.group.chaseCount
      const tone = toneFor(sent)
      choice = { tone, asked: askedBy(today().toString(), delayFor(tone)), dated: false }
      this.choices.set(key, choice)
    }
    return choice
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
    root.createDiv({
      cls: 'pm-chase-intro',
      text: this.mode.unanswered ? t('chase.introUnanswered', { count: this.list.length }) : t('chase.intro', { count })
    })

    const options = root.createDiv('pm-chase-options')
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
    explain(chat, t('chase.withChat'), t('tip.chase.withChat'))
    chat.addEventListener(
      'click',
      safeAsync(async () => {
        this.close()
        const paths = [...new Set(this.list.map((one) => one.project.filePath))]
        const first = this.list[0]
        await this.plugin.chatChase(paths, first ? this.choice(first).asked : askedBy(today().toString(), 7))
      })
    )
    foot.createEl('button', { text: t('common.close') }).addEventListener('click', () => this.close())
  }

  private renderGroup(el: HTMLElement, one: ProjectGroup, several: boolean): void {
    const { project, group } = one
    const choice = this.choice(one)
    const head = el.createDiv('pm-chase-head')
    setIcon(head.createSpan({ cls: 'pm-chase-icon' }), group.issuer ? 'building-2' : 'circle-help')
    head.createSpan({ cls: 'pm-chase-issuer', text: group.issuer || t('chase.noIssuer') })
    if (several) head.createSpan({ cls: 'pm-chase-project', text: project.title })
    const day = today().toString()
    if (group.lastChase) {
      const silent = daysSinceChase(group, day)
      head.createSpan({
        cls: `pm-chase-chased${group.lastChase === day ? ' is-today' : ''}`,
        text:
          group.lastChase === day
            ? t('chase.chasedToday')
            : [
                group.chaseCount > 1
                  ? t('chase.chasedMany', { count: group.chaseCount, date: formatDate(group.lastChase) })
                  : t('chase.chasedOnce', { date: formatDate(group.lastChase) }),
                t('chase.silent', { count: silent })
              ].join(' · ')
      })
    }
    if (!group.issuer) el.createDiv({ cls: 'pm-chase-hint', text: t('chase.noIssuerHint') })
    // Who it goes to: the issuer's contact, its mail or its people's.
    const book = new ContactBook(readContacts(this.app, this.plugin.settings.peopleFolder))
    const to = group.issuer ? book.emailsFor(group.issuer) : []
    if (group.issuer) {
      const line = el.createDiv('pm-chase-to')
      if (to.length) line.setText(t('chase.to', { to: to.join(', ') }))
      else {
        const known = book.find(group.issuer)
        line.createSpan({ cls: 'pm-chase-hint', text: known ? t('chase.noMail') : t('chase.noContact') })
        const fix = line.createEl('a', { href: '#', text: known ? t('chase.addMail') : t('chase.makeContact') })
        fix.addEventListener('click', (event) => {
          event.preventDefault()
          openContactModal(this.plugin, {
            contact: known ?? undefined,
            name: group.issuer.replace(/^\[\[|\]\]$/g, '').replace(/^.*\|/, ''),
            kind: 'company',
            onDone: () => this.render()
          })
        })
      }
    }

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

    // How it speaks, and by when it asks: the next step after the earlier reminders, unless changed.
    const how = el.createDiv('pm-chase-how')
    const toneField = how.createEl('label', { cls: 'pm-chase-option' })
    toneField.createSpan({ text: t('chase.tone') })
    const select = toneField.createEl('select', { cls: 'dropdown' })
    for (const tone of CHASE_TONES) select.createEl('option', { value: tone, text: toneLabel(tone) })
    select.value = choice.tone
    explain(select, t('chase.tone'), t('tip.chase.tone'))
    select.addEventListener('change', () => {
      choice.tone = select.value as ChaseTone
      if (!choice.dated) choice.asked = askedBy(today().toString(), delayFor(choice.tone))
      this.render()
    })
    const dateField = how.createEl('label', { cls: 'pm-chase-option' })
    dateField.createSpan({ text: t('chase.askedBy') })
    const input = dateField.createEl('input', { attr: { type: 'date' } })
    input.value = choice.asked
    input.addEventListener('change', () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return
      choice.asked = input.value
      choice.dated = true
      this.render()
    })

    const mail = chaseMail(group, { project: project.title, askedBy: choice.asked, tone: choice.tone }, chaseWords())
    const preview = el.createEl('details', { cls: 'pm-chase-preview' })
    preview.createEl('summary', { text: t('chase.preview') })
    preview.createDiv({ cls: 'pm-chase-subject', text: mail.subject })
    preview.createEl('pre', { cls: 'pm-chase-body', text: mail.body })

    const actions = el.createDiv('pm-chase-actions')
    const button = (icon: string, label: string, run: () => Promise<void>, help = ''): HTMLButtonElement => {
      const one = actions.createEl('button')
      setIcon(one.createSpan({ cls: 'pm-chase-icon' }), icon)
      one.createSpan({ text: label })
      explain(one, label, help)
      one.addEventListener('click', safeAsync(run))
      return one
    }
    button(
      'copy',
      t('chase.copy'),
      async () => {
        await navigator.clipboard.writeText(`${t('chase.subjectLine', { subject: mail.subject })}\n\n${mail.body}`)
        new Notice(t('chase.copied'))
        if (this.note) await this.noteChase(project, group)
      },
      t('tip.chase.copy')
    )
    button(
      'mail',
      t('chase.openMail'),
      async () => {
        window.open(
          `mailto:${to.map((one) => one.replace(/[?&#\s,]/g, '')).join(',')}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`
        )
        if (this.note) await this.noteChase(project, group)
      },
      t('tip.chase.openMail')
    )
    const noted = button(
      'calendar-check',
      t('chase.noteNow'),
      () => this.noteChase(project, group),
      t('tip.chase.noteNow')
    )
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
    this.list = chaseList(this.projects, day, this.mode.only).filter((one) => this.shown.has(groupKey(one)))
    this.render()
  }
}
