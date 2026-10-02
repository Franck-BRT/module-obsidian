import { setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { FilterState, Project } from '../../types'
import type { ProjectScope } from '../../store'
import { personKeyer } from '../../store'
import { ContactBook, readContacts } from '../../store/contacts'
import { findTaskById } from '../../store/TaskIndex'
import { makeWorkCalendar } from '../../store/WorkCalendar'
import { loadLevel, workload, type LoadPiece, type PersonLoad, type Workload } from '../../store/workload'
import { openTaskModal } from '../../ui/ModalFactory'
import { formatDateShort, Temporal, today } from '../../dates'
import { t } from '../../i18n'
import { displayName, safeAsync } from '../../utils'
import { explain } from '../../ui/explain'
import { SUBVIEW_CLASS } from '../subviewClasses'
import type { SubView } from '../SubView'

const WEEK_CHOICES = [4, 8, 12, 26]

/** The week's number in the year, as a planning names it: « S41 ». */
function weekNumber(monday: string): number {
  return Temporal.PlainDate.from(monday).weekOfYear ?? 0
}

/** Hours, as a cell says them: « 32 h », « 7,5 h ». */
function hoursText(hours: number): string {
  const rounded = Math.round(hours * 2) / 2
  return `${String(rounded).replace('.', ',')} h`
}

function levelLabel(level: 'under' | 'near' | 'over'): string {
  switch (level) {
    case 'under':
      return t('load.under')
    case 'near':
      return t('load.near')
    case 'over':
      return t('load.over')
  }
}

interface Row {
  person: PersonLoad
  name: string
  capacity: number
  company: boolean
  /** The hours of each week that are this view's projects'. */
  here: number[]
}

/**
 * The load plan: for each person, week by week, the hours of work they hold — across
 * every project, or only those of the view — against what they can give in a week. A
 * week over it is red, near it amber. A cell clicked lists the tickets behind it, each
 * opening in its editor. Read from the plan as it stands: estimates, dates, progress,
 * who is assigned.
 */
export class WorkloadView implements SubView {
  private chosen: { key: string; week: number } | null = null
  private showCompanies = false
  private generation = 0

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState
  ) {}

  render(): void {
    this.container.empty()
    this.container.addClass(SUBVIEW_CLASS.workload)
    const root = this.container.createDiv('pm-load')
    root.createDiv({ cls: 'pm-load-wait', text: t('load.computing') })
    const generation = ++this.generation
    void (async () => {
      const data = await this.compute()
      if (generation !== this.generation) return
      root.empty()
      this.draw(root, data.plan, data.projects)
    })()
  }

  /** Every project to count: the view's, and the others too when asked. */
  private async projects(): Promise<Project[]> {
    const settings = this.plugin.settings
    if (this.scope.spec.kind === 'vault' || !settings.workloadAllProjects) {
      return this.scope.projects.filter((project) => !project.template && !project.program)
    }
    const paths = this.plugin.index
      .projectRefs()
      .filter((ref) => !ref.template && !ref.program)
      .map((ref) => ref.path)
    const all = await this.plugin.store.loadProjects(paths)
    // The view's own, as loaded here, so a change made in it shows at once.
    const own = new Map(this.scope.projects.map((project) => [project.filePath, project]))
    return all.map((project) => own.get(project.filePath) ?? project)
  }

  private async compute(): Promise<{ plan: Workload; projects: Project[] }> {
    const projects = await this.projects()
    const settings = this.plugin.settings
    const plan = workload(
      projects.map((project) => {
        const config = this.plugin.store.configFor(project)
        return {
          path: project.filePath,
          title: project.title,
          tasks: project.tasks,
          statuses: config.statuses,
          // The days people work, whether or not the plan is scheduled on them.
          calendar: makeWorkCalendar(settings.workingWeekdays, settings.holidays)
        }
      }),
      {
        today: today().toString(),
        weeks: settings.workloadWeeks,
        defaultHoursPerDay: Number(settings.workloadDefaultHours) || 0,
        meetingHours: 1,
        keyOf: personKeyer(this.plugin.app)
      }
    )
    return { plan, projects }
  }

  private rows(plan: Workload): Row[] {
    const book = new ContactBook(readContacts(this.plugin.app, this.plugin.settings.peopleFolder))
    const mine = new Set(this.scope.projects.map((project) => project.filePath))
    const all = this.scope.spec.kind === 'vault' || !this.plugin.settings.workloadAllProjects
    const wanted = this.filter.assignees.map((one) => displayName(one).toLowerCase())
    return plan.people
      .map((person) => {
        const contact = person.raw ? book.find(person.raw) : null
        const here = person.pieces.map((week) =>
          week.filter((piece) => mine.has(piece.projectPath)).reduce((sum, piece) => sum + piece.hours, 0)
        )
        return {
          person,
          name: person.raw ? (contact?.name ?? displayName(person.raw)) : t('load.nobody'),
          capacity: contact?.capacity || this.plugin.settings.workloadCapacity,
          company: contact?.kind === 'company',
          here
        }
      })
      .filter(
        (row) =>
          // In a project's view, the people who work on it — their other work counted too.
          (all || row.here.some((hours) => hours > 0) || row.person.unscheduled.some((p) => mine.has(p.projectPath))) &&
          (this.showCompanies || !row.company) &&
          (!wanted.length || wanted.includes(row.name.toLowerCase()))
      )
  }

  private draw(root: HTMLElement, plan: Workload, projects: Project[]): void {
    const rows = this.rows(plan)
    const book = new ContactBook(readContacts(this.plugin.app, this.plugin.settings.peopleFolder))
    const companies = plan.people.some((person) => book.find(person.raw)?.kind === 'company')
    this.drawHead(root, rows, plan, companies)
    if (!rows.length) {
      const empty = root.createDiv('pm-load-empty')
      empty.createDiv({ cls: 'pm-load-empty-title', text: t('load.none') })
      empty.createDiv({ cls: 'pm-load-empty-text', text: t('load.noneDesc') })
      return
    }
    const wrap = root.createDiv('pm-load-grid-wrap')
    const table = wrap.createEl('table', { cls: 'pm-load-grid' })
    const head = table.createEl('thead').createEl('tr')
    head.createEl('th', { cls: 'pm-load-person-head', text: t('load.person') })
    const now = today().toString()
    for (const monday of plan.weeks) {
      const th = head.createEl('th', { cls: `pm-load-week${monday <= now ? ' is-current' : ''}` })
      th.createDiv({ cls: 'pm-load-week-number', text: t('load.week', { week: weekNumber(monday) }) })
      th.createDiv({ cls: 'pm-load-week-day', text: formatDateShort(monday) })
    }
    head.createEl('th', { cls: 'pm-load-undated-head', text: t('load.undated') })
    const body = table.createEl('tbody')
    const mixed = this.scope.spec.kind !== 'vault' && this.plugin.settings.workloadAllProjects
    for (const row of rows) {
      const tr = body.createEl('tr', { cls: row.person.key ? '' : 'is-nobody' })
      const who = tr.createEl('th', { cls: 'pm-load-person' })
      who.createDiv({ cls: 'pm-load-name', text: row.name })
      if (row.person.key) who.createDiv({ cls: 'pm-load-capacity', text: t('load.capacity', { hours: row.capacity }) })
      row.person.hours.forEach((hours, week) => {
        const level = row.person.key ? loadLevel(hours, row.capacity) : hours > 0 ? 'under' : 'empty'
        const chosen = this.chosen?.key === row.person.key && this.chosen.week === week
        const td = tr.createEl('td', { cls: `pm-load-cell is-${level}${chosen ? ' is-chosen' : ''}` })
        if (hours <= 0) return
        const button = td.createEl('button', { cls: 'pm-load-hours', text: hoursText(hours) })
        const other = hours - row.here[week]
        if (mixed && other > 0.01) {
          // The share of other projects, drawn under the figure.
          const bar = td.createDiv('pm-load-share')
          bar
            .createDiv({ cls: 'pm-load-share-here' })
            .style.setProperty('--pm-share', `${(row.here[week] / hours) * 100}%`)
        }
        const help = [
          row.person.key ? t('load.cellOf', { hours: hoursText(hours), capacity: hoursText(row.capacity) }) : '',
          mixed && other > 0.01 ? t('load.cellOther', { hours: hoursText(other) }) : '',
          t('load.cellOpen')
        ]
          .filter(Boolean)
          .join(' ')
        explain(button, `${row.name} — ${t('load.week', { week: weekNumber(plan.weeks[week]) })}`, help)
        button.addEventListener('click', () => {
          this.chosen = chosen ? null : { key: row.person.key, week }
          this.draw(this.redraw(root), plan, projects)
        })
      })
      const undated = row.person.unscheduled.reduce((sum, piece) => sum + piece.hours, 0)
      const pickedUndated = this.chosen?.key === row.person.key && this.chosen.week === -1
      const td = tr.createEl('td', { cls: `pm-load-undated${pickedUndated ? ' is-chosen' : ''}` })
      if (undated > 0) {
        const button = td.createEl('button', { cls: 'pm-load-hours', text: hoursText(undated) })
        explain(button, t('load.undated'), t('tip.load.undated'))
        button.addEventListener('click', () => {
          this.chosen =
            this.chosen?.key === row.person.key && this.chosen.week === -1 ? null : { key: row.person.key, week: -1 }
          this.draw(this.redraw(root), plan, projects)
        })
      }
    }
    this.drawDetail(root, rows, plan, projects)
  }

  private redraw(root: HTMLElement): HTMLElement {
    root.empty()
    return root
  }

  private drawHead(root: HTMLElement, rows: Row[], plan: Workload, companies: boolean): void {
    const head = root.createDiv('pm-load-head')
    const titles = head.createDiv('pm-load-titles')
    titles.createEl('h3', { cls: 'pm-load-title', text: t('load.title') })
    const over = rows.filter(
      (row) => row.person.key && row.person.hours.some((h) => loadLevel(h, row.capacity) === 'over')
    )
    titles.createDiv({
      cls: 'pm-load-summary',
      text: over.length ? t('load.overCount', { count: over.length }) : t('load.allFine')
    })
    const controls = head.createDiv('pm-load-controls')
    const weeks = controls.createEl('select', { cls: 'dropdown' })
    for (const count of WEEK_CHOICES) {
      weeks.createEl('option', { value: String(count), text: t('load.weeks', { count }) })
    }
    weeks.value = String(plan.weeks.length)
    weeks.addEventListener(
      'change',
      safeAsync(async () => {
        this.plugin.settings.workloadWeeks = Number(weeks.value) || 12
        await this.plugin.saveSettings()
        this.render()
      })
    )
    if (this.scope.spec.kind !== 'vault') {
      const label = controls.createEl('label', { cls: 'pm-load-toggle' })
      const box = label.createEl('input', { attr: { type: 'checkbox' } })
      box.checked = this.plugin.settings.workloadAllProjects
      label.createSpan({ text: t('load.allProjects') })
      explain(label, t('load.allProjects'), t('tip.load.allProjects'))
      box.addEventListener(
        'change',
        safeAsync(async () => {
          this.plugin.settings.workloadAllProjects = box.checked
          await this.plugin.saveSettings()
          this.render()
        })
      )
    }
    if (companies) {
      const label = controls.createEl('label', { cls: 'pm-load-toggle' })
      const box = label.createEl('input', { attr: { type: 'checkbox' } })
      box.checked = this.showCompanies
      label.createSpan({ text: t('load.companies') })
      box.addEventListener('change', () => {
        this.showCompanies = box.checked
        this.render()
      })
    }
    const legend = head.createDiv('pm-load-legend')
    for (const level of ['under', 'near', 'over'] as const) {
      const item = legend.createSpan({ cls: 'pm-load-legend-item' })
      item.createSpan({ cls: `pm-load-swatch is-${level}` })
      item.createSpan({ text: levelLabel(level) })
    }
    const how = head.createDiv('pm-load-how')
    setIcon(how.createSpan({ cls: 'pm-load-how-icon' }), 'info')
    how.createSpan({
      text: t('load.how', {
        hours: Number(this.plugin.settings.workloadDefaultHours) || 0,
        capacity: this.plugin.settings.workloadCapacity
      })
    })
  }

  /** The tickets behind the cell clicked, the heaviest first. */
  private drawDetail(root: HTMLElement, rows: Row[], plan: Workload, projects: Project[]): void {
    const chosen = this.chosen
    if (!chosen) return
    const row = rows.find((one) => one.person.key === chosen.key)
    if (!row) return
    const pieces = chosen.week < 0 ? row.person.unscheduled : (row.person.pieces[chosen.week] ?? [])
    const detail = root.createDiv('pm-load-detail')
    const total = pieces.reduce((sum, piece) => sum + piece.hours, 0)
    detail.createEl('h4', {
      cls: 'pm-load-detail-title',
      text:
        chosen.week < 0
          ? t('load.detailUndated', { name: row.name, hours: hoursText(total) })
          : t('load.detail', {
              name: row.name,
              week: weekNumber(plan.weeks[chosen.week]),
              date: formatDateShort(plan.weeks[chosen.week]),
              hours: hoursText(total),
              capacity: hoursText(row.capacity)
            })
    })
    const byPath = new Map(projects.map((project) => [project.filePath, project]))
    const list = detail.createDiv('pm-load-pieces')
    for (const piece of pieces) this.drawPiece(list, piece, byPath)
  }

  private drawPiece(list: HTMLElement, piece: LoadPiece, byPath: Map<string, Project>): void {
    const line = list.createDiv(`pm-load-piece${piece.late ? ' is-late' : ''}`)
    line.createSpan({ cls: 'pm-load-piece-hours', text: hoursText(piece.hours) })
    const title = line.createEl('a', { cls: 'pm-load-piece-title', href: '#', text: piece.title })
    title.addEventListener('click', (event) => {
      event.preventDefault()
      const project = byPath.get(piece.projectPath)
      const task = project ? findTaskById(project, piece.taskId) : null
      if (project && task) openTaskModal(this.plugin, project, { task, onSave: () => this.onRefresh() })
    })
    const meta = line.createSpan({ cls: 'pm-load-piece-meta' })
    meta.createSpan({ text: piece.projectTitle })
    const dates = [piece.start, piece.due].filter(Boolean).map(formatDateShort)
    if (dates.length) meta.createSpan({ text: dates.join(' → ') })
    if (piece.late) meta.createSpan({ cls: 'pm-load-piece-late', text: t('load.late') })
    if (!piece.estimated) meta.createSpan({ cls: 'pm-load-piece-guess', text: t('load.noEstimate') })
  }
}
