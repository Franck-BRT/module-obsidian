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

export const TICKET_CHANGE_FIELDS = ['title', 'status', 'priority', 'start', 'due', 'progress', 'assignees'] as const
export type TicketChangeField = (typeof TICKET_CHANGE_FIELDS)[number]

export type ChangeSpec =
  | { kind: 'requirement'; target: string; field: ReqChangeField; lang: string; value: unknown; why: string }
  | { kind: 'ticket'; target: string; project: string; changes: TicketFieldChange[]; why: string }

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
  personnes: 'assignees'
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

/** Why a proposed value is refused; `allowed` lists what would have been taken. */
export type ValueProblem = 'empty' | 'unknown' | 'date' | 'order' | 'progress' | 'lang'

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
  lists: { statuses: Option[]; priorities: Option[] }
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
      open = { at: fence.index, fence: marker, change: fence[2].trim() === CHANGE_LANGUAGE }
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
