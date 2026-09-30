import type { Task } from '../../types'
import { setText, VERIFICATION_METHODS, type Requirement } from '../requirements/Requirement'

/**
 * A change the model proposes, for the reader to apply with one click.
 *
 * Written by the model as a fenced block — `pm-change`, holding one JSON object — so the
 * reply stays a reply: the prose says why, the block says exactly what, and the plugin
 * draws the block as a card with what would change and a button. Nothing is ever applied
 * without that click, and nothing the model writes is trusted as it stands: the target is
 * found again, the value checked against the reader's own lists, the field against the
 * short list of what may be changed this way.
 *
 * The block is kept in the conversation's note as it was written, so the card comes back
 * wherever the note is read, and says by itself whether it has been applied since.
 */

export const CHANGE_LANGUAGE = 'pm-change'

export const REQ_CHANGE_FIELDS = [
  'text',
  'title',
  'rationale',
  'source',
  'status',
  'type',
  'criticality',
  'verification'
] as const
export type ReqChangeField = (typeof REQ_CHANGE_FIELDS)[number]

export const TICKET_CHANGE_FIELDS = [
  'title',
  'status',
  'priority',
  'start',
  'due',
  'progress',
  'assignees',
  'after'
] as const
export type TicketChangeField = (typeof TICKET_CHANGE_FIELDS)[number]

export type ChangeSpec =
  | { kind: 'requirement'; target: string; field: ReqChangeField; lang: string; value: unknown; why: string }
  | { kind: 'ticket'; target: string; project: string; changes: TicketFieldChange[]; why: string }
  | {
      kind: 'create'
      /** The new ticket's title. */
      title: string
      project: string
      /** The ticket or lot it goes under, by title; '' for the top of the project. */
      parent: string
      fields: CreateFieldChange[]
      why: string
    }

/** What a new ticket can be given besides its title and where it goes. */
export const CREATE_FIELDS = ['type', 'status', 'priority', 'start', 'due', 'progress', 'assignees', 'after'] as const
export type CreateField = (typeof CREATE_FIELDS)[number]

export interface CreateFieldChange {
  field: CreateField
  value: unknown
}

/** One field of a ticket and what it is to become. */
export interface TicketFieldChange {
  field: TicketChangeField
  value: unknown
}

/** Why a block cannot be drawn as a change: it does not read, or does not say what to change. */
export type ChangeProblem = 'unreadable' | 'target' | 'field'

/**
 * The names a model reaches for, beside the ones it is asked to use. It is told the
 * English ones; replying in French, it sometimes writes the French.
 */
const FIELD_ALIASES: Record<string, string> = {
  wording: 'text',
  statement: 'text',
  texte: 'text',
  enonce: 'text',
  titre: 'title',
  justification: 'rationale',
  origine: 'source',
  statut: 'status',
  criticite: 'criticality',
  verification: 'verification',
  priorite: 'priority',
  debut: 'start',
  echeance: 'due',
  avancement: 'progress',
  assignes: 'assignees',
  personnes: 'assignees',
  apres: 'after',
  dependencies: 'after',
  dependances: 'after',
  predecessors: 'after'
}

/** Lower case, without accents or spacing around: how two spellings of one word are compared. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

/** The block, read. A model that wrapped its JSON in a second fence is forgiven that. */
export function parseChange(source: string): { spec: ChangeSpec } | { problem: ChangeProblem } {
  const body = source
    .trim()
    .replace(/^```\w*\s*/, '')
    .replace(/```$/, '')
    .trim()
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return { problem: 'unreadable' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'unreadable' }
  const record = raw as Record<string, unknown>
  const fieldName = fold(text(record.field))
  const field = FIELD_ALIASES[fieldName] ?? fieldName
  const why = text(record.why)
  const requirement = text(record.requirement ?? record.exigence)
  const ticket = text(record.ticket)
  const created = text(record.create ?? record.creer ?? record['créer'])
  if (created) {
    if (requirement || ticket) return { problem: 'target' }
    const many = record.changes ?? record.fields ?? record.champs
    const pairs = many && typeof many === 'object' && !Array.isArray(many) ? Object.entries(many) : []
    const fields: CreateFieldChange[] = []
    for (const [name, value] of pairs) {
      const folded = fold(name)
      const known = FIELD_ALIASES[folded] ?? folded
      if (!(CREATE_FIELDS as readonly string[]).includes(known)) return { problem: 'field' }
      fields.push({ field: known as CreateField, value })
    }
    return {
      spec: {
        kind: 'create',
        title: created,
        project: text(record.project ?? record.projet),
        parent: text(record.parent ?? record.under ?? record.sous),
        fields,
        why
      }
    }
  }
  if (requirement && !ticket) {
    if (!(REQ_CHANGE_FIELDS as readonly string[]).includes(field)) return { problem: 'field' }
    return {
      spec: {
        kind: 'requirement',
        target: requirement,
        field: field as ReqChangeField,
        lang: fold(text(record.lang ?? record.langue)),
        value: record.value ?? record.valeur,
        why
      }
    }
  }
  if (ticket && !requirement) {
    // Several fields at once — a task moved is its start and its due together — or one.
    const many = record.changes ?? record.modifications
    const pairs: [string, unknown][] =
      many && typeof many === 'object' && !Array.isArray(many)
        ? Object.entries(many as Record<string, unknown>)
        : [[text(record.field), record.value ?? record.valeur]]
    const changes: TicketFieldChange[] = []
    for (const [name, value] of pairs) {
      const folded = fold(name)
      const known = FIELD_ALIASES[folded] ?? folded
      if (!(TICKET_CHANGE_FIELDS as readonly string[]).includes(known)) return { problem: 'field' }
      changes.push({ field: known as TicketChangeField, value })
    }
    if (!changes.length) return { problem: 'field' }
    return {
      spec: { kind: 'ticket', target: ticket, project: text(record.project ?? record.projet), changes, why }
    }
  }
  return { problem: 'target' }
}

/** One entry of a reader's list: a status, a priority, a type. */
export interface Option {
  id: string
  label: string
}

/** The entry a model named, by its label as the reader sees it or by its stored id. */
export function pickOption(options: Option[], raw: string): Option | null {
  const wanted = fold(raw)
  if (!wanted) return null
  return (
    options.find((option) => fold(option.id) === wanted) ??
    options.find((option) => fold(option.label) === wanted) ??
    null
  )
}

function labelOf(options: Option[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? id
}

/**
 * Why a proposed value is refused; `allowed` lists what would have been taken — or, for a
 * ticket named that cannot be found, the name that was looked for.
 */
export type ValueProblem = 'empty' | 'unknown' | 'date' | 'order' | 'progress' | 'lang' | 'project' | 'parent' | 'after'

export type Resolution<T> =
  | {
      ok: true
      /** What it says now, and what it would say, as the reader reads them. */
      before: string
      after: string
      /** Whether the change is already made: the card then says so instead of offering it. */
      applied: boolean
      change: T
    }
  | { ok: false; problem: ValueProblem; allowed?: string[] }

/** The reader's lists a requirement's fields are checked against. */
export interface ReqOptions {
  statuses: Option[]
  types: Option[]
  criticalities: Option[]
  verifications: Option[]
  languages: string[]
}

export interface ReqEdit {
  /** The wording's language, for a change to the wording. */
  lang?: string
  apply: (requirement: Requirement, by: string) => Requirement
}

/** The verification methods as options, named in the reader's words. */
export function verificationOptions(label: (method: string) => string): Option[] {
  return VERIFICATION_METHODS.map((method) => ({ id: method, label: label(method) }))
}

/**
 * A change to a requirement, checked against the requirement as it is now.
 *
 * A new wording goes through `setText` as a machine's, unreviewed: the reader clicked to
 * take it, which is not the same as having read it closely, and the library keeps the
 * difference — the same door the editor's own rewrite goes through. Changing the source
 * language's wording bumps the revision like any edit, so the translations say they are
 * behind.
 */
export function requirementChange(
  spec: Extract<ChangeSpec, { kind: 'requirement' }>,
  requirement: Requirement,
  options: ReqOptions
): Resolution<ReqEdit> {
  const value = text(spec.value)
  if (spec.field === 'text') {
    const lang = spec.lang || requirement.sourceLang
    if (!options.languages.includes(lang) && !requirement.text[lang]) {
      return { ok: false, problem: 'lang', allowed: options.languages }
    }
    if (!value) return { ok: false, problem: 'empty' }
    const before = requirement.text[lang]?.body ?? ''
    return {
      ok: true,
      before,
      after: value,
      applied: before === value,
      change: { lang, apply: (current, by) => setText(current, lang, value, by, 'machine') }
    }
  }
  if (spec.field === 'title' || spec.field === 'rationale' || spec.field === 'source') {
    const field = spec.field
    if (!value && field === 'title') return { ok: false, problem: 'empty' }
    const before = requirement[field]
    return {
      ok: true,
      before,
      after: value,
      applied: before === value,
      change: { apply: (current) => ({ ...current, [field]: value, updatedAt: new Date().toISOString() }) }
    }
  }
  const list =
    spec.field === 'status'
      ? options.statuses
      : spec.field === 'type'
        ? options.types
        : spec.field === 'criticality'
          ? options.criticalities
          : options.verifications
  const picked = pickOption(list, value)
  if (!picked) return { ok: false, problem: 'unknown', allowed: list.map((option) => option.label) }
  const field = spec.field
  const before = requirement[field]
  return {
    ok: true,
    before: before ? labelOf(list, before) : '',
    after: picked.label,
    applied: before === picked.id,
    change: { apply: (current) => ({ ...current, [field]: picked.id, updatedAt: new Date().toISOString() }) }
  }
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const at = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value
}

function people(value: unknown): string[] {
  const list = Array.isArray(value) ? value.map(text) : text(value).split(/[,;]/)
  return [...new Set(list.map((name) => name.trim()).filter(Boolean))]
}

export interface TicketEdit {
  patch: Partial<Task>
  /** A date moved: what waits on this ticket may have to move with it. */
  reschedule: boolean
}

/** One field of a ticket, as the card shows it: what it says now and what it would say. */
export interface TicketRow {
  field: TicketChangeField
  before: string
  after: string
  applied: boolean
}

export type TicketResolution =
  | { ok: true; rows: TicketRow[]; applied: boolean; change: TicketEdit }
  | { ok: false; field: TicketChangeField; problem: ValueProblem; allowed?: string[] }

/**
 * A change to a ticket, checked against the ticket as it is now.
 *
 * Every field is checked before any is taken: a proposal that moves a task two weeks
 * later sets its start and its due together, and read one at a time the new start would
 * fall after the old due and be refused. A status and a priority are the project's own,
 * named by their label as the model was shown them. A pair of dates that would put the
 * end before the start is refused rather than written: the plan would draw it, and nobody
 * would have asked for it.
 */
export function ticketChange(
  spec: Extract<ChangeSpec, { kind: 'ticket' }>,
  task: Task,
  lists: { statuses: Option[]; priorities: Option[]; candidates?: TicketCandidate[] }
): TicketResolution {
  const rows: TicketRow[] = []
  const patch: Partial<Task> = {}
  let reschedule = false
  for (const { field, value: raw } of spec.changes) {
    const value = text(raw)
    const refuse = (problem: ValueProblem, allowed?: string[]): TicketResolution => ({
      ok: false,
      field,
      problem,
      ...(allowed ? { allowed } : {})
    })
    switch (field) {
      case 'title':
        if (!value) return refuse('empty')
        rows.push({ field, before: task.title, after: value, applied: task.title === value })
        patch.title = value
        break
      case 'status':
      case 'priority': {
        const list = field === 'status' ? lists.statuses : lists.priorities
        const picked = pickOption(list, value)
        if (!picked) {
          return refuse(
            'unknown',
            list.map((option) => option.label)
          )
        }
        const before = task[field]
        rows.push({ field, before: labelOf(list, before), after: picked.label, applied: before === picked.id })
        patch[field] = picked.id
        break
      }
      case 'start':
      case 'due': {
        if (!isDate(value)) return refuse('date')
        rows.push({ field, before: task[field], after: value, applied: task[field] === value })
        patch[field] = value
        reschedule = true
        break
      }
      case 'progress': {
        const number = Number(value.replace(/\s*%$/, '').replace(',', '.'))
        if (!value || !Number.isFinite(number) || number < 0 || number > 100) return refuse('progress')
        const progress = Math.round(number)
        rows.push({ field, before: `${task.progress} %`, after: `${progress} %`, applied: task.progress === progress })
        patch.progress = progress
        break
      }
      case 'assignees': {
        const names = people(raw)
        const before = task.assignees.join(', ')
        const after = names.join(', ')
        rows.push({ field, before, after, applied: before === after })
        patch.assignees = names
        break
      }
      case 'after': {
        // What it follows, said whole: the list takes the place of its dependencies.
        const candidates = lists.candidates ?? []
        const titleOf = (id: string): string => candidates.find((candidate) => candidate.id === id)?.title ?? id
        const titles = Array.isArray(raw) ? raw.map(text) : value.split(/[,;]/).map((one) => one.trim())
        const ids: string[] = []
        for (const one of titles.filter(Boolean)) {
          const found = findTicket(candidates, one, spec.project)
          if (!('found' in found) || found.found.id === task.id) return refuse('after', [one])
          if (!ids.includes(found.found.id)) ids.push(found.found.id)
        }
        const before = task.dependencies
        const same = before.length === ids.length && ids.every((id) => before.includes(id))
        rows.push({ field, before: before.map(titleOf).join(', '), after: ids.map(titleOf).join(', '), applied: same })
        patch.dependencies = ids
        if (task.dependencyOptions) {
          // How each kept link schedules stays; those dropped go with their link.
          const kept = Object.fromEntries(Object.entries(task.dependencyOptions).filter(([id]) => ids.includes(id)))
          patch.dependencyOptions = Object.keys(kept).length ? kept : undefined
        }
        reschedule = true
        break
      }
    }
  }
  // The dates as they would be once every field is taken, checked as a pair.
  const start = patch.start ?? task.start
  const due = patch.due ?? task.due
  if (start && due && start > due) return { ok: false, field: patch.due ? 'due' : 'start', problem: 'order' }
  const applied = rows.every((row) => row.applied)
  return { ok: true, rows, applied, change: { patch, reschedule } }
}

/** A ticket as the index knows it: enough to find it by the title the model was shown. */
export interface TicketCandidate {
  id: string
  title: string
  projectPath: string | null
  projectTitle: string
}

/**
 * The ticket a model named, by its title — the only name it was ever shown.
 *
 * Narrowed by project when the model said which, and refused when the title is still not
 * unique: two tickets called "Réception" in two projects are two tickets, and applying a
 * change to whichever came first would be the tool guessing with the reader's plan.
 */
export function findTicket(
  candidates: TicketCandidate[],
  title: string,
  project: string
): { found: TicketCandidate } | { problem: 'none' | 'ambiguous'; count: number } {
  // Picked in a list rather than typed: by its id, which no other ticket has.
  const byId = candidates.find((candidate) => candidate.id === title.trim())
  if (byId) return { found: byId }
  const wanted = fold(title)
  let matches = candidates.filter((candidate) => fold(candidate.title) === wanted)
  if (project && matches.length > 1) {
    const inProject = matches.filter(
      (candidate) =>
        fold(candidate.projectTitle) === fold(project) || fold(candidate.projectPath ?? '') === fold(project)
    )
    if (inProject.length) matches = inProject
  }
  if (matches.length === 1) return { found: matches[0] }
  return { problem: matches.length ? 'ambiguous' : 'none', count: matches.length }
}

/**
 * A reply still being written, with a change block that is not finished yet set aside.
 *
 * Half a block is half a JSON object: drawn as it comes, it would flash as a proposal that
 * cannot be read, over and over, until its last brace arrives. So the reply is shown up to
 * where the block opens, with a word saying one is on its way.
 */
export function withoutOpenChange(text: string, pending: string): string {
  const fences = [...text.matchAll(/^[ \t]*(`{3,}|~{3,})(.*)$/gm)]
  let open: { at: number; fence: string; change: boolean } | null = null
  for (const fence of fences) {
    const marker = fence[1]
    if (!open) {
      // A note proposed is set aside as a change is: half a note is a card with a button.
      open = { at: fence.index, fence: marker, change: [CHANGE_LANGUAGE, 'pm-note'].includes(fence[2].trim()) }
    } else if (marker[0] === open.fence[0] && marker.length >= open.fence.length && !fence[2].trim()) {
      open = null
    }
  }
  if (!open?.change) return text
  return `${text.slice(0, open.at).trimEnd()}\n\n*${pending}*`
}

/** The change blocks of a reply, finished ones only, in the order they were written. */
export function changeBlocks(text: string): string[] {
  const blocks: string[] = []
  let open: { fence: string; change: boolean; lines: string[] } | null = null
  for (const line of text.split('\n')) {
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line)
    if (!open) {
      if (fence) open = { fence: fence[1], change: fence[2].trim() === CHANGE_LANGUAGE, lines: [] }
      continue
    }
    if (fence && fence[1][0] === open.fence[0] && fence[1].length >= open.fence.length && !fence[2].trim()) {
      if (open.change) blocks.push(open.lines.join('\n'))
      open = null
      continue
    }
    open.lines.push(line)
  }
  return blocks
}

/** A project a ticket can go into, as the index knows it. */
export interface ProjectCandidate {
  path: string
  title: string
}

/** The project a model named, by title or by path; null when it is not one, or not only one. */
export function findProject(candidates: ProjectCandidate[], name: string): ProjectCandidate | null {
  const wanted = fold(name.replace(/\.md$/i, ''))
  if (!wanted) return candidates.length === 1 ? candidates[0] : null
  const matches = candidates.filter(
    (candidate) => fold(candidate.title) === wanted || fold(candidate.path.replace(/\.md$/i, '')) === wanted
  )
  return matches.length === 1 ? matches[0] : null
}

/** What a new ticket is checked against: the project it goes into, as it is now. */
export interface CreateContext {
  project: ProjectCandidate
  /** Every ticket of the project, lots included, archived ones left out. */
  tickets: { id: string; title: string; type: string }[]
  statuses: Option[]
  priorities: Option[]
  types: Option[]
  /** What a new ticket starts as, the way the editor starts one. */
  defaultStatus: string
  defaultPriority: string
  /** Every ticket anywhere, for what the new one waits on. */
  candidates: TicketCandidate[]
}

/** One line of the card: a field of the new ticket and what it will say. */
export interface CreateRow {
  field: CreateField | 'parent'
  after: string
}

export interface CreateEdit {
  /** The new ticket, less what `makeTask` fills in. */
  task: Partial<Task> & { title: string }
  parentId: string | null
  /** It waits on something: the project's scheduling may move it after that. */
  reschedule: boolean
}

export type CreateResolution =
  | { ok: true; rows: CreateRow[]; applied: boolean; change: CreateEdit }
  | { ok: false; problem: ValueProblem; allowed?: string[] }

/**
 * A new ticket, checked against the project it would go into.
 *
 * It is "applied" once the project holds a ticket of that title: the card then says so,
 * and a second click cannot make a twin. The lot or ticket it goes under and the tickets
 * it waits on are found by title, as everything the model was shown is named, and refused
 * when they cannot be found or are not the only one of their name. What is not said is
 * what the editor would give a new ticket: the project's first status, its middle
 * priority, and "subtask" under a ticket that is not a lot.
 */
export function createChange(spec: Extract<ChangeSpec, { kind: 'create' }>, context: CreateContext): CreateResolution {
  const title = spec.title.trim()
  if (!title) return { ok: false, problem: 'empty' }
  const rows: CreateRow[] = []
  const task: Partial<Task> & { title: string } = { title, start: '' }
  const same = (a: string, b: string): boolean => fold(a) === fold(b)

  let parentId: string | null = null
  let parentIsLot = false
  if (spec.parent) {
    const parents = context.tickets.filter((ticket) => same(ticket.title, spec.parent))
    if (parents.length !== 1) return { ok: false, problem: 'parent', allowed: [spec.parent] }
    parentId = parents[0].id
    parentIsLot = parents[0].type === 'phase'
    rows.push({ field: 'parent', after: parents[0].title })
  }

  let typed = false
  const dependencies: string[] = []
  for (const { field, value: raw } of spec.fields) {
    const value = text(raw)
    switch (field) {
      case 'type':
      case 'status':
      case 'priority': {
        const list = field === 'type' ? context.types : field === 'status' ? context.statuses : context.priorities
        const picked = pickOption(list, value)
        if (!picked) return { ok: false, problem: 'unknown', allowed: list.map((option) => option.label) }
        if (field === 'type') {
          task.type = picked.id as Task['type']
          typed = true
        } else task[field] = picked.id
        rows.push({ field, after: picked.label })
        break
      }
      case 'start':
      case 'due':
        if (!isDate(value)) return { ok: false, problem: 'date' }
        task[field] = value
        rows.push({ field, after: value })
        break
      case 'progress': {
        const number = Number(value.replace(/\s*%$/, '').replace(',', '.'))
        if (!value || !Number.isFinite(number) || number < 0 || number > 100) return { ok: false, problem: 'progress' }
        task.progress = Math.round(number)
        rows.push({ field, after: `${task.progress} %` })
        break
      }
      case 'assignees': {
        const names = people(raw)
        task.assignees = names
        rows.push({ field, after: names.join(', ') })
        break
      }
      case 'after': {
        const titles = Array.isArray(raw) ? raw.map(text) : value.split(/[,;]/).map((one) => one.trim())
        const named: string[] = []
        for (const one of titles.filter(Boolean)) {
          const found = findTicket(context.candidates, one, context.project.title)
          if (!('found' in found)) return { ok: false, problem: 'after', allowed: [one] }
          if (!dependencies.includes(found.found.id)) dependencies.push(found.found.id)
          named.push(found.found.title)
        }
        if (named.length) rows.push({ field, after: named.join(', ') })
        break
      }
    }
  }
  if (!typed) task.type = parentId && !parentIsLot ? 'subtask' : 'task'
  task.status ??= context.defaultStatus
  task.priority ??= context.defaultPriority
  // A milestone is a day: given only one of its dates, it is on that day.
  if (task.type === 'milestone') {
    task.start = task.start || task.due || ''
    task.due = task.due || task.start
  }
  if (task.start && task.due && task.start > task.due) return { ok: false, problem: 'order' }
  if (dependencies.length) task.dependencies = dependencies

  const applied = context.tickets.some((ticket) => same(ticket.title, title))
  return { ok: true, rows, applied, change: { task, parentId, reschedule: dependencies.length > 0 } }
}

/** What the reader changed of a proposed ticket before making it; a field left '' is taken off. */
export interface CreateEdits {
  title?: string
  project?: string
  parent?: string
  /** A list — people, what it follows — as a list, which no comma in a title can cut. */
  fields?: Partial<Record<CreateField, string | string[]>>
}

/** The fields said as lists: several names or titles, one written after the other. */
const LIST_FIELDS: CreateField[] = ['assignees', 'after']

/** A proposed ticket as the reader changed it: what they touched replaced, the rest as proposed. */
export function withEdits(
  spec: Extract<ChangeSpec, { kind: 'create' }>,
  edits: CreateEdits
): Extract<ChangeSpec, { kind: 'create' }> {
  const edited = edits.fields ?? {}
  const listOf = (raw: string | string[]): string[] =>
    (Array.isArray(raw) ? raw : raw.split(/[,;]/)).map((one) => one.trim()).filter(Boolean)
  const valueOf = (field: CreateField, raw: string | string[]): unknown =>
    LIST_FIELDS.includes(field) ? listOf(raw) : (Array.isArray(raw) ? raw.join(', ') : raw).trim()
  const empty = (field: CreateField, raw: string | string[]): boolean =>
    LIST_FIELDS.includes(field) ? !listOf(raw).length : !(Array.isArray(raw) ? raw.join('') : raw).trim()
  // Each field where it was, its value as changed — or gone, emptied —, the new ones after.
  const fields: CreateFieldChange[] = []
  for (const change of spec.fields) {
    const raw = edited[change.field]
    if (raw === undefined) fields.push(change)
    else if (!empty(change.field, raw)) fields.push({ field: change.field, value: valueOf(change.field, raw) })
  }
  for (const field of CREATE_FIELDS) {
    const raw = edited[field]
    if (raw === undefined || empty(field, raw) || spec.fields.some((change) => change.field === field)) continue
    fields.push({ field, value: valueOf(field, raw) })
  }
  return {
    ...spec,
    title: edits.title?.trim() || spec.title,
    project: edits.project?.trim() ?? spec.project,
    parent: edits.parent !== undefined ? edits.parent.trim() : spec.parent,
    fields
  }
}

/** A proposed ticket written back as the block that proposes it, for the conversation to keep. */
export function createSource(spec: Extract<ChangeSpec, { kind: 'create' }>): string {
  const changes = Object.fromEntries(spec.fields.map((change) => [change.field, change.value]))
  const record: Record<string, unknown> = { create: spec.title, project: spec.project }
  if (spec.parent) record.parent = spec.parent
  if (spec.fields.length) record.changes = changes
  if (spec.why) record.why = spec.why
  return JSON.stringify(record, null, 2)
}

/**
 * A block of a note replaced by another, wherever it is: as it is written at the top level,
 * or inside a conversation's callout, each of its lines after a « > ». Null when the note
 * does not hold it.
 */
export function replaceBlock(content: string, before: string, after: string): string | null {
  const lines = (text: string): string[] => text.replace(/\r\n?/g, '\n').trim().split('\n')
  const quoted = (text: string, prefix: string): string =>
    lines(text)
      .map((line) => (prefix && !line ? prefix.trimEnd() : `${prefix}${line}`))
      .join('\n')
  for (const prefix of ['', '> ']) {
    const old = quoted(before, prefix)
    const at = content.indexOf(old)
    if (at >= 0) return `${content.slice(0, at)}${quoted(after, prefix)}${content.slice(at + old.length)}`
  }
  return null
}

/** What the reader set a ticket's fields to before the change is made; a list as a list. */
export type TicketEdits = Partial<Record<TicketChangeField, string | string[]>>

/**
 * A proposed change to a ticket as the reader set it: the fields they changed from what the
 * ticket says now, in the order they come — every other field left as it is.
 */
export function withTicketEdits(
  spec: Extract<ChangeSpec, { kind: 'ticket' }>,
  edits: TicketEdits
): Extract<ChangeSpec, { kind: 'ticket' }> {
  const changes: TicketFieldChange[] = []
  for (const field of TICKET_CHANGE_FIELDS) {
    const raw = edits[field]
    if (raw === undefined) continue
    const value = Array.isArray(raw)
      ? raw.map((one) => one.trim()).filter(Boolean)
      : field === 'assignees'
        ? raw
            .split(/[,;]/)
            .map((one) => one.trim())
            .filter(Boolean)
        : raw.trim()
    changes.push({ field, value })
  }
  return { ...spec, changes }
}

/** A proposed change to a ticket written back as the block that proposes it. */
export function ticketSource(spec: Extract<ChangeSpec, { kind: 'ticket' }>): string {
  const record: Record<string, unknown> = {
    ticket: spec.target,
    ...(spec.project ? { project: spec.project } : {}),
    changes: Object.fromEntries(spec.changes.map((change) => [change.field, change.value]))
  }
  if (spec.why) record.why = spec.why
  return JSON.stringify(record, null, 2)
}
