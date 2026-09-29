import { normalizePath, TFile, type App } from 'obsidian'
import { decodeText, encodeText, extractText, TEXT_LIMIT, type DocText, type MailWords } from './docText'
import { fold, type LibraryDoc } from './libraryDoc'

/**
 * What every document in the library says, read once and kept.
 *
 * Kept by the document's fingerprint, one small file each in a hidden folder of the
 * library's: Obsidian neither lists nor indexes it, and a library of a thousand
 * documents opens without one being read again. A file changed since it was read is read
 * again; so is every file when the readers improve.
 *
 * Reading runs in the background, one document after another, and says how far it has
 * got; only one reading runs at a time, and one asked for meanwhile runs once it is done.
 */

/** Where the texts are kept: read and written by key. */
export interface TextShelf {
  read(key: string): Promise<string | null>
  write(key: string, raw: string): Promise<void>
}

/** The shelf as files in a folder the vault's own index leaves alone. */
export function folderShelf(app: App, folder: () => string): TextShelf {
  const adapter = app.vault.adapter
  const pathOf = (key: string): string => normalizePath(`${folder()}/${key}.txt`)
  return {
    async read(key) {
      const path = pathOf(key)
      return (await adapter.exists(path)) ? adapter.read(path) : null
    },
    async write(key, raw) {
      const dir = normalizePath(folder())
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir)
      await adapter.write(pathOf(key), raw)
    }
  }
}

export interface TextIndexDeps {
  words: () => MailWords
  /** A scan's transcription, when one is kept beside it for the file as it now is. */
  kept: (file: TFile) => Promise<string | null>
}

export interface TextProgress {
  done: number
  total: number
}

export class DocTextIndex {
  private entries = new Map<string, DocText>()
  private foldedTexts = new Map<string, string>()
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private queued: LibraryDoc[] | null = null
  /** How far the reading has got, while one is running. */
  progress: TextProgress | null = null

  constructor(
    private app: App,
    private shelf: TextShelf,
    private deps: TextIndexDeps
  ) {}

  /** What is known of a document's text; nothing until it has been read. */
  entry(doc: LibraryDoc): DocText | undefined {
    return doc.hash ? this.entries.get(doc.hash) : undefined
  }

  /** Its text folded for searching, worked out once. */
  folded(doc: LibraryDoc): string {
    const entry = this.entry(doc)
    if (!entry?.text) return ''
    let folded = this.foldedTexts.get(doc.hash)
    if (folded === undefined) {
      folded = fold(entry.text)
      this.foldedTexts.set(doc.hash, folded)
    }
    return folded
  }

  /** Told whenever a text is read or kept; returns the way to stop being told. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  private set(hash: string, entry: DocText): void {
    this.entries.set(hash, entry)
    this.foldedTexts.delete(hash)
  }

  private async keep(hash: string, entry: DocText): Promise<void> {
    this.set(hash, entry)
    await this.shelf.write(hash, encodeText(entry))
  }

  /**
   * The texts kept for these documents brought into memory, none read anew: what a search
   * needs at once, before the reading of new ones has had its turn.
   */
  async load(docs: LibraryDoc[]): Promise<void> {
    for (const doc of docs) {
      if (!doc.hash || this.entries.has(doc.hash)) continue
      const raw = await this.shelf.read(doc.hash)
      const decoded = raw === null ? null : decodeText(raw)
      if (decoded) this.set(doc.hash, decoded)
    }
  }

  /**
   * Brings the texts up to date with the documents: what was kept is loaded, what was
   * never read, or has changed since, is read. The promise settles once all of it is.
   */
  refresh(docs: LibraryDoc[]): Promise<void> {
    if (this.running) {
      this.queued = docs
      return this.running
    }
    this.running = (async () => {
      let next: LibraryDoc[] | null = docs
      while (next) {
        this.queued = null
        try {
          await this.run(next)
        } finally {
          this.progress = null
          this.changed()
        }
        next = this.queued
      }
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  private fileOf(doc: LibraryDoc): TFile | null {
    const file = doc.file ? this.app.vault.getAbstractFileByPath(doc.file) : null
    return file instanceof TFile ? file : null
  }

  private async run(docs: LibraryDoc[]): Promise<void> {
    const todo: { doc: LibraryDoc; file: TFile }[] = []
    const seen = new Set<string>()
    for (const doc of docs) {
      const file = this.fileOf(doc)
      if (!doc.hash || !file || seen.has(doc.hash)) continue
      seen.add(doc.hash)
      let entry = this.entries.get(doc.hash)
      if (!entry) {
        const raw = await this.shelf.read(doc.hash)
        const decoded = raw === null ? null : decodeText(raw)
        if (decoded) {
          this.set(doc.hash, decoded)
          entry = decoded
        }
      }
      if (!entry || entry.mtime !== file.stat.mtime) todo.push({ doc, file })
      else if (entry.state === 'scan') {
        // A scan read since — by the chat, for a question about it — is found by that.
        const kept = await this.deps.kept(file)
        if (kept) {
          await this.keep(doc.hash, { state: 'ok', text: kept.slice(0, TEXT_LIMIT), mtime: file.stat.mtime, ocr: true })
        }
      }
    }
    this.progress = { done: 0, total: todo.length }
    this.changed()
    for (const { doc, file } of todo) {
      await this.read(doc.hash, file)
      this.progress = { done: this.progress.done + 1, total: todo.length }
      this.changed()
    }
  }

  private async read(hash: string, file: TFile): Promise<void> {
    let entry: DocText
    try {
      const kept = await this.deps.kept(file)
      if (kept) entry = { state: 'ok', text: kept.slice(0, TEXT_LIMIT), mtime: file.stat.mtime, ocr: true }
      else {
        const bytes = new Uint8Array(await this.app.vault.readBinary(file))
        entry = { ...(await extractText(file.name, bytes, this.deps.words())), mtime: file.stat.mtime }
      }
    } catch {
      entry = { state: 'unreadable', text: '', mtime: file.stat.mtime }
    }
    await this.keep(hash, entry)
  }

  /** Reads a document again, whatever was kept of it. */
  async reread(doc: LibraryDoc): Promise<void> {
    const file = this.fileOf(doc)
    if (!doc.hash || !file) return
    await this.read(doc.hash, file)
    this.changed()
  }

  /**
   * A scan, read by a model: `read` hands back what the model made of it, which is kept as
   * the document's text from then on.
   */
  async readScan(doc: LibraryDoc, read: (file: TFile, bytes: Uint8Array) => Promise<string>): Promise<void> {
    const file = this.fileOf(doc)
    if (!doc.hash || !file) return
    const text = await read(file, new Uint8Array(await this.app.vault.readBinary(file)))
    await this.keep(doc.hash, { state: 'ok', text: text.slice(0, TEXT_LIMIT), mtime: file.stat.mtime, ocr: true })
    this.changed()
  }

  /** How the library's texts stand: read, scans waiting for a model, and the rest. */
  counts(docs: LibraryDoc[]): { read: number; scans: number; unread: number; pending: number } {
    const counts = { read: 0, scans: 0, unread: 0, pending: 0 }
    for (const doc of docs) {
      const entry = this.entry(doc)
      // A document whose file is gone, or whose record was written by hand, has nothing to read.
      if (!doc.hash || !doc.file) counts.unread++
      else if (!entry) counts.pending++
      else if (entry.state === 'ok') counts.read++
      else if (entry.state === 'scan') counts.scans++
      else counts.unread++
    }
    return counts
  }
}
