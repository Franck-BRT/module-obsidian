import type { OcrSettings } from '../../types'

/**
 * The readings of scans that were going on, page by page, kept on disk: Obsidian closed
 * in the middle of a forty-page document leaves the pages read so far, and the reading
 * can go on from the next one when it is opened again. A reading that ends — read,
 * stopped by the reader — is forgotten.
 */

export interface ScanProgressEntry {
  /** The document's record, by path. */
  key: string
  title: string
  /** The file read, by path, and its modification time: a file changed since is read anew. */
  file: string
  mtime: number
  /** The pages read so far, each as the transcription writes it. */
  parts: string[]
  /** How many pages the reading was to read. */
  total: number
  /** The steps of the reading, as chosen when it was launched. */
  options: OcrSettings
  /** Whether it was reading the document again, a transcription already made. */
  again: boolean
}

export interface ScanProgressStorage {
  read(name: string): Promise<string | null>
  write(name: string, data: string): Promise<void>
}

const FILE = 'scan-progress.json'

export class ScanProgress {
  private entries = new Map<string, ScanProgressEntry>()
  private loading: Promise<void> | null = null
  private listeners = new Set<() => void>()

  constructor(private storage: ScanProgressStorage) {}

  ready(): Promise<void> {
    this.loading ??= this.load()
    return this.loading
  }

  private async load(): Promise<void> {
    try {
      const text = await this.storage.read(FILE)
      const saved = text ? (JSON.parse(text) as { entries?: ScanProgressEntry[] }) : {}
      this.entries = new Map((saved.entries ?? []).map((entry) => [entry.key, entry]))
    } catch {
      this.entries = new Map()
    }
  }

  /** The readings cut short, the oldest first. */
  list(): ScanProgressEntry[] {
    return [...this.entries.values()]
  }

  get(key: string): ScanProgressEntry | null {
    return this.entries.get(key) ?? null
  }

  /**
   * The pages read so far of a document, for a reading to go on from: those kept for this
   * file as it now is, none when it changed since or was never begun.
   */
  resumeFrom(key: string, file: string, mtime: number): string[] {
    const entry = this.entries.get(key)
    return entry && entry.file === file && entry.mtime === mtime ? entry.parts : []
  }

  /** A page read: what was read so far, kept. */
  async keep(entry: ScanProgressEntry): Promise<void> {
    await this.ready()
    this.entries.set(entry.key, entry)
    await this.save()
  }

  /** A reading ended — read, or given up —: nothing to go on from. */
  async forget(key: string): Promise<void> {
    await this.ready()
    if (this.entries.delete(key)) await this.save()
  }

  /** Told at each change; returns how to stop being told. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async save(): Promise<void> {
    for (const listener of this.listeners) listener()
    await this.storage.write(FILE, JSON.stringify({ entries: [...this.entries.values()] }))
  }
}
