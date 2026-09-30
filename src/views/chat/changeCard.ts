import { MarkdownRenderChild, Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import {
  CHANGE_LANGUAGE,
  createChange,
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
  createLot,
  createPlace,
  createTarget,
  projectsLike,
  ticketTarget,
  type Applied,
  type TicketTarget
} from '../../store/chat/applyChange'
import { typeConfigOf } from '../../store/TicketPalette'
import { fold } from '../../store/library/libraryDoc'
import type { Project, TaskType } from '../../types'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'
import { openRequirementModal } from '../requirements/RequirementModal'
import { reqLanguages, verificationLabel } from '../requirements/reqPalette'

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
    ctx.addChild(new ChangeCard(plugin, source, el))
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
  }
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

  constructor(
    private plugin: PMPlugin,
    private source: string,
    container: HTMLElement
  ) {
    super(container)
  }

  onload(): void {
    void this.draw()
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
    if (spec.kind === 'create') {
      const placed = this.placed(spec)
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
      this.paint((card) => this.renderCreate(card, placed, target))
      return
    }
    const target = await ticketTarget(this.plugin.index, this.plugin.store, spec)
    if (generation !== this.generation) return
    this.paint((card) => this.renderTicket(card, spec, target))
  }

  /** A ticket to create: where it goes, what it will say, and a button that makes it. */
  private renderCreate(
    card: HTMLElement,
    spec: Extract<ChangeSpec, { kind: 'create' }>,
    target: { project: Project; context: CreateContext; via?: string } | null
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
        this.body(grid, createFieldLabel(row.field), { before: '', after: row.after }, false)
      }
    }
    this.why(card, spec.why)
    this.footer(card, resolved, () => this.applyCreate(spec), {
      apply: t('chat.change.create'),
      done: t('chat.change.created')
    })
    if (!resolved.ok && resolved.problem === 'parent') this.renderParentFix(card, spec, target)
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
    target: TicketTarget | { problem: 'none' | 'ambiguous'; count: number }
  ): void {
    if ('problem' in target) {
      this.head(card, 'square-check-big', spec.target, null)
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
      for (const row of resolved.rows) this.body(card, ticketFieldLabel(row.field), row, row.field === 'title')
    } else this.body(card, ticketFieldLabel(resolved.field), null, false)
    this.why(card, spec.why)
    this.footer(card, resolved, () => this.applyTicket(spec))
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
    if (resolved.before) {
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
    words = { apply: t('chat.change.apply'), done: t('chat.change.done') }
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
      return
    }
    const button = foot.createEl('button', { cls: 'mod-cta', text: words.apply })
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
    this.report(await applyCreate(this.plugin.index, this.plugin.store, this.placed(spec), typeLabel), spec.title)
  }

  private async applyTicket(spec: Extract<ChangeSpec, { kind: 'ticket' }>): Promise<void> {
    this.report(await applyToTicket(this.plugin.index, this.plugin.store, spec), spec.target)
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
