import type { Project, Task } from '../../types'
import { flattenTasks } from '../TaskTreeOps'

/**
 * Undoing what a proposal from the chat did.
 *
 * A change applied from the chat is rarely one field of one ticket: a date moved moves
 * what waits on it, maybe in another project, and a proposal made a ticket. So what is
 * kept is the plan as it was around the change, compared with the plan right after it —
 * every ticket that moved, with what it said before and after, and every ticket made.
 * Undoing puts back the "before" of each ticket that still says the "after"; one changed
 * since by someone is left as it is, and named.
 */

/** What of a ticket a proposal can change, directly or by the scheduling that follows. */
export const UNDO_FIELDS = [
  'title',
  'status',
  'priority',
  'start',
  'due',
  'progress',
  'completed',
  'assignees',
  'dependencies',
  'dependencyOptions'
] as const
export type UndoField = (typeof UNDO_FIELDS)[number]
export type TaskState = Partial<Record<UndoField, unknown>>

/** Project path → ticket id → its fields, copied: the live projects go on changing. */
export type PlanSnapshot = Map<string, Map<string, { title: string; state: TaskState }>>

export interface UndoStep {
  project: string
  id: string
  title: string
  before: TaskState
  after: TaskState
}

export interface UndoRecord {
  /** When the change was applied. */
  at: string
  /** What was changed, as the card names it. */
  label: string
  changed: UndoStep[]
  /** Tickets the change made, with what they said once made. */
  created: { project: string; id: string; title: string; after: TaskState }[]
}

function copy(value: unknown): unknown {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown)
}

/** A value written the same whatever order its keys came in; nothing and empty alike. */
function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, one]) => one !== undefined)
    if (!entries.length) return 'null'
    return `{${entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, one]) => `${JSON.stringify(key)}:${canonical(one)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

function stateOf(task: Task): TaskState {
  const state: TaskState = {}
  for (const field of UNDO_FIELDS) state[field] = copy(task[field])
  return state
}

/** The projects' tickets as they are this moment. */
export function snapshot(projects: Project[]): PlanSnapshot {
  const plan: PlanSnapshot = new Map()
  for (const project of projects) {
    const tickets = new Map<string, { title: string; state: TaskState }>()
    for (const { task } of flattenTasks(project.tasks)) {
      tickets.set(task.id, { title: task.title, state: stateOf(task) })
    }
    plan.set(project.filePath, tickets)
  }
  return plan
}

/** What a change did, from the plan before it and after it. Null when it did nothing. */
export function undoRecord(before: PlanSnapshot, after: PlanSnapshot, label: string, at: string): UndoRecord | null {
  const record: UndoRecord = { at, label, changed: [], created: [] }
  for (const [project, tickets] of after) {
    const was = before.get(project)
    if (!was) continue
    for (const [id, now] of tickets) {
      const then = was.get(id)
      if (!then) {
        record.created.push({ project, id, title: now.title, after: now.state })
        continue
      }
      const step: UndoStep = { project, id, title: now.title, before: {}, after: {} }
      for (const field of UNDO_FIELDS) {
        if (sameValue(then.state[field], now.state[field])) continue
        step.before[field] = then.state[field]
        step.after[field] = now.state[field]
      }
      if (Object.keys(step.before).length) record.changed.push(step)
    }
  }
  return record.changed.length || record.created.length ? record : null
}

export interface UndoPlan {
  /** Each ticket to put back, with the fields to put back on it. */
  restore: { project: string; id: string; patch: Partial<Task> }[]
  /** Tickets the change made, still as it made them: removed. */
  remove: { project: string; id: string }[]
  /** Tickets changed since, by name: left as they are. */
  conflicts: string[]
  /** The same, where they are: what waits on them is placed after them again. */
  kept: { project: string; id: string }[]
}

/**
 * What undoing a change comes to, against the plan as it is now. A ticket is put back
 * whole or not at all: half of a moved task, its start back and its end not, is a third
 * plan nobody asked for.
 */
export function undoPlan(record: UndoRecord, current: (project: string, id: string) => Task | null): UndoPlan {
  const plan: UndoPlan = { restore: [], remove: [], conflicts: [], kept: [] }
  for (const step of record.changed) {
    const task = current(step.project, step.id)
    if (!task) continue
    const fields = Object.keys(step.before) as UndoField[]
    if (fields.some((field) => !sameValue(task[field], step.after[field]))) {
      plan.conflicts.push(task.title)
      plan.kept.push({ project: step.project, id: step.id })
      continue
    }
    const patch: Record<string, unknown> = {}
    for (const field of fields) patch[field] = copy(step.before[field])
    plan.restore.push({ project: step.project, id: step.id, patch })
  }
  for (const made of record.created) {
    const task = current(made.project, made.id)
    if (!task) continue
    const fields = Object.keys(made.after) as UndoField[]
    if (fields.some((field) => !sameValue(task[field], made.after[field]))) plan.conflicts.push(task.title)
    else plan.remove.push({ project: made.project, id: made.id })
  }
  return plan
}

/** A proposal as it is looked up again: its JSON, whatever its spacing. */
export function undoKey(source: string): string {
  const body = source
    .trim()
    .replace(/^```[\w-]*\s*/, '')
    .replace(/```$/, '')
    .trim()
  try {
    return canonical(JSON.parse(body))
  } catch {
    return body
  }
}

export interface UndoStorage {
  read(name: string): Promise<string | null>
  write(name: string, data: string): Promise<void>
}

const FILE = 'chat-undo.json'

/**
 * The changes applied from the chat that can still be undone, by the proposal that made
 * them. Kept on disk, so a conversation read again tomorrow can still take one back; the
 * oldest go past a few hundred.
 */
export class UndoLog {
  private records = new Map<string, UndoRecord>()
  private loading: Promise<void> | null = null
  private listeners = new Set<() => void>()

  constructor(
    private storage: UndoStorage,
    private limit = 300
  ) {}

  ready(): Promise<void> {
    this.loading ??= this.load()
    return this.loading
  }

  private async load(): Promise<void> {
    try {
      const text = await this.storage.read(FILE)
      const saved = text ? (JSON.parse(text) as { records?: [string, UndoRecord][] }) : {}
      this.records = new Map(saved.records ?? [])
    } catch {
      this.records = new Map()
    }
  }

  get(source: string): UndoRecord | null {
    return this.records.get(undoKey(source)) ?? null
  }

  async set(source: string, record: UndoRecord): Promise<void> {
    await this.ready()
    const key = undoKey(source)
    this.records.delete(key)
    this.records.set(key, record)
    while (this.records.size > this.limit) {
      const oldest = this.records.keys().next().value
      if (oldest === undefined) break
      this.records.delete(oldest)
    }
    await this.save()
  }

  async delete(source: string): Promise<void> {
    await this.ready()
    if (this.records.delete(undoKey(source))) await this.save()
  }

  /** Told whenever a change is kept or forgotten; returns how to stop being told. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async save(): Promise<void> {
    for (const listener of this.listeners) listener()
    await this.storage.write(FILE, JSON.stringify({ records: [...this.records] }))
  }
}
