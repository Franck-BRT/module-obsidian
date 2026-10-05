import { Modal, Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project } from '../../types'
import { readXlsx } from '../../store/xlsxRead'
import { readMsProject } from '../../store/planning/msProject'
import { readPlanningSheet } from '../../store/planning/planningSheet'
import { planCounts, planTasks, type Plan } from '../../store/planning/plan'
import { insertPlanTree } from '../../store/planning/planInsert'
import { formatDate } from '../../dates'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

/** A file's planning, whatever it is: a spreadsheet by its ZIP signature, else MS Project's XML. */
export async function readPlanningFile(name: string, bytes: Uint8Array): Promise<Plan> {
  if (/\.mpp$/i.test(name)) throw new Error(t('planning.mpp'))
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const plan = readPlanningSheet(await readXlsx(bytes), name)
    if (!plan) throw new Error(t('planning.noColumn'))
    return plan
  }
  return readMsProject(new TextDecoder().decode(bytes))
}

/**
 * A planning brought in from MS Project (XML) or a spreadsheet: the file picked, what it
 * holds shown — lots, tasks, milestones, links, people, from when to when, what could not
 * be read —, then its tickets made in a new project or added to the one open.
 */
export class PlanningImportModal extends Modal {
  private plan: Plan | null = null
  private fileName = ''
  private target: 'new' | 'current'

  constructor(
    private plugin: PMPlugin,
    /** The project open, which the planning can be added to. */
    private current: Project | null,
    private onDone?: () => Promise<void>
  ) {
    super(plugin.app)
    this.target = current ? 'current' : 'new'
  }

  onOpen(): void {
    this.setTitle(t('planning.title'))
    this.modalEl.addClass('pm-planning-modal')
    this.render()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    root.createDiv({ cls: 'pm-planning-intro', text: t('planning.intro') })
    const pick = root.createEl('label', { cls: 'pm-planning-pick' })
    setIcon(pick.createSpan({ cls: 'pm-planning-icon' }), 'file-up')
    pick.createSpan({ text: this.fileName || t('planning.pick') })
    const input = pick.createEl('input', { attr: { type: 'file', accept: '.xml,.xlsx,.xlsm,.mpp' } })
    input.addClass('pm-hidden')
    input.addEventListener(
      'change',
      safeAsync(async () => {
        const file = input.files?.[0]
        if (!file) return
        this.fileName = file.name
        try {
          this.plan = await readPlanningFile(file.name, new Uint8Array(await file.arrayBuffer()))
        } catch (error) {
          this.plan = null
          new Notice(t('planning.unreadable', { reason: error instanceof Error ? error.message : String(error) }))
        }
        this.render()
      })
    )
    const plan = this.plan
    if (!plan) return
    if (!plan.lines.length) {
      root.createDiv({ cls: 'pm-planning-warning', text: t('planning.empty') })
      return
    }
    const counts = planCounts(plan)
    const facts = root.createEl('ul', { cls: 'pm-planning-facts' })
    facts.createEl('li', {
      text: [
        t('planning.count.lots', { count: counts.lots }),
        t('planning.count.tasks', { count: counts.tasks }),
        t('planning.count.milestones', { count: counts.milestones }),
        t('planning.count.links', { count: counts.links })
      ].join(', ')
    })
    if (counts.start) {
      facts.createEl('li', {
        text: t('planning.period', { start: formatDate(counts.start), due: formatDate(counts.due) })
      })
    }
    if (counts.people) facts.createEl('li', { text: t('planning.people', { count: counts.people }) })
    if (plan.warnings.length) {
      const warn = root.createDiv('pm-planning-warning')
      warn.createDiv({ text: t('planning.warnings', { count: plan.warnings.length }) })
      const list = warn.createEl('ul')
      for (const one of plan.warnings.slice(0, 5)) {
        list.createEl('li', {
          text:
            one.kind === 'link'
              ? t('planning.warningLink', { line: one.line, key: one.value })
              : t('planning.warningDate', { line: one.line, value: one.value })
        })
      }
    }

    // Where its tickets go: a new project, or the one open.
    const where = root.createDiv('pm-planning-target')
    const option = (value: 'new' | 'current', label: string): void => {
      const row = where.createEl('label', { cls: 'pm-planning-option' })
      const radio = row.createEl('input', { attr: { type: 'radio', name: 'pm-planning-target' } })
      radio.checked = this.target === value
      row.createSpan({ text: label })
      radio.addEventListener('change', () => {
        this.target = value
        this.render()
      })
    }
    if (this.current) option('current', t('planning.intoCurrent', { project: this.current.title }))
    option('new', t('planning.intoNew'))
    let title = plan.name || this.fileName.replace(/\.[^.]+$/, '')
    if (this.target === 'new') {
      const name = where.createEl('input', { cls: 'pm-planning-name', attr: { type: 'text' } })
      name.value = title
      name.addEventListener('input', () => (title = name.value))
    }
    const foot = root.createDiv('pm-planning-foot')
    foot.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close())
    const go = foot.createEl('button', { cls: 'mod-cta', text: t('planning.import') })
    go.addEventListener(
      'click',
      safeAsync(async () => {
        go.disabled = true
        await this.import(plan, title.trim() || t('planning.untitled'))
      })
    )
  }

  private async import(plan: Plan, title: string): Promise<void> {
    const plugin = this.plugin
    let project = this.target === 'current' ? this.current : null
    if (!project) {
      const folder = plugin.settings.projectsFolder.trim() || 'Projects'
      project = await plugin.store.createProject(title, folder)
    }
    const working = new Notice(t('planning.working'), 0)
    let count = 0
    try {
      const done = plugin.store.configFor(project).statuses.find((status) => status.complete)?.id ?? 'done'
      for (const task of planTasks(plan, done)) count += await insertPlanTree(plugin.store, project, task, null)
    } finally {
      working.hide()
    }
    this.close()
    new Notice(t('planning.done', { count, project: project.title }))
    if (this.onDone) await this.onDone()
    if (this.target === 'new') await plugin.router.openScope({ kind: 'project', path: project.filePath })
  }
}
