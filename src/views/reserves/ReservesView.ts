import { Notice, setIcon, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { FilterState, Project, ReservePhase, ReserveState, Task, TaskReserve } from '../../types'
import { makeTask } from '../../types'
import type { ProjectScope } from '../../store'
import { flattenTasks } from '../../store/TaskTreeOps'
import {
  emptyReserve,
  isLateReserve,
  isReserve,
  moveReserve,
  nextReserveNumber,
  nextReserveState,
  orderReserves,
  recordReserveChase,
  RESERVE_PHASES,
  RESERVE_SEVERITIES,
  reserveCompany,
  reserveMail,
  reserveOf,
  reserveSummary,
  statusForReserve
} from '../../store/reserve'
import { ContactBook, readContacts } from '../../store/contacts'
import { addDays } from '../../store/Metrics'
import { askedBy } from '../../store/chasing'
import { openTaskModal } from '../../ui/ModalFactory'
import { formatDateLetter, formatDateShort, today } from '../../dates'
import { fold } from '../../store/library/libraryDoc'
import { safeAsync } from '../../utils'
import { explain } from '../../ui/explain'
import { t } from '../../i18n'
import { SUBVIEW_CLASS } from '../subviewClasses'
import type { SubView } from '../SubView'
import { addReservePhotos, imagesOf } from '../../modals/ReservePanel'
import { phaseLabel, severityLabel, STATE_COLOR, STATE_ICON, stateLabel } from './reserveLabels'
import { openReceptionReport } from './receptionReport'

type GroupBy = 'company' | 'lot' | 'location'
type StateFilter = 'all' | ReserveState | 'late'

/** What the quick entry keeps from one reserve to the next, as a site walk goes. */
interface Draft {
  location: string
  lot: string
  company: string
  severity: TaskReserve['severity']
  phase: ReservePhase
  /** Days given to lift it. */
  days: number
  photos: { blob: Blob; name: string }[]
}

const draft: Draft = { location: '', lot: '', company: '', severity: 'minor', phase: 'opr', days: 15, photos: [] }

/**
 * A project's reserves, as a site walk takes them and a handover follows them up: a
 * line to type each one into — where, which trade, which contractor, what, a photo
 * pasted —, keeping the place and the trade for the next; then the reserves by
 * contractor, trade or place, each with its state a click moves on — open, said lifted,
 * seen lifted —, the late ones said so, and for each contractor the mail that chases
 * what they still owe. The handover report comes out of it as Word and PDF.
 */
export class ReservesView implements SubView {
  private group: GroupBy = 'company'
  private state: StateFilter = 'all'
  private phase: 'all' | ReservePhase = 'all'

  constructor(
    private container: HTMLElement,
    private scope: ProjectScope,
    private plugin: PMPlugin,
    private onRefresh: () => Promise<void>,
    private filter: FilterState
  ) {}

  private reserves(): Task[] {
    const words = fold(this.filter.text)
    return flattenTasks(this.scope.tasks())
      .map((flat) => flat.task)
      .filter((task) => isReserve(task) && !task.archived)
      .filter((task) => {
        if (!words) return true
        const reserve = reserveOf(task)
        return fold(
          `${task.title} ${reserve.number} ${reserve.location} ${reserve.lot} ${reserveCompany(task)}`
        ).includes(words)
      })
  }

  render(): void {
    this.container.empty()
    this.container.addClass(SUBVIEW_CLASS.reserves)
    const root = this.container.createDiv('pm-reserves')
    const all = this.reserves()
    const day = today().toString()
    this.renderHead(root, all, day)
    const project = this.scope.addableProjects[0]
    if (this.scope.canAddTask && project) this.renderQuickAdd(root, project)
    this.renderFilters(root)
    const shown = orderReserves(
      all.filter((task) => {
        const reserve = reserveOf(task)
        if (this.phase !== 'all' && reserve.phase !== this.phase) return false
        if (this.state === 'late') return isLateReserve(task, day)
        return this.state === 'all' || reserve.state === this.state
      })
    )
    if (!all.length) {
      const empty = root.createDiv('pm-reserves-empty')
      empty.createDiv({ cls: 'pm-reserves-empty-title', text: t('reserve.none') })
      empty.createDiv({ text: t('reserve.noneDesc') })
      return
    }
    if (!shown.length) {
      root.createDiv({ cls: 'pm-reserves-empty', text: t('reserve.nothingShown') })
      return
    }
    const groups = new Map<string, Task[]>()
    for (const task of shown) {
      const reserve = reserveOf(task)
      const key =
        this.group === 'company' ? reserveCompany(task) : this.group === 'lot' ? reserve.lot : reserve.location
      groups.set(key, [...(groups.get(key) ?? []), task])
    }
    const keys = [...groups.keys()].sort((a, b) => Number(!a) - Number(!b) || a.localeCompare(b))
    for (const key of keys) this.renderGroup(root, key, groups.get(key) ?? [], day)
  }

  private renderHead(root: HTMLElement, all: Task[], day: string): void {
    const head = root.createDiv('pm-reserves-head')
    const titles = head.createDiv('pm-reserves-titles')
    titles.createEl('h3', { cls: 'pm-reserves-title', text: t('reserve.register') })
    const summary = reserveSummary(all, day)
    titles.createDiv({
      cls: 'pm-reserves-count',
      text: t('reserve.count', {
        count: summary.open,
        declared: summary.declared,
        lifted: summary.lifted,
        late: summary.late
      })
    })
    const project = this.scope.primary
    if (project && all.length) {
      const report = head.createEl('button', { cls: 'pm-reserves-report' })
      setIcon(report.createSpan({ cls: 'pm-reserves-icon' }), 'file-signature')
      report.createSpan({ text: t('reserve.report') })
      explain(report, t('reserve.report'), t('tip.reserve.report'))
      report.addEventListener(
        'click',
        safeAsync(() => openReceptionReport(this.plugin, project, all))
      )
    }
  }

  /** The line a site walk types into, a reserve each Enter. */
  private renderQuickAdd(root: HTMLElement, project: Project): void {
    const bar = root.createDiv({ cls: 'pm-reserves-quick', attr: { tabindex: '0' } })
    const field = (cls: string, placeholder: string, value: string, set: (value: string) => void): HTMLInputElement => {
      const input = bar.createEl('input', { cls, attr: { type: 'text', placeholder } })
      input.value = value
      input.addEventListener('input', () => set(input.value))
      return input
    }
    const what = field('pm-reserves-what', t('reserve.quickWhat'), '', () => {})
    field('pm-reserves-where', t('reserve.location'), draft.location, (value) => (draft.location = value))
    field('pm-reserves-lot', t('reserve.lot'), draft.lot, (value) => (draft.lot = value))
    const company = field(
      'pm-reserves-company',
      t('reserve.company'),
      draft.company,
      (value) => (draft.company = value)
    )
    const list = bar.createEl('datalist', { attr: { id: 'pm-reserves-companies' } })
    for (const name of new ContactBook(readContacts(this.plugin.app, this.plugin.settings.peopleFolder)).names()) {
      list.createEl('option', { value: name })
    }
    company.setAttr('list', 'pm-reserves-companies')
    const severity = bar.createEl('select', { cls: 'dropdown' })
    for (const one of RESERVE_SEVERITIES) severity.createEl('option', { value: one, text: severityLabel(one) })
    severity.value = draft.severity
    severity.addEventListener('change', () => (draft.severity = severity.value as TaskReserve['severity']))
    const phase = bar.createEl('select', { cls: 'dropdown' })
    for (const one of RESERVE_PHASES) phase.createEl('option', { value: one, text: phaseLabel(one) })
    phase.value = draft.phase
    phase.addEventListener('change', () => (draft.phase = phase.value as ReservePhase))
    const days = bar.createEl('input', { cls: 'pm-reserves-days', attr: { type: 'number', min: '1', max: '365' } })
    days.value = String(draft.days)
    explain(days, t('reserve.quickDays'), t('tip.reserve.quickDays'))
    days.addEventListener('change', () => {
      const value = Math.round(Number(days.value))
      if (value > 0) draft.days = value
    })
    const photo = bar.createSpan({ cls: 'pm-reserves-photo-count' })
    const showPhotos = (): void => {
      photo.empty()
      setIcon(photo.createSpan({ cls: 'pm-reserves-icon' }), 'camera')
      photo.createSpan({ text: draft.photos.length ? String(draft.photos.length) : '' })
    }
    showPhotos()
    explain(photo, t('reserve.photoAdd'), t('tip.reserve.quickPhoto'))
    bar.addEventListener('paste', (event) => {
      const images = imagesOf(event.clipboardData?.items, 'photo')
      if (!images.length) return
      event.preventDefault()
      draft.photos.push(...images)
      showPhotos()
    })
    const add = bar.createEl('button', { cls: 'mod-cta', text: t('reserve.quickAdd') })
    explain(add, t('reserve.quickAdd'), t('tip.reserve.quickAdd'))
    const submit = safeAsync(async () => {
      const title = what.value.trim()
      if (!title) {
        what.focus()
        return
      }
      add.disabled = true
      await this.create(project, title)
      what.value = ''
      draft.photos = []
      this.render()
      this.container.querySelector<HTMLInputElement>('.pm-reserves-what')?.focus()
    })
    add.addEventListener('click', submit)
    what.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        submit()
      }
    })
  }

  private async create(project: Project, title: string): Promise<void> {
    const day = today().toString()
    const tasks = flattenTasks(project.tasks).map((flat) => flat.task)
    const task = makeTask({
      title,
      type: 'reserve',
      start: '',
      due: addDays(day, draft.days),
      assignees: draft.company.trim() ? [draft.company.trim()] : [],
      reserve: emptyReserve({
        number: nextReserveNumber(tasks),
        phase: draft.phase,
        location: draft.location.trim(),
        lot: draft.lot.trim(),
        severity: draft.severity,
        raisedOn: day
      })
    })
    await this.plugin.store.insertTask(project, task)
    if (draft.photos.length) {
      await addReservePhotos(this.plugin, project, task, draft.photos)
      await this.plugin.store.updateTask(project, task.id, { reserve: task.reserve })
    }
    new Notice(t('reserve.added', { number: reserveOf(task).number }))
    await this.onRefresh()
  }

  private renderFilters(root: HTMLElement): void {
    const bar = root.createDiv('pm-reserves-filters')
    const chips = <T extends string>(options: [T, string][], current: T, set: (value: T) => void): void => {
      const box = bar.createDiv('pm-reserves-chips')
      for (const [value, label] of options) {
        const chip = box.createEl('button', {
          cls: `pm-reserves-chip${value === current ? ' is-active' : ''}`,
          text: label,
          attr: { 'aria-pressed': String(value === current) }
        })
        chip.addEventListener('click', () => {
          set(value)
          this.render()
        })
      }
    }
    chips<StateFilter>(
      [
        ['all', t('reserve.filter.all')],
        ['open', stateLabel('open')],
        ['declared', stateLabel('declared')],
        ['lifted', stateLabel('lifted')],
        ['late', t('reserve.filter.late')]
      ],
      this.state,
      (value) => (this.state = value)
    )
    chips<'all' | ReservePhase>(
      [
        ['all', t('reserve.filter.allPhases')],
        ...RESERVE_PHASES.map((one): [ReservePhase, string] => [one, phaseLabel(one)])
      ],
      this.phase,
      (value) => (this.phase = value)
    )
    chips<GroupBy>(
      [
        ['company', t('reserve.by.company')],
        ['lot', t('reserve.by.lot')],
        ['location', t('reserve.by.location')]
      ],
      this.group,
      (value) => (this.group = value)
    )
  }

  private renderGroup(root: HTMLElement, key: string, tasks: Task[], day: string): void {
    const group = root.createDiv('pm-reserves-group')
    const head = group.createDiv('pm-reserves-group-head')
    head.createSpan({
      cls: 'pm-reserves-group-name',
      text:
        key ||
        (this.group === 'company'
          ? t('reserve.noCompany')
          : this.group === 'lot'
            ? t('reserve.noLot')
            : t('reserve.noLocation'))
    })
    const summary = reserveSummary(tasks, day)
    head.createSpan({
      cls: 'pm-reserves-group-count',
      text: t('reserve.count', {
        count: summary.open,
        declared: summary.declared,
        lifted: summary.lifted,
        late: summary.late
      })
    })
    if (this.group === 'company' && key && summary.open + summary.declared > 0) {
      const chase = head.createEl('button', { cls: 'pm-reserves-chase' })
      setIcon(chase.createSpan({ cls: 'pm-reserves-icon' }), 'mail')
      chase.createSpan({ text: t('reserve.chase') })
      explain(chase, t('reserve.chase'), t('tip.reserve.chase'))
      chase.addEventListener(
        'click',
        safeAsync(() => this.chase(key, tasks))
      )
    }
    for (const task of tasks) this.renderRow(group, task, day)
  }

  private renderRow(group: HTMLElement, task: Task, day: string): void {
    const reserve = reserveOf(task)
    const late = isLateReserve(task, day)
    const row = group.createDiv(`pm-reserve-row is-${reserve.state}${late ? ' is-late' : ''}`)
    row.createSpan({ cls: 'pm-reserve-number', text: reserve.number || '—' })
    const main = row.createDiv('pm-reserve-main')
    const title = main.createEl('a', { cls: 'pm-reserve-title', href: '#', text: task.title })
    title.addEventListener('click', (event) => {
      event.preventDefault()
      const project = this.scope.projectOf(task.id)
      if (project) openTaskModal(this.plugin, project, { task, onSave: () => this.onRefresh() })
    })
    const facts = main.createDiv('pm-reserve-facts')
    if (reserve.location && this.group !== 'location') facts.createSpan({ text: reserve.location })
    if (reserve.lot && this.group !== 'lot') facts.createSpan({ text: reserve.lot })
    if (this.group !== 'company' && reserveCompany(task)) facts.createSpan({ text: reserveCompany(task) })
    facts.createSpan({ cls: `pm-reserve-severity is-${reserve.severity}`, text: severityLabel(reserve.severity) })
    if (reserve.phase !== 'opr') facts.createSpan({ text: phaseLabel(reserve.phase) })
    if (task.due) {
      facts.createSpan({
        cls: late ? 'pm-reserve-late' : '',
        text: late
          ? t('reserve.lateSince', { date: formatDateShort(task.due) })
          : t('reserve.liftBy', { date: formatDateShort(task.due) })
      })
    }
    if (reserve.chases.length) {
      facts.createSpan({
        text: t('reserve.chased', {
          count: reserve.chases.length,
          date: formatDateShort(reserve.chases[reserve.chases.length - 1])
        })
      })
    }
    if (reserve.photos.length) {
      const photos = row.createEl('button', { cls: 'pm-reserve-photos-button' })
      setIcon(photos.createSpan({ cls: 'pm-reserves-icon' }), 'image')
      photos.createSpan({ text: String(reserve.photos.length) })
      explain(photos, t('reserve.photos'))
      photos.addEventListener(
        'click',
        safeAsync(async () => {
          const file = this.plugin.app.vault.getAbstractFileByPath(reserve.photos[0])
          if (file instanceof TFile) await this.plugin.app.workspace.getLeaf('tab').openFile(file)
        })
      )
    }
    // Its state, moved on with a click: open, said lifted, seen lifted, open again.
    const state = row.createEl('button', { cls: 'pm-reserve-state' })
    state.style.setProperty('--pm-reserve-color', STATE_COLOR[reserve.state])
    setIcon(state.createSpan({ cls: 'pm-reserves-icon' }), STATE_ICON[reserve.state])
    state.createSpan({ text: stateLabel(reserve.state) })
    explain(
      state,
      stateLabel(reserve.state),
      t('tip.reserve.state', { next: stateLabel(nextReserveState(reserve.state)) })
    )
    state.addEventListener(
      'click',
      safeAsync(() => this.move(task, nextReserveState(reserve.state)))
    )
  }

  private async move(task: Task, state: ReserveState): Promise<void> {
    const project = this.scope.projectOf(task.id)
    if (!project) return
    const patch: Partial<Task> = { reserve: moveReserve(reserveOf(task), state, today().toString()) }
    const status = statusForReserve(state, task.status, this.plugin.store.configFor(project).statuses)
    if (status) patch.status = status
    await this.plugin.store.updateTask(project, task.id, patch)
    await this.onRefresh()
  }

  /** The contractor's mail, opened in the mail client, and the chase noted on what it lists. */
  private async chase(company: string, tasks: Task[]): Promise<void> {
    const project = this.scope.primary
    const day = today().toString()
    const book = new ContactBook(readContacts(this.plugin.app, this.plugin.settings.peopleFolder))
    const to = book.emailsFor(company)
    const mail = reserveMail(
      tasks,
      { project: project?.title ?? '', askedBy: askedBy(day, 8), today: day },
      {
        date: formatDateLetter,
        subject: (title) => t('reserve.mail.subject', { project: title }),
        greeting: t('chase.mail.greeting'),
        intro: (title) => t('reserve.mail.intro', { project: title }),
        line: (one) =>
          [
            one.number,
            one.title,
            one.location,
            one.due
              ? one.late
                ? t('reserve.mail.lateSince', { date: one.due })
                : t('reserve.mail.liftBy', { date: one.due })
              : ''
          ]
            .filter(Boolean)
            .join(' — '),
        ask: (date) => t('reserve.mail.ask', { date }),
        closing: t('chase.mail.closing')
      }
    )
    window.open(
      `mailto:${to.map((one) => one.replace(/[?&#\s,]/g, '')).join(',')}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`
    )
    if (!to.length) new Notice(t('reserve.noMail', { company }))
    for (const task of tasks) {
      if (reserveOf(task).state === 'lifted') continue
      const owner = this.scope.projectOf(task.id)
      if (owner) {
        await this.plugin.store.updateTask(owner, task.id, { reserve: recordReserveChase(reserveOf(task), day) })
      }
    }
    await this.onRefresh()
  }
}
