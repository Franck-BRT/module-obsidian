import { projectLots } from '../../store/projectLots'
import { MarkdownRenderChild, Notice, setIcon, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import {
  CHANGE_LANGUAGE,
  dayShift,
  createAsTicket,
  createChange,
  createSource,
  findTicket,
  pickOption,
  replaceBlock,
  ticketSource,
  withEdits,
  withTicketEdits,
  type TicketCandidate,
  type TicketEdits,
  type CreateEdits,
  type CreateField,
  parseChange,
  requirementChange,
  type CreateContext,
  type CreateRow,
  ticketChange,
  verificationOptions,
  type ChangeSpec,
  type Option,
  type ReqChangeField,
  type ReqOptions,
  type TicketChangeField,
  type ValueProblem
} from '../../store/chat/chatChange'
import { diffWords } from '../../store/requirements/reqDiff'
import type { Requirement } from '../../store/requirements/Requirement'
import {
  applyCreate,
  applyToRequirement,
  applyToTicket,
  applyWithUndo,
  applyProject,
  previewTicketChange,
  projectTarget,
  undoChange,
  createLot,
  createPlace,
  createTarget,
  existingTicket,
  projectsLike,
  ticketTarget,
  type Applied,
  type TicketTarget,
  type Undone
} from '../../store/chat/applyChange'
import { typeConfigOf } from '../../store/TicketPalette'
import { confirmDialog } from '../../ui/ModalFactory'
import type { ScheduleMove } from '../../store/TaskSource'
import { fold } from '../../store/library/libraryDoc'
import { renderPersonPicker } from '../../ui/PersonPicker'
import { renderMultiSelect } from '../../ui/composites/properties/MultiSelectControl'
import { DependencyPickerModal } from '../../modals/DependencyPickerModal'
import type { Project, TaskType } from '../../types'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'
import { impactLabel, probabilityLabel } from '../risks/riskLabels'
import { readDecisionState } from '../../store/decision'
import { decisionStateLabel } from '../decisions/decisionLabels'
import { logTicketChange } from './historyLog'
import { undoKey } from '../../store/chat/chatUndo'
import { openRequirementModal } from '../requirements/RequirementModal'
import { reqLanguages, verificationLabel } from '../requirements/reqPalette'
import { explain } from '../../ui/explain'

/** The id a ticket not made yet goes by in the dependency picker: none of the vault's has it. */
const NEW_TICKET = 'pm-chat-new-ticket'

/**
 * A change the model proposed, drawn as a card with what would change and a button.
 *
 * Registered as the renderer of `pm-change` blocks, so the same card is drawn in the chat
 * panel and in the conversation's note, wherever it is read. It holds no state of its
 * own: whether the change is in place is read from the library or the plan every time it
 * is drawn, and it is drawn again whenever the vault moves — so a card applied from the
 * note says so in the panel too, and one applied by hand says so without being clicked.
 */
export function registerChangeBlock(plugin: PMPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor(CHANGE_LANGUAGE, (source, el, ctx) => {
    ctx.addChild(new ChangeCard(plugin, source, el, ctx.sourcePath))
  })
}

/** The reader's lists a requirement's fields are checked against. */
export function requirementOptions(plugin: PMPlugin): ReqOptions {
  const settings = plugin.settings
  const listed = (list: { id: string; label: string }[]): Option[] =>
    list.map((entry) => ({ id: entry.id, label: entry.label }))
  return {
    statuses: listed(settings.requirements.statuses),
    types: listed(settings.requirements.types),
    criticalities: listed(settings.priorities),
    verifications: verificationOptions(verificationLabel),
    languages: reqLanguages(settings)
  }
}

/** What taking a change back came to, said once. */
export function reportUndone(undone: Undone, name: string): void {
  const message = t('chat.change.undone', { name, count: undone.restored + undone.removed })
  const left = undone.conflicts.length
    ? `\n${t('chat.change.undoConflicts', { list: undone.conflicts.join(', ') })}`
    : ''
  new Notice(message + left, left ? 15000 : 5000)
}

/** Who a change applied from the chat is recorded as: the reader, where the vault knows them. */
function author(plugin: PMPlugin): string {
  return plugin.settings.globalTeamMembers[0] || 'llm'
}

function reqFieldLabel(field: ReqChangeField, lang: string | undefined): string {
  switch (field) {
    case 'text':
      return `${t('req.field.wording')}${lang ? ` (${lang.toUpperCase()})` : ''}`
    case 'title':
      return t('req.field.title')
    case 'rationale':
      return t('req.field.rationale')
    case 'source':
      return t('req.field.source')
    case 'status':
      return t('req.field.status')
    case 'type':
      return t('req.field.type')
    case 'criticality':
      return t('req.field.criticality')
    case 'verification':
      return t('req.field.verification')
  }
}

function ticketFieldLabel(field: TicketChangeField): string {
  switch (field) {
    case 'title':
      return t('chat.change.field.title')
    case 'status':
      return t('chat.change.field.status')
    case 'priority':
      return t('chat.change.field.priority')
    case 'start':
      return t('chat.change.field.start')
    case 'due':
      return t('chat.change.field.due')
    case 'progress':
      return t('chat.change.field.progress')
    case 'assignees':
      return t('chat.change.field.assignees')
    case 'after':
      return t('chat.change.field.after')
    case 'description':
      return t('chat.change.field.description')
    case 'parent':
      return t('chat.change.field.parent')
    case 'probability':
      return t('risk.probability')
    case 'impact':
      return t('risk.impact')
    case 'mitigation':
      return t('risk.mitigation')
    case 'decision':
      return t('decision.state')
    case 'decidedOn':
      return t('decision.date')
    case 'decidedBy':
      return t('decision.decidedBy')
    case 'rationale':
      return t('decision.rationale')
    case 'affects':
      return t('decision.affects')
  }
}

/** A risk's level as the card says it — « 3 · Probable » —; any other value as it is. */
function levelText(field: string, value: string): string {
  const state = field === 'decision' ? readDecisionState(value) : null
  if (state) return decisionStateLabel(state)
  const level = Number(value)
  if (!value || !Number.isInteger(level)) return value
  if (field === 'probability') return `${level} · ${probabilityLabel(level)}`
  if (field === 'impact') return `${level} · ${impactLabel(level)}`
  return value
}

function problemText(problem: ValueProblem, allowed: string[] | undefined): string {
  const list = allowed?.join(', ') ?? ''
  switch (problem) {
    case 'empty':
      return t('chat.change.empty')
    case 'unknown':
      return t('chat.change.unknown', { list })
    case 'date':
      return t('chat.change.date')
    case 'order':
      return t('chat.change.order')
    case 'progress':
      return t('chat.change.progress')
    case 'lang':
      return t('chat.change.lang', { list })
    case 'project':
      return t('chat.change.noProject', { name: list })
    case 'parent':
      return t('chat.change.noParent', { title: list })
    case 'after':
      return t('chat.change.noAfter', { title: list })
  }
}

function createFieldLabel(field: CreateRow['field']): string {
  switch (field) {
    case 'type':
      return t('chat.change.field.type')
    case 'parent':
      return t('chat.change.field.parent')
    case 'after':
      return t('chat.change.field.after')
    default:
      return ticketFieldLabel(field)
  }
}

/** The ticket types in the reader's words, from the type palette. */
function typeLabel(type: string): string {
  return typeConfigOf(type as TaskType).label
}

/** Where a card stands: its change to be made or already made, or why it cannot be. */
/** How many moved tickets are shown open; more are folded under their count. */
const MOVES_OPEN = 6

/** A ticket's dates, as one span: its start to its end, or the one it has. */
function span(dates: { start: string; due: string }): string {
  if (dates.start && dates.due && dates.start !== dates.due) return `${dates.start} – ${dates.due}`
  return dates.due || dates.start || '—'
}

type CardState = { ok: true; applied: boolean } | { ok: false; problem: ValueProblem; allowed?: string[] }

class ChangeCard extends MarkdownRenderChild {
  private timer: number | null = null
  /** Bumped at every draw: a draw that finds a newer one started drops its own result. */
  private generation = 0
  private busy = false
  /** The project the reader chose, a programme having been named, by its path. */
  private chosen: string | null = null
  /** The lot the reader chose for a new ticket, by its title; '' for the top of the project. */
  private chosenParent: string | null = null

  /** The block as it was first read here: what an edit made since is found by. */
  private original: string
  /** Whether the reader is changing the proposed ticket before making it. */
  private editing = false
  /** What the reader has typed so far, kept while the form is drawn again. */
  private draft: CreateEdits | null = null

  constructor(
    private plugin: PMPlugin,
    private source: string,
    container: HTMLElement,
    private sourcePath = ''
  ) {
    super(container)
    this.original = source
    // Changed by the reader already — here or where the same proposal is drawn —: as changed.
    this.source = plugin.changeEdits.get(source.trim()) ?? source
  }

  onload(): void {
    void this.draw()
    // Applied or taken back from the reply's buttons: whether it can be undone changed.
    this.register(
      this.plugin.chatUndo.onChange(() => {
        if (!this.busy) void this.draw()
      })
    )
    this.register(
      this.plugin.index.onChange(() => {
        if (this.busy) return
        if (this.timer !== null) window.clearTimeout(this.timer)
        this.timer = window.setTimeout(() => {
          this.timer = null
          void this.draw()
        }, 250)
      })
    )
  }

  onunload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  private async draw(): Promise<void> {
    const generation = ++this.generation
    // What can be undone is read from disk the first time.
    await this.plugin.chatUndo.ready()
    if (generation !== this.generation) return
    const read = parseChange(this.source)
    if ('problem' in read) {
      this.paint((card) => this.renderUnreadable(card, read.problem))
      return
    }
    const spec = read.spec
    if (spec.kind === 'requirement') {
      const requirement = this.plugin.index.requirementById(spec.target)
      this.paint((card) => this.renderRequirement(card, spec, requirement))
      return
    }
    if (spec.kind === 'project') {
      this.paint((card) => this.renderProject(card, spec))
      return
    }
    if (spec.kind === 'create') {
      const placed = this.draft ? withEdits(this.placed(spec), this.draft) : this.placed(spec)
      const target = await createTarget(this.plugin.index, this.plugin.store, placed, typeLabel)
      // A programme named, and several of its projects possible: the reader says which.
      const place = target ? null : await createPlace(this.plugin.index, this.plugin.store, placed)
      if (generation !== this.generation) return
      if (place && 'choices' in place) {
        this.paint((card) =>
          this.renderCreateChoice(card, spec, place.choices, t('chat.change.pickProject', { program: place.via }))
        )
        return
      }
      // A project the vault does not have: the reader says which, the likeliest first.
      if (target && this.editing) {
        this.paint((card) => this.renderCreateForm(card, placed, target))
        return
      }
      if (!target && !place) {
        const choices = projectsLike(this.plugin.index, spec.project)
        if (choices.length) {
          this.paint((card) =>
            this.renderCreateChoice(
              card,
              spec,
              choices,
              spec.project.trim()
                ? t('chat.change.pickProjectUnknown', { name: spec.project })
                : t('chat.change.pickProjectNone')
            )
          )
          return
        }
      }
      const meant = target ? await this.meantChange(placed, target.context) : null
      if (generation !== this.generation) return
      this.paint((card) => this.renderCreate(card, placed, target, meant))
      return
    }
    const target = await ticketTarget(this.plugin.index, this.plugin.store, spec)
    if (generation !== this.generation) return
    if (this.editing && !('problem' in target)) {
      this.paint((card) => this.renderTicketForm(card, spec, target))
      return
    }
    // What the scheduling would move besides it, seen before the click.
    const moves = await previewTicketChange(this.plugin.index, this.plugin.store, spec).catch(() => [])
    if (generation !== this.generation) return
    this.paint((card) => this.renderTicket(card, spec, target, moves))
  }

  /**
   * A ticket proposed as new that the project holds already, with fields it does not have:
   * the change to it the model more likely meant — a proposal from before replies were
   * read for that, or a ticket made since with other dates. Null when there is nothing to
   * change, a ticket made from this very card among others.
   */
  private async meantChange(
    spec: Extract<ChangeSpec, { kind: 'create' }>,
    context: CreateContext
  ): Promise<Extract<ChangeSpec, { kind: 'ticket' }> | null> {
    // Whatever else it says — a type or a lot that does not read —: its title is what counts.
    if (!context.tickets.some((ticket) => fold(ticket.title.trim()) === fold(spec.title.trim()))) return null
    const existing = await existingTicket(this.plugin.index, this.plugin.store, spec)
    const meant = existing ? createAsTicket(spec, existing) : null
    if (!meant) return null
    const target = await ticketTarget(this.plugin.index, this.plugin.store, meant)
    if ('problem' in target) return null
    const change = ticketChange(meant, target.task, target.lists)
    return change.ok && !change.applied ? meant : null
  }

  /** A ticket to create: where it goes, what it will say, and a button that makes it. */
  private renderCreate(
    card: HTMLElement,
    spec: Extract<ChangeSpec, { kind: 'create' }>,
    target: { project: Project; context: CreateContext; via?: string } | null,
    meant: Extract<ChangeSpec, { kind: 'ticket' }> | null = null
  ): void {
    card.addClass('pm-change--create')
    if (!target) {
      this.head(card, 'square-plus', spec.title, null, t('chat.change.newTitle'))
      this.problem(card, problemText('project', [spec.project]))
      return
    }
    const { project } = target
    this.head(
      card,
      'square-plus',
      `${spec.title} · ${project.title}`,
      safeAsync(() => this.plugin.router.openProjectLink(project.filePath)),
      t('chat.change.newTitle')
    )
    // The programme named stands for this project of it: said, so the reader can tell.
    if (target.via) {
      card.createDiv({
        cls: 'pm-change-note',
        text: t('chat.change.viaProgram', { program: target.via, project: project.title })
      })
    }
    const resolved = createChange(spec, target.context)
    if (resolved.ok) {
      // Everything is new: a field and its value a line, rather than a before and an after.
      const grid = card.createDiv('pm-change-grid')
      for (const row of resolved.rows) {
        this.body(grid, createFieldLabel(row.field), { before: '', after: levelText(row.field, row.after) }, false)
      }
    }
    this.why(card, spec.why)
    // There already, and not as proposed: said, with the way to make it the change it was.
    if (meant) {
      const fix = card.createDiv('pm-change-fix')
      fix.createDiv({ cls: 'pm-change-note', text: t('chat.change.exists') })
      const button = fix.createEl('button', { cls: 'mod-cta', text: t('chat.change.asModification') })
      explain(button, t('chat.change.asModification'), t('tip.chat.change.asModification'))
      button.addEventListener(
        'click',
        safeAsync(async () => {
          await this.keepSource(ticketSource(meant))
          await this.draw()
        })
      )
      return
    }
    this.footer(card, resolved, () => this.applyCreate(spec), {
      apply: t('chat.change.create'),
      done: t('chat.change.created')
    })
    if (!resolved.ok && resolved.problem === 'parent') this.renderParentFix(card, spec, target)
    // Not made yet: its fields can be changed before it is.
    if (!(resolved.ok && resolved.applied)) {
      const foot = card.querySelector('.pm-change-foot') ?? card.createDiv('pm-change-foot')
      const edit = foot.createEl('button', { text: t('chat.change.edit') })
      explain(edit, t('chat.change.edit'), t('tip.chat.change.edit'))
      setIcon(edit.createSpan({ cls: 'pm-change-edit-icon' }), 'pencil')
      edit.prepend(edit.lastChild as Node)
      edit.addEventListener('click', () => {
        this.editing = true
        void this.draw()
      })
    }
  }

  /**
   * The proposed ticket as a form: every field it can be given, as proposed, to be changed
   * before it is made. Kept, the proposal is written back into the conversation, so it
   * reads as changed wherever it is drawn, and later.
   */
  private renderCreateForm(
    card: HTMLElement,
    spec: Extract<ChangeSpec, { kind: 'create' }>,
    target: { project: Project; context: CreateContext }
  ): void {
    card.addClass('pm-change--create', 'pm-change--editing')
    this.head(card, 'square-pen', spec.title, null, t('chat.change.editTitle'))
    const form = card.createDiv('pm-change-form')
    const context = target.context
    const given = (field: CreateField): string => {
      const found = spec.fields.find((change) => change.field === field)
      if (!found) return ''
      const shown = (value: unknown): string =>
        typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
      return Array.isArray(found.value) ? found.value.map(shown).filter(Boolean).join(', ') : shown(found.value)
    }
    const row = (label: string): HTMLElement => {
      const line = form.createEl('label', { cls: 'pm-change-form-row' })
      line.createSpan({ cls: 'pm-change-form-label', text: label })
      return line
    }
    const input = (label: string, value: string, type = 'text', placeholder = ''): HTMLInputElement => {
      const el = row(label).createEl('input', { attr: { type, placeholder } })
      el.value = value
      return el
    }
    const select = (label: string, options: [string, string][], value: string): HTMLSelectElement => {
      const el = row(label).createEl('select', { cls: 'dropdown' })
      for (const [key, text] of options) el.createEl('option', { value: key, text })
      el.value = options.some(([key]) => key === value) ? value : (options[0]?.[0] ?? '')
      return el
    }
    const chosen = (list: Option[], field: CreateField): string => pickOption(list, given(field))?.label ?? ''
    const fallback = t('chat.change.defaultValue')

    const title = input(t('chat.change.field.title'), spec.title)
    const projects = projectsLike(this.plugin.index, target.project.title)
    const project = select(
      t('chat.change.field.project'),
      projects.map((each): [string, string] => [each.path, each.title]),
      target.project.filePath
    )
    const lots = context.tickets.filter((ticket) => ticket.type === 'phase')
    const parentNow = context.tickets.find((ticket) => fold(ticket.title) === fold(spec.parent))?.title ?? ''
    const parent = select(
      t('chat.change.field.parent'),
      [
        ['', t('chat.change.atRoot')],
        ...lots.map((lot): [string, string] => [lot.title, lot.title]),
        ...(parentNow && !lots.some((lot) => lot.title === parentNow)
          ? [[parentNow, parentNow] as [string, string]]
          : [])
      ],
      parentNow
    )
    const labels = (list: Option[]): [string, string][] => [
      ['', fallback],
      ...list.map((option): [string, string] => [option.label, option.label])
    ]
    const type = select(t('chat.change.field.type'), labels(context.types), chosen(context.types, 'type'))
    const status = select(t('chat.change.field.status'), labels(context.statuses), chosen(context.statuses, 'status'))
    const priority = select(
      t('chat.change.field.priority'),
      labels(context.priorities),
      chosen(context.priorities, 'priority')
    )
    const start = input(t('chat.change.field.start'), given('start'), 'date')
    const due = input(t('chat.change.field.due'), given('due'), 'date')
    const progress = input(t('chat.change.field.progress'), given('progress').replace(/\s*%$/, ''), 'number')
    progress.min = '0'
    progress.max = '100'
    const listed = (field: CreateField): string[] => {
      const found = spec.fields.find((change) => change.field === field)?.value
      const list = Array.isArray(found) ? found : typeof found === 'string' ? found.split(/[,;]/) : []
      return list.map((one) => (typeof one === 'string' ? one.trim() : '')).filter(Boolean)
    }
    const people = listed('assignees')
    this.peopleField(
      row(t('chat.change.field.assignees')).createDiv('pm-change-form-picker'),
      target.project.filePath,
      target.project.teamMembers,
      people
    )
    const candidates = context.candidates
    const upstream = listed('after').map((one) => {
      const found = findTicket(candidates, one, target.project.title)
      return 'found' in found ? found.found.id : one
    })
    this.followsField(
      row(t('chat.change.field.after')).createDiv('pm-change-form-picker'),
      NEW_TICKET,
      target.project,
      candidates,
      upstream
    )
    const description = row(t('chat.change.field.description')).createEl('textarea', {
      cls: 'pm-change-form-text',
      attr: { rows: 4 }
    })
    description.value = given('description')
    // Written by title where that names it alone — the proposal reads as written —, by id otherwise.
    const followed = (): string[] =>
      upstream.map((id) => {
        const found = candidates.find((candidate) => candidate.id === id)
        if (!found) return id
        const byTitle = findTicket(candidates, found.title, target.project.title)
        return 'found' in byTitle && byTitle.found.id === id ? found.title : id
      })

    // The project by its name where no other has it — the proposal reads as written —, by its path otherwise.
    const projectName = (path: string): string => {
      const name = projects.find((each) => each.path === path)?.title ?? ''
      return name && projects.filter((each) => fold(each.title) === fold(name)).length === 1 ? name : path
    }
    const collect = (): CreateEdits => ({
      title: title.value,
      project: projectName(project.value),
      parent: parent.value,
      fields: {
        type: type.value,
        status: status.value,
        priority: priority.value,
        start: start.value,
        due: due.value,
        progress: progress.value,
        assignees: [...people],
        after: followed(),
        description: description.value
      }
    })
    // Another project: its lots, and its lists, drawn — what was typed kept.
    project.addEventListener('change', () => {
      this.draft = { ...collect(), parent: '' }
      void this.draw()
    })

    const foot = card.createDiv('pm-change-foot')
    const save = foot.createEl('button', { cls: 'mod-cta', text: t('chat.change.saveEdits') })
    explain(save, t('chat.change.saveEdits'), t('tip.chat.change.saveEdits'))
    save.addEventListener(
      'click',
      safeAsync(async () => {
        save.disabled = true
        const base = parseChange(this.source)
        if (!('spec' in base) || base.spec.kind !== 'create') return
        await this.keepSource(createSource(withEdits(base.spec, collect())))
        this.editing = false
        this.draft = null
        this.chosen = null
        this.chosenParent = null
        await this.draw()
      })
    )
    const cancel = foot.createEl('button', { text: t('common.cancel') })
    cancel.addEventListener('click', () => {
      this.editing = false
      this.draft = null
      void this.draw()
    })
  }

  /**
   * The proposal as the reader changed it, kept: for the cards drawing it now, and written
   * over the block in the conversation's note, so it is drawn changed when read again.
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

  /**
   * A lot the new ticket was to go under, missing: made here in one click, another one
   * chosen, or the top of the project — rather than a dead end.
   */
  private renderParentFix(
    card: HTMLElement,
    spec: Extract<ChangeSpec, { kind: 'create' }>,
    target: { project: Project; context: CreateContext }
  ): void {
    const fix = card.createDiv('pm-change-fix')
    const missing = !target.context.tickets.some((ticket) => fold(ticket.title) === fold(spec.parent))
    if (missing && spec.parent.trim()) {
      const make = fix.createEl('button', {
        cls: 'mod-cta',
        text: t('chat.change.createLot', { title: spec.parent.trim() })
      })
      explain(make, t('chat.change.createLot', { title: spec.parent.trim() }), t('tip.chat.change.createLot'))
      make.addEventListener(
        'click',
        safeAsync(async () => {
          make.disabled = true
          this.busy = true
          try {
            await createLot(this.plugin.store, target.project.filePath, spec.parent)
            this.chosenParent = null
          } finally {
            this.busy = false
            await this.draw()
          }
        })
      )
    }
    fix.createSpan({ cls: 'pm-change-fix-label', text: t('chat.change.pickParent') })
    const select = fix.createEl('select', { cls: 'dropdown' })
    select.createEl('option', { value: '', text: t('chat.change.atRoot') })
    const lots = target.context.tickets.filter((ticket) => ticket.type === 'phase')
    for (const lot of lots) select.createEl('option', { value: lot.title, text: lot.title })
    const place = fix.createEl('button', { text: t('chat.change.pickParentButton') })
    explain(place, t('chat.change.pickParentButton'), t('tip.chat.change.pickParentButton'))
    place.addEventListener('click', () => {
      this.chosenParent = select.value
      void this.draw()
    })
  }

  /** The new ticket as the reader placed it: in the project and under the lot they chose. */
  private placed(spec: Extract<ChangeSpec, { kind: 'create' }>): Extract<ChangeSpec, { kind: 'create' }> {
    return {
      ...spec,
      ...(this.chosen ? { project: this.chosen } : {}),
      ...(this.chosenParent !== null ? { parent: this.chosenParent } : {})
    }
  }

  /** Where a new ticket goes, asked: a programme named with several projects, or a project the vault lacks. */
  private renderCreateChoice(
    card: HTMLElement,
    spec: Extract<ChangeSpec, { kind: 'create' }>,
    choices: { path: string; title: string }[],
    question: string
  ): void {
    card.addClass('pm-change--create')
    this.head(card, 'square-plus', spec.title, null, t('chat.change.newTitle'))
    card.createDiv({ cls: 'pm-change-note', text: question })
    const foot = card.createDiv('pm-change-foot')
    const select = foot.createEl('select', { cls: 'dropdown' })
    for (const choice of choices) select.createEl('option', { value: choice.path, text: choice.title })
    const button = foot.createEl('button', { cls: 'mod-cta', text: t('chat.change.pickProjectButton') })
    explain(button, t('chat.change.pickProjectButton'), t('tip.chat.change.pickProjectButton'))
    button.addEventListener('click', () => {
      this.chosen = select.value
      void this.draw()
    })
    this.why(card, spec.why)
  }

  private paint(fill: (card: HTMLElement) => void): void {
    this.containerEl.empty()
    fill(this.containerEl.createDiv('pm-change'))
  }

  private head(
    card: HTMLElement,
    icon: string,
    name: string,
    open: (() => void) | null,
    kind = t('chat.change.title')
  ): void {
    const head = card.createDiv('pm-change-head')
    setIcon(head.createSpan({ cls: 'pm-change-icon' }), icon)
    head.createSpan({ cls: 'pm-change-kind', text: kind })
    if (open) {
      const link = head.createEl('a', { cls: 'pm-change-target', text: name })
      link.addEventListener('click', open)
    } else head.createSpan({ cls: 'pm-change-target', text: name })
  }

  private renderUnreadable(card: HTMLElement, problem: 'unreadable' | 'target' | 'field'): void {
    card.addClass('pm-change--problem')
    this.head(card, 'circle-alert', '', null)
    card.createDiv({
      cls: 'pm-change-problem',
      text:
        problem === 'field'
          ? t('chat.change.badField')
          : problem === 'target'
            ? t('chat.change.noTarget')
            : t('chat.change.unreadable')
    })
    card.createEl('pre', { cls: 'pm-change-source', text: this.source.trim() })
  }

  private renderRequirement(
    card: HTMLElement,
    spec: Extract<ChangeSpec, { kind: 'requirement' }>,
    requirement: Requirement | null
  ): void {
    if (!requirement) {
      this.head(card, 'list-checks', spec.target, null)
      this.problem(card, t('chat.change.noRequirement', { id: spec.target }))
      return
    }
    const path = requirement.filePath ?? ''
    this.head(
      card,
      'list-checks',
      requirement.title ? `${requirement.id} — ${requirement.title}` : requirement.id,
      path ? safeAsync(() => openRequirementModal(this.plugin, path)) : null
    )
    const resolved = requirementChange(spec, requirement, requirementOptions(this.plugin))
    const lang = resolved.ok ? resolved.change.lang : undefined
    this.body(
      card,
      reqFieldLabel(spec.field, lang),
      resolved.ok ? resolved : null,
      ['text', 'title', 'rationale', 'source'].includes(spec.field)
    )
    this.why(card, spec.why)
    this.footer(card, resolved, () => this.applyRequirement(spec, path))
  }

  private renderTicket(
    card: HTMLElement,
    spec: Extract<ChangeSpec, { kind: 'ticket' }>,
    target: TicketTarget | { problem: 'none' | 'ambiguous'; count: number },
    moves: ScheduleMove[] = []
  ): void {
    if ('problem' in target) {
      this.head(card, 'square-check-big', spec.target, null)
      // Deleted — from here, most likely —: nowhere to be found is what was asked.
      if (spec.action === 'delete' && target.problem === 'none') {
        this.why(card, spec.why)
        card.addClass('pm-change--done')
        const foot = card.createDiv('pm-change-foot')
        setIcon(foot.createSpan({ cls: 'pm-change-state-icon' }), 'check')
        foot.createSpan({ cls: 'pm-change-state', text: t('chat.change.deletedOrGone') })
        return
      }
      this.problem(
        card,
        target.problem === 'none'
          ? t('chat.change.noTicket', { title: spec.target })
          : t('chat.change.ambiguous', { title: spec.target, count: target.count })
      )
      return
    }
    const { project, task } = target
    const path = task.filePath
    this.head(
      card,
      'square-check-big',
      `${task.title} · ${project.title}`,
      path ? safeAsync(() => this.app().workspace.openLinkText(path, '', false)) : null
    )
    const resolved = ticketChange(spec, task, target.lists)
    if (resolved.ok) {
      for (const row of resolved.rows) {
        this.body(
          card,
          ticketFieldLabel(row.field),
          { before: levelText(row.field, row.before), after: levelText(row.field, row.after) },
          row.field === 'title' ||
            row.field === 'description' ||
            row.field === 'mitigation' ||
            row.field === 'rationale'
        )
      }
    } else this.body(card, ticketFieldLabel(resolved.field), null, false)
    // What becomes of the ticket itself, said as plainly as a field.
    if (spec.action) {
      card.toggleClass('pm-change--delete', spec.action === 'delete')
      card.createDiv({
        cls: 'pm-change-action',
        text: spec.action === 'archive' ? t('chat.change.actionArchive') : t('chat.change.actionDelete')
      })
    }
    if (moves.length) this.renderMoves(card, moves, target.project.title)
    this.why(card, spec.why)
    this.footer(
      card,
      resolved,
      () => this.applyTicket(spec),
      spec.action === 'delete'
        ? { apply: t('chat.change.delete'), done: t('chat.change.done'), warning: true }
        : spec.action === 'archive'
          ? { apply: t('chat.change.archive'), done: t('chat.change.archived') }
          : undefined
    )
    if (!(resolved.ok && resolved.applied) && spec.action !== 'delete') this.editButton(card)
  }

  /**
   * A project or a programme to make in the plan: its kind, where it goes — under its
   * programme, or where projects are kept —, what it is for, and a button that makes it.
   */
  private renderProject(card: HTMLElement, spec: Extract<ChangeSpec, { kind: 'project' }>): void {
    card.addClass('pm-change--create')
    const target = projectTarget(this.plugin.index, spec)
    const existing = 'problem' in target ? null : target.existing
    this.head(
      card,
      spec.program ? 'layers' : 'folder-kanban',
      spec.title,
      existing ? safeAsync(() => this.plugin.router.openProjectLink(existing.path)) : null,
      spec.program ? t('chat.change.newProgram') : t('chat.change.newProject')
    )
    const grid = card.createDiv('pm-change-grid')
    const parent = 'problem' in target ? spec.parent : (target.parent?.title ?? '')
    this.body(
      grid,
      t('chat.change.field.where'),
      { before: '', after: parent || this.plugin.newProjectFolder(null) },
      false
    )
    if (spec.description.trim()) {
      this.body(grid, t('chat.change.field.description'), { before: '', after: spec.description.trim() }, true)
    }
    this.why(card, spec.why)
    if ('problem' in target) {
      this.problem(
        card,
        t('chat.change.noProgram', {
          name: spec.parent,
          list: target.allowed.join(', ') || t('chat.changeProjectNone')
        })
      )
      return
    }
    const resolved: CardState = { ok: true, applied: !!existing }
    this.footer(card, resolved, () => this.applyProject(spec), {
      apply: spec.program ? t('chat.change.createProgram') : t('chat.change.createProject'),
      done: t('chat.change.created')
    })
  }

  private async applyProject(spec: Extract<ChangeSpec, { kind: 'project' }>): Promise<void> {
    const done = await applyProject(
      this.plugin.index,
      this.plugin.store,
      spec,
      (parent) => this.plugin.newProjectFolder(parent),
      projectLots(this.plugin.settings)
    )
    this.report(done, spec.title)
    if (done.ok && done.changed) {
      // Seen at once, the way the "new project" window opens what it made.
      const made = projectTarget(this.plugin.index, spec)
      if (!('problem' in made) && made.existing) await this.plugin.router.openProjectLink(made.existing.path)
    }
  }

  /**
   * The tickets the scheduling would move with this one, each with its dates before and
   * after and by how many days; folded past a few, its project named when it is another.
   */
  private renderMoves(card: HTMLElement, moves: ScheduleMove[], projectTitle: string): void {
    const box = card.createEl('details', { cls: 'pm-change-moves' })
    if (moves.length <= MOVES_OPEN) box.setAttr('open', '')
    box.createEl('summary', { text: t('chat.change.moves', { count: moves.length }) })
    const list = box.createEl('ul')
    for (const move of moves) {
      const item = list.createEl('li')
      item.createSpan({
        cls: 'pm-change-move-title',
        text: move.projectTitle === projectTitle ? move.title : `${move.title} · ${move.projectTitle}`
      })
      item.createSpan({
        cls: 'pm-change-move-dates',
        text: ` ${span(move.before)} → ${span(move.after)}`
      })
      const shift = dayShift(move.before, move.after)
      if (shift) {
        item.createSpan({
          cls: `pm-change-move-shift ${shift > 0 ? 'is-later' : 'is-earlier'}`,
          text: ` (${shift > 0 ? '+' : '−'}${t('chat.change.days', { count: Math.abs(shift) })})`
        })
      }
    }
  }

  /** The way into the form, beside the card's own button: its fields changed before it is applied. */
  private editButton(card: HTMLElement): void {
    const foot = card.querySelector('.pm-change-foot') ?? card.createDiv('pm-change-foot')
    const edit = foot.createEl('button', { text: t('chat.change.edit') })
    explain(edit, t('chat.change.edit'), t('tip.chat.change.edit'))
    setIcon(edit.createSpan({ cls: 'pm-change-edit-icon' }), 'pencil')
    edit.prepend(edit.lastChild as Node)
    edit.addEventListener('click', () => {
      this.editing = true
      void this.draw()
    })
  }

  /** People, picked as everywhere else: the team first, the vault's person notes as one types. */
  private peopleField(container: HTMLElement, sourcePath: string, team: string[], people: string[]): void {
    renderPersonPicker({
      container,
      plugin: this.plugin,
      sourcePath,
      extra: () => team,
      addLabel: t('task.assign'),
      selected: () => people,
      add: (value) => {
        if (!people.includes(value)) people.push(value)
      },
      remove: (value) => {
        people.splice(people.indexOf(value), 1)
      }
    })
  }

  /** What a ticket follows, chosen in the plan's own shape — any ticket of the vault —, by id. */
  private followsField(
    container: HTMLElement,
    ticket: string,
    project: Project,
    candidates: TicketCandidate[],
    upstream: string[]
  ): void {
    renderMultiSelect({
      container,
      addLabel: t('task.addDependency'),
      addLabelMore: t('task.addAnother'),
      selected: () => upstream,
      options: () => [],
      labelFor: (id) => {
        const found = candidates.find((candidate) => candidate.id === id)
        if (!found) return id
        return found.projectPath === project.filePath ? found.title : `${found.title} · ${found.projectTitle}`
      },
      openPicker: (refresh) => {
        new DependencyPickerModal(this.plugin.app, {
          plugin: this.plugin,
          taskId: ticket,
          homeProject: project.filePath,
          selected: [...upstream],
          onConfirm: (ids) => {
            upstream.splice(0, upstream.length, ...ids)
            refresh()
          }
        }).open()
      },
      add: (id) => {
        if (!upstream.includes(id)) upstream.push(id)
      },
      remove: (id) => {
        upstream.splice(upstream.indexOf(id), 1)
      }
    })
  }

  /**
   * A proposed change to a ticket as a form: every field it can change, as proposed where
   * the model proposed it and as the ticket says now elsewhere. Kept, the proposal holds
   * the fields that differ from the ticket — any of them, not only those proposed.
   */
  private renderTicketForm(
    card: HTMLElement,
    spec: Extract<ChangeSpec, { kind: 'ticket' }>,
    target: TicketTarget
  ): void {
    const { project, task, lists } = target
    card.addClass('pm-change--editing')
    this.head(card, 'square-pen', `${task.title} · ${project.title}`, null, t('chat.change.editTitle'))
    const form = card.createDiv('pm-change-form')
    const row = (label: string): HTMLElement => {
      const line = form.createEl('label', { cls: 'pm-change-form-row' })
      line.createSpan({ cls: 'pm-change-form-label', text: label })
      return line
    }
    const proposed = (field: TicketChangeField): unknown => spec.changes.find((change) => change.field === field)?.value
    const shown = (value: unknown): string =>
      typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
    const listOf = (value: unknown): string[] =>
      (Array.isArray(value) ? value.map(shown) : shown(value).split(/[,;]/)).map((one) => one.trim()).filter(Boolean)
    const input = (label: string, value: string, type = 'text'): HTMLInputElement => {
      const el = row(label).createEl('input', { attr: { type } })
      el.value = value
      return el
    }
    const select = (label: string, list: Option[], current: string, field: TicketChangeField): HTMLSelectElement => {
      const el = row(label).createEl('select', { cls: 'dropdown' })
      for (const option of list) el.createEl('option', { value: option.id, text: option.label })
      el.value = pickOption(list, shown(proposed(field)))?.id ?? current
      return el
    }
    const valueOr = (field: TicketChangeField, current: string): string => shown(proposed(field)) || current

    const title = input(t('chat.change.field.title'), valueOr('title', task.title))
    const status = select(t('chat.change.field.status'), lists.statuses, task.status, 'status')
    const priority = select(t('chat.change.field.priority'), lists.priorities, task.priority, 'priority')
    const start = input(t('chat.change.field.start'), valueOr('start', task.start), 'date')
    const due = input(t('chat.change.field.due'), valueOr('due', task.due), 'date')
    const progress = input(
      t('chat.change.field.progress'),
      valueOr('progress', String(task.progress)).replace(/\s*%$/, ''),
      'number'
    )
    progress.min = '0'
    progress.max = '100'
    const people = proposed('assignees') !== undefined ? listOf(proposed('assignees')) : [...task.assignees]
    this.peopleField(
      row(t('chat.change.field.assignees')).createDiv('pm-change-form-picker'),
      task.filePath ?? project.filePath,
      project.teamMembers,
      people
    )
    const upstream =
      proposed('after') !== undefined
        ? listOf(proposed('after')).map((one) => {
            const found = findTicket(lists.candidates, one, project.title)
            return 'found' in found ? found.found.id : one
          })
        : [...task.dependencies]
    this.followsField(
      row(t('chat.change.field.after')).createDiv('pm-change-form-picker'),
      task.id,
      project,
      lists.candidates,
      upstream
    )

    const foot = card.createDiv('pm-change-foot')
    const save = foot.createEl('button', { cls: 'mod-cta', text: t('chat.change.saveEdits') })
    explain(save, t('chat.change.saveEdits'), t('tip.chat.change.saveEdits'))
    save.addEventListener(
      'click',
      safeAsync(async () => {
        const label = (list: Option[], id: string): string => list.find((option) => option.id === id)?.label ?? id
        const sameSet = (a: string[], b: string[]): boolean =>
          a.length === b.length && a.every((one) => b.includes(one))
        // What differs from the ticket as it is: that is the change.
        const edits: TicketEdits = {}
        if (title.value.trim() && title.value.trim() !== task.title) edits.title = title.value
        if (status.value !== task.status) edits.status = label(lists.statuses, status.value)
        if (priority.value !== task.priority) edits.priority = label(lists.priorities, priority.value)
        if (start.value !== task.start && start.value) edits.start = start.value
        if (due.value !== task.due && due.value) edits.due = due.value
        if (progress.value !== '' && Number(progress.value) !== task.progress) edits.progress = progress.value
        if (!sameSet(people, task.assignees)) edits.assignees = [...people]
        if (!sameSet(upstream, task.dependencies)) {
          edits.after = upstream.map((id) => {
            const found = lists.candidates.find((candidate) => candidate.id === id)
            if (!found) return id
            const byTitle = findTicket(lists.candidates, found.title, project.title)
            return 'found' in byTitle && byTitle.found.id === id ? found.title : id
          })
        }
        if (!Object.keys(edits).length) {
          new Notice(t('chat.change.noEdits'))
          return
        }
        save.disabled = true
        await this.keepSource(ticketSource(withTicketEdits(spec, edits)))
        this.editing = false
        await this.draw()
      })
    )
    const cancel = foot.createEl('button', { text: t('common.cancel') })
    cancel.addEventListener('click', () => {
      this.editing = false
      void this.draw()
    })
  }

  private app(): PMPlugin['app'] {
    return this.plugin.app
  }

  private problem(card: HTMLElement, text: string): void {
    card.addClass('pm-change--problem')
    const line = card.createDiv('pm-change-problem')
    setIcon(line.createSpan({ cls: 'pm-change-state-icon' }), 'circle-alert')
    line.createSpan({ text })
  }

  /** What changes: the words that come and go for prose, what it was and will be otherwise. */
  private body(
    card: HTMLElement,
    label: string,
    resolved: { before: string; after: string } | null,
    prose: boolean
  ): void {
    card.createDiv({ cls: 'pm-change-field', text: label })
    if (!resolved) return
    const diff = card.createDiv('pm-change-diff pm-req-diff')
    if (prose && resolved.before) {
      for (const part of diffWords(resolved.before, resolved.after)) {
        if (part.kind === 'same') diff.createSpan({ text: part.text })
        else diff.createSpan({ cls: `pm-req-diff-${part.kind}`, text: part.text })
      }
      return
    }
    // In place, the value it has: no arrow from a value to itself.
    if (resolved.before && resolved.before !== resolved.after) {
      diff.createSpan({ cls: 'pm-req-diff-removed', text: resolved.before })
      diff.createSpan({ cls: 'pm-change-arrow', text: ' → ' })
    }
    diff.createSpan({ cls: 'pm-req-diff-added', text: resolved.after || '—' })
  }

  private why(card: HTMLElement, why: string): void {
    if (why) card.createDiv({ cls: 'pm-change-why', text: why })
  }

  private footer(
    card: HTMLElement,
    resolved: CardState,
    apply: () => Promise<void>,
    words: { apply: string; done: string; warning?: boolean } = {
      apply: t('chat.change.apply'),
      done: t('chat.change.done')
    }
  ): void {
    const foot = card.createDiv('pm-change-foot')
    if (!resolved.ok) {
      card.addClass('pm-change--problem')
      setIcon(foot.createSpan({ cls: 'pm-change-state-icon' }), 'circle-alert')
      foot.createSpan({ cls: 'pm-change-problem', text: problemText(resolved.problem, resolved.allowed) })
      return
    }
    if (resolved.applied) {
      card.addClass('pm-change--done')
      setIcon(foot.createSpan({ cls: 'pm-change-state-icon' }), 'check')
      foot.createSpan({ cls: 'pm-change-state', text: words.done })
      this.undoButton(foot)
      return
    }
    const button = foot.createEl('button', { cls: words.warning ? 'mod-warning' : 'mod-cta', text: words.apply })
    explain(button, words.apply, words.warning ? t('tip.chat.change.applyWarning') : t('tip.chat.change.apply'))
    button.addEventListener(
      'click',
      safeAsync(async () => {
        button.disabled = true
        button.setText(t('chat.change.applying'))
        this.busy = true
        try {
          await apply()
        } catch (error) {
          new Notice(t('chat.change.failed', { reason: error instanceof Error ? error.message : String(error) }))
        } finally {
          this.busy = false
          await this.draw()
        }
      })
    )
  }

  private async applyRequirement(spec: Extract<ChangeSpec, { kind: 'requirement' }>, path: string): Promise<void> {
    if (!path) return
    const done = await applyToRequirement(
      this.plugin.requirements,
      path,
      spec,
      requirementOptions(this.plugin),
      author(this.plugin)
    )
    this.report(done, spec.target)
  }

  private async applyCreate(spec: Extract<ChangeSpec, { kind: 'create' }>): Promise<void> {
    const placed = this.placed(spec)
    await this.keepUndo(placed, spec.title, () => applyCreate(this.plugin.index, this.plugin.store, placed, typeLabel))
  }

  private async applyTicket(spec: Extract<ChangeSpec, { kind: 'ticket' }>): Promise<void> {
    // A deletion is asked twice: it cannot be undone from here.
    if (
      spec.action === 'delete' &&
      !(await confirmDialog(this.plugin.app, t('chat.change.deleteConfirm', { title: spec.target })))
    ) {
      return
    }
    await this.keepUndo(spec, spec.target, () => applyToTicket(this.plugin.index, this.plugin.store, spec))
  }

  /** A change applied, reported, and kept so it can be taken back. */
  private async keepUndo(spec: ChangeSpec, name: string, apply: () => Promise<Applied>): Promise<void> {
    const { done, record } = await applyWithUndo(this.plugin.index, this.plugin.store, spec, name, typeLabel, apply)
    if (record) await this.plugin.chatUndo.set(this.source, record)
    await logTicketChange(this.plugin, spec, name, this.source, this.sourcePath, record, done)
    this.report(done, name)
  }

  /** Beside a change in place that this card applied: the way to take it back. */
  private undoButton(foot: Element): void {
    const record = this.plugin.chatUndo.get(this.source)
    if (!record) return
    const button = foot.createEl('button', { cls: 'pm-change-undo', text: t('chat.change.undo') })
    explain(button, t('chat.change.undo'), t('tip.chat.change.undo'))
    setIcon(button.createSpan({ cls: 'pm-change-edit-icon' }), 'undo-2')
    button.prepend(button.lastChild as Node)
    button.setAttr('title', t('chat.change.undoHint', { count: record.changed.length + record.created.length }))
    button.addEventListener(
      'click',
      safeAsync(async () => {
        button.disabled = true
        this.busy = true
        try {
          const undone = await undoChange(this.plugin.store, record)
          await this.plugin.chatUndo.delete(this.source)
          await this.plugin.chatHistory.markUndone(undoKey(this.source))
          reportUndone(undone, record.label)
        } finally {
          this.busy = false
          await this.draw()
        }
      })
    )
  }

  private report(done: Applied, target: string): void {
    if (done.ok) {
      if (done.changed) new Notice(t('chat.change.appliedTo', { name: done.name }))
      return
    }
    if (done.problem === 'none') {
      new Notice(t('chat.change.gone', { name: target }))
    } else if (done.problem === 'ambiguous') {
      new Notice(t('chat.change.ambiguous', { title: target, count: done.count ?? 0 }))
    } else {
      new Notice(problemText(done.problem, 'allowed' in done ? done.allowed : undefined))
    }
  }
}
