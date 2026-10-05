import { Modal, Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project } from '../../types'
import { flattenTasks } from '../../store/TaskTreeOps'
import { visaWaits, type VisaWait } from '../../store/visaDelay'
import { waitText } from './visaWaitWords'
import { formatDateShort, today } from '../../dates'
import { openTaskModal } from '../../ui/ModalFactory'
import { displayName } from '../../utils'
import { explain } from '../../ui/explain'
import { t } from '../../i18n'
import { openVisaSheet } from './VisaModal'

export interface ProjectWait {
  project: Project
  wait: VisaWait
}

export { waitText } from './visaWaitWords'

/** The visas owed across projects, each reckoned with its project's delay. */
export function projectWaits(plugin: PMPlugin, projects: Project[], day = today().toString()): ProjectWait[] {
  return projects
    .filter((project) => !project.template && !project.program)
    .flatMap((project) => {
      const days = plugin.store.configFor(project).visaDays
      return visaWaits(
        flattenTasks(project.tasks).map((flat) => flat.task),
        day,
        () => days
      ).map((wait) => ({ project, wait }))
    })
    .sort((a, b) => b.wait.late - a.wait.late || a.wait.task.title.localeCompare(b.wait.task.title))
}

/** Every project of the vault that holds tickets, loaded. */
export async function workProjects(plugin: PMPlugin): Promise<Project[]> {
  const paths = plugin.index
    .projectRefs()
    .filter((ref) => !ref.template && !ref.program)
    .map((ref) => ref.path)
  return plugin.store.loadProjects(paths)
}

/** Opens the visas owed — or says there is none. */
export function openVisaWaits(plugin: PMPlugin, projects: Project[], onRefresh: () => Promise<void>): void {
  if (!projectWaits(plugin, projects).length) {
    new Notice(t('visa.waitNone'))
    return
  }
  new VisaWaitsModal(plugin, projects, onRefresh).open()
}

/**
 * The visas owed, by reviewer: each document, since when it waits and by when it is
 * due, the late ones first — with its assisted sheet one click away, for that reviewer.
 */
class VisaWaitsModal extends Modal {
  constructor(
    private plugin: PMPlugin,
    private projects: Project[],
    private onRefresh: () => Promise<void>
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.modalEl.addClass('pm-visa-waits-modal')
    this.setTitle(t('visa.waitsTitle'))
    this.render()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    const waits = projectWaits(this.plugin, this.projects)
    const late = waits.filter((one) => one.wait.late > 0).length
    root.createDiv({ cls: 'pm-visa-intro', text: t('visa.waitsIntro', { count: waits.length, late }) })
    const byReviewer = new Map<string, ProjectWait[]>()
    for (const one of waits) {
      const key = one.wait.approver
      byReviewer.set(key, [...(byReviewer.get(key) ?? []), one])
    }
    const several = new Set(waits.map((one) => one.project.filePath)).size > 1
    // The reviewers most behind first, nobody named last.
    const order = [...byReviewer.entries()].sort(
      ([a, x], [b, y]) => Number(!a) - Number(!b) || y[0].wait.late - x[0].wait.late || a.localeCompare(b)
    )
    for (const [reviewer, list] of order) {
      const group = root.createDiv('pm-visa-wait-group')
      const head = group.createDiv('pm-visa-wait-head')
      setIcon(head.createSpan({ cls: 'pm-visa-icon' }), reviewer ? 'user-check' : 'user-x')
      head.createSpan({ cls: 'pm-visa-wait-who', text: reviewer ? displayName(reviewer) : t('visa.noReviewerNamed') })
      const behind = list.filter((one) => one.wait.late > 0).length
      if (behind) head.createSpan({ cls: 'pm-visa-wait-late', text: t('visa.lateCount', { count: behind }) })
      for (const { project, wait } of list) {
        const row = group.createDiv(`pm-visa-wait-row${wait.late > 0 ? ' is-late' : ''}`)
        const meta = wait.task.document
        const name = [meta?.reference, wait.task.title, meta?.issue ? t('chase.mail.issue', { issue: meta.issue }) : '']
          .filter(Boolean)
          .join(' — ')
        const title = row.createEl('a', { cls: 'pm-visa-wait-doc', href: '#', text: name })
        title.addEventListener('click', (event) => {
          event.preventDefault()
          openTaskModal(this.plugin, project, { task: wait.task, onSave: () => this.refresh() })
        })
        const facts = row.createSpan({ cls: 'pm-visa-wait-facts' })
        if (several) facts.createSpan({ text: project.title })
        facts.createSpan({ text: t('visa.receivedOn', { date: formatDateShort(wait.received) }) })
        facts.createSpan({ text: t('visa.dueOn', { date: formatDateShort(wait.due) }) })
        facts.createSpan({ cls: 'pm-visa-wait-state', text: waitText(wait) })
        const sheet = row.createEl('button', { cls: 'pm-visa-wait-sheet' })
        setIcon(sheet.createSpan({ cls: 'pm-visa-icon' }), 'file-search')
        sheet.createSpan({ text: t('visa.short') })
        explain(sheet, t('visa.title'), t('tip.visa.open'))
        sheet.addEventListener('click', () => {
          this.close()
          openVisaSheet(this.plugin, project, wait.task, () => this.onRefresh(), wait.approver || undefined)
        })
      }
    }
    const foot = root.createDiv('pm-visa-foot')
    foot.createEl('button', { text: t('common.close') }).addEventListener('click', () => this.close())
  }

  private async refresh(): Promise<void> {
    await this.onRefresh()
    this.render()
  }
}

/** Past this many, the notice names the first ones and counts the rest. */
const NAMED = 3

/**
 * The visas past their day, said once a day when Obsidian opens — which document, who
 * owes it, by how much —, with the list one click away. Asked for, said whenever, and
 * says too when there is none.
 */
export async function remindLateVisas(plugin: PMPlugin, asked = false): Promise<void> {
  const day = today().toString()
  if (!asked && (!plugin.settings.visaReminder || plugin.settings.visaReminderShown === day)) return
  const projects = await workProjects(plugin)
  const late = projectWaits(plugin, projects, day).filter((one) => one.wait.late > 0)
  if (!asked) {
    plugin.settings.visaReminderShown = day
    await plugin.saveSettings()
  }
  const refresh = (): Promise<void> => {
    plugin.refreshViews()
    return Promise.resolve()
  }
  if (!late.length) {
    if (asked) openVisaWaits(plugin, projects, refresh)
    return
  }
  const named = late.slice(0, NAMED).map(({ wait }) =>
    t('visa.lateItem', {
      document: wait.task.document?.reference || wait.task.title,
      who: wait.approver ? displayName(wait.approver) : t('visa.noReviewerNamed'),
      count: wait.late
    })
  )
  if (late.length > NAMED) named.push(t('chase.unansweredMore', { count: late.length - NAMED }))
  const fragment = createFragment((el) => {
    el.createDiv({ cls: 'pm-chase-notice-title', text: t('visa.lateNotice', { count: late.length }) })
    const list = el.createEl('ul', { cls: 'pm-chase-notice-list' })
    for (const line of named) list.createEl('li', { text: line })
    const row = el.createDiv('pm-scan-resume-row')
    const go = row.createEl('button', { cls: 'mod-cta', text: t('visa.lateGo') })
    const later = row.createEl('button', { text: t('chase.unansweredLater') })
    go.addEventListener('click', (event) => {
      event.stopPropagation()
      notice.hide()
      openVisaWaits(plugin, projects, refresh)
    })
    later.addEventListener('click', (event) => {
      event.stopPropagation()
      notice.hide()
    })
  })
  const notice = new Notice(fragment, 0)
}
