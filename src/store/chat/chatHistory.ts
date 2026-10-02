import type { UndoRecord, UndoStep } from './chatUndo'

/**
 * What the chat changed, kept: each proposal applied — a ticket changed, made or deleted, a
 * note written, added to or rewritten — with when, why, the conversation it came from and
 * the projects it touched, and when it was taken back. The undo records say how to take a
 * change back; this says what happened, and stays once it has been.
 */

export type HistoryKind = 'ticket' | 'create' | 'delete' | 'note' | 'append' | 'rewrite'

export interface HistoryEntry {
  id: string
  /** When it was applied, as an ISO date. */
  at: string
  kind: HistoryKind
  /** What it was applied to, as the card named it: a ticket's title, a note's name. */
  label: string
  /** What changed, a line a ticket or a field, written when it was applied. */
  lines: string[]
  /** Why the model proposed it; '' when it said nothing. */
  why: string
  /** The conversation's note, by path; '' when it is not known. */
  chat: string
  /** The projects it touched, by the paths of their notes. */
  projects: string[]
  /** What was written, by path — a note, a ticket's note — to open it from the history. */
  path: string
  /** The ticket it was mainly about, by id, its note found when the history is read. */
  ticket?: string
  /** The key its undo record is kept under; '' when it cannot be taken back. */
  key: string
  /** When it was taken back; absent while it stands. */
  undone?: string
}

export interface HistoryWords {
  field: (field: string) => string
  value: (field: string, value: unknown) => string
  created: (title: string) => string
  more: (count: number) => string
}

/** Shown of a change's tickets, at most; the others are counted. */
const LINES = 8

/** A field's change in words: its name, then before and after where they say something. */
function fieldLine(step: UndoStep, field: string, words: HistoryWords): string {
  const name = words.field(field)
  // A move, a text, links: what they were is ids and paragraphs, not something to read in a line.
  if (field === 'parent' || field === 'description' || field === 'dependencies' || field === 'dependencyOptions') {
    return name
  }
  const before = words.value(field, step.before[field as keyof typeof step.before])
  const after = words.value(field, step.after[field as keyof typeof step.after])
  return `${name} ${before || '—'} → ${after || '—'}`
}

/** What a change did, a line a ticket: the fields it moved, and the tickets it made. */
export function recordLines(record: UndoRecord, words: HistoryWords): string[] {
  const lines = [
    ...record.changed.map(
      (step) =>
        `${step.title} : ${Object.keys(step.before)
          .map((field) => fieldLine(step, field, words))
          .join(' ; ')}`
    ),
    ...record.created.map((made) => words.created(made.title))
  ]
  return lines.length > LINES ? [...lines.slice(0, LINES), words.more(lines.length - LINES)] : lines
}

/** The projects a change touched, each once, by path. */
export function recordProjects(record: UndoRecord): string[] {
  return [...new Set([...record.changed.map((step) => step.project), ...record.created.map((made) => made.project)])]
}

export interface HistoryStorage {
  read(name: string): Promise<string | null>
  write(name: string, data: string): Promise<void>
}

const FILE = 'chat-history.json'

/** Kept at most: the oldest go past it. */
const LIMIT = 2000

export class ChatHistory {
  private entries: HistoryEntry[] = []
  private loading: Promise<void> | null = null
  private listeners = new Set<() => void>()

  constructor(
    private storage: HistoryStorage,
    private now: () => Date = () => new Date()
  ) {}

  ready(): Promise<void> {
    this.loading ??= this.load()
    return this.loading
  }

  private async load(): Promise<void> {
    try {
      const text = await this.storage.read(FILE)
      const saved = text ? (JSON.parse(text) as { entries?: HistoryEntry[] }) : {}
      this.entries = Array.isArray(saved.entries) ? saved.entries : []
    } catch {
      this.entries = []
    }
  }

  /** Every entry, the latest first. */
  list(): HistoryEntry[] {
    return [...this.entries].reverse()
  }

  /** A change applied, kept. */
  async add(entry: Omit<HistoryEntry, 'id' | 'at'>): Promise<HistoryEntry> {
    await this.ready()
    const at = this.now().toISOString()
    const made: HistoryEntry = { ...entry, id: `${at}-${Math.random().toString(36).slice(2, 8)}`, at }
    this.entries.push(made)
    if (this.entries.length > LIMIT) this.entries = this.entries.slice(-LIMIT)
    await this.save()
    return made
  }

  /** The change kept under that undo key taken back — from its card, or from here. */
  async markUndone(key: string): Promise<void> {
    if (!key) return
    await this.ready()
    const entry = [...this.entries].reverse().find((one) => one.key === key && !one.undone)
    if (!entry) return
    entry.undone = this.now().toISOString()
    await this.save()
  }

  /** Told at each change; returns how to stop being told. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async save(): Promise<void> {
    for (const listener of this.listeners) listener()
    await this.storage.write(FILE, JSON.stringify({ entries: this.entries }))
  }
}
