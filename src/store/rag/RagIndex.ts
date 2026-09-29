import { normalizePath, type App } from 'obsidian'
import { fold } from '../library/libraryDoc'
import { chunkText, embeddingInput } from './ragChunk'
import { quantize } from './ragVectors'

/**
 * The vault's passages and their embeddings, kept on this machine.
 *
 * Every note, ticket, project, conversation and library document is cut into passages;
 * each passage is placed by the gateway's embedding model once, and the vector kept here.
 * Only what changed since — by a key each source gives, its date and size — is sent again,
 * so the index follows the vault at the cost of what was written, not of what is there.
 *
 * Kept in a hidden folder of the vault, as two files: the passages as JSON, the vectors as
 * bytes one after another in the same order. Vectors from two models cannot be compared,
 * so a change of model starts the index again.
 */

export type RagKind = 'note' | 'document' | 'project' | 'ticket' | 'chat'

/** One source of passages, as the index is told of it. */
export interface RagSourceSpec {
  /** What a link to it opens: a note, a document's file. */
  path: string
  title: string
  kind: RagKind
  /** Changes when what it says changes: the index reads and embeds it again then only. */
  key: string
  /** The projects it belongs to, by their notes' paths. */
  projects: string[]
  /** What it says, its properties included. */
  read: () => Promise<string>
}

export interface RagPassage {
  heading: string
  text: string
  /** Its title, headings and text, folded, for the search by words. */
  folded: string
  vector: Int8Array
}

export interface RagEntry {
  path: string
  title: string
  kind: RagKind
  key: string
  projects: string[]
  passages: RagPassage[]
}

/** Where the index is kept. */
export interface RagStorage {
  read(name: string): Promise<string | null>
  readBinary(name: string): Promise<ArrayBuffer | null>
  write(name: string, data: string): Promise<void>
  writeBinary(name: string, data: ArrayBuffer): Promise<void>
}

/** Places texts in the embedding model's space, in the order given. */
export type Embedder = (texts: string[]) => Promise<number[][]>

export interface RagProgress {
  done: number
  total: number
}

export interface RagUpdate {
  /** Sources read and embedded, new or changed. */
  embedded: number
  removed: number
}

const VERSION = 1
const INDEX_FILE = 'index.json'
const VECTORS_FILE = 'vectors.bin'

interface SavedIndex {
  version: number
  model: string
  dims: number
  sources: {
    path: string
    title: string
    kind: RagKind
    key: string
    projects: string[]
    chunks: { h: string; t: string }[]
  }[]
}

/** A hidden folder of the vault, through the adapter: Obsidian neither lists nor indexes it. */
export function adapterStorage(app: App, folder: string): RagStorage {
  const adapter = app.vault.adapter
  const pathOf = (name: string): string => normalizePath(`${folder}/${name}`)
  const ready = async (): Promise<void> => {
    if (!(await adapter.exists(normalizePath(folder)))) await adapter.mkdir(normalizePath(folder))
  }
  return {
    async read(name) {
      return (await adapter.exists(pathOf(name))) ? adapter.read(pathOf(name)) : null
    },
    async readBinary(name) {
      return (await adapter.exists(pathOf(name))) ? adapter.readBinary(pathOf(name)) : null
    },
    async write(name, data) {
      await ready()
      await adapter.write(pathOf(name), data)
    },
    async writeBinary(name, data) {
      await ready()
      await adapter.writeBinary(pathOf(name), data)
    }
  }
}

export class RagIndex {
  private entries = new Map<string, RagEntry>()
  private model = ''
  private dims = 0
  private loadedFor: string | null = null
  private loading: Promise<void> = Promise.resolve()

  constructor(private storage: RagStorage) {}

  /** Every source indexed. */
  all(): RagEntry[] {
    return [...this.entries.values()]
  }

  entry(path: string): RagEntry | undefined {
    return this.entries.get(path)
  }

  get sourceCount(): number {
    return this.entries.size
  }

  get passageCount(): number {
    let count = 0
    for (const entry of this.entries.values()) count += entry.passages.length
    return count
  }

  /** The model the vectors were made by; '' while there are none. */
  get modelName(): string {
    return this.model
  }

  /**
   * What was kept, read once. Kept for another model, or in a shape this build does not
   * read, it is set aside: the index starts again.
   */
  load(model: string): Promise<void> {
    // Asked twice at once — by the chat and the indexing —, read once, both waiting for it.
    if (this.loadedFor === model) return this.loading
    this.loadedFor = model
    this.loading = this.read(model)
    return this.loading
  }

  private async read(model: string): Promise<void> {
    this.entries.clear()
    this.model = model
    this.dims = 0
    const raw = await this.storage.read(INDEX_FILE)
    if (!raw) return
    let saved: SavedIndex
    try {
      saved = JSON.parse(raw) as SavedIndex
    } catch {
      return
    }
    if (saved.version !== VERSION || saved.model !== model || !saved.dims) return
    const bytes = await this.storage.readBinary(VECTORS_FILE)
    const vectors = bytes ? new Int8Array(bytes) : new Int8Array(0)
    const needed = saved.sources.reduce((sum, source) => sum + source.chunks.length, 0) * saved.dims
    if (vectors.length !== needed) return
    this.dims = saved.dims
    let row = 0
    for (const source of saved.sources) {
      this.entries.set(source.path, {
        path: source.path,
        title: source.title,
        kind: source.kind,
        key: source.key,
        projects: source.projects,
        passages: source.chunks.map((chunk) => {
          const vector = vectors.slice(row * saved.dims, (row + 1) * saved.dims)
          row++
          return { heading: chunk.h, text: chunk.t, folded: folded(source.title, chunk.h, chunk.t), vector }
        })
      })
    }
  }

  /**
   * Brings the index up to date with the sources: those new or changed are read, cut
   * and embedded, those gone are forgotten. Saved as it goes, so a long first indexing
   * stopped half way keeps the half done. `stop` is asked between batches.
   */
  async update(
    sources: RagSourceSpec[],
    embed: Embedder,
    options: {
      model: string
      batch?: number
      onProgress?: (progress: RagProgress) => void
      stop?: () => boolean
      /** Saved at most this often while it works, in milliseconds: the whole index is written each time. */
      saveEvery?: number
    }
  ): Promise<RagUpdate> {
    await this.load(options.model)
    const batch = options.batch ?? 32
    const saveEvery = options.saveEvery ?? 60000
    const wanted = new Set(sources.map((source) => source.path))
    let removed = 0
    for (const path of [...this.entries.keys()]) {
      if (!wanted.has(path)) {
        this.entries.delete(path)
        removed++
      }
    }
    const todo = sources.filter((source) => this.entries.get(source.path)?.key !== source.key)
    const progress = { done: 0, total: todo.length }
    options.onProgress?.({ ...progress })
    let embedded = 0
    let savedAt = Date.now()
    for (const source of todo) {
      if (options.stop?.()) break
      const chunks = chunkText(await source.read())
      const vectors: number[][] = []
      for (let at = 0; at < chunks.length; at += batch) {
        if (options.stop?.()) break
        const inputs = chunks.slice(at, at + batch).map((chunk) => embeddingInput(source.title, chunk))
        const got = await embed(inputs)
        if (got.length !== inputs.length) {
          throw new Error(`The gateway sent ${got.length} embeddings for ${inputs.length} texts.`)
        }
        vectors.push(...got)
      }
      if (vectors.length !== chunks.length) break
      if (vectors.length && vectors[0].length !== this.dims) {
        const restart = this.dims > 0 && this.entries.size > 0
        this.dims = vectors[0].length
        if (restart) {
          // Another size of vector: another model answered under the same name. What was
          // made by the one before cannot be compared with it: all of it is made again.
          this.entries.clear()
          return this.update(sources, embed, options)
        }
      }
      this.entries.set(source.path, {
        path: source.path,
        title: source.title,
        kind: source.kind,
        key: source.key,
        projects: source.projects,
        passages: chunks.map((chunk, at) => ({
          heading: chunk.heading,
          text: chunk.text,
          folded: folded(source.title, chunk.heading, chunk.text),
          vector: quantize(vectors[at])
        }))
      })
      embedded++
      progress.done++
      options.onProgress?.({ ...progress })
      if (Date.now() - savedAt >= saveEvery) {
        await this.save()
        savedAt = Date.now()
      }
    }
    if (embedded || removed) await this.save()
    return { embedded, removed }
  }

  /** Written whole: the passages as JSON, the vectors after one another as bytes. */
  async save(): Promise<void> {
    const entries = this.all()
    const rows = entries.reduce((sum, entry) => sum + entry.passages.length, 0)
    const vectors = new Int8Array(rows * this.dims)
    let row = 0
    for (const entry of entries) {
      for (const passage of entry.passages) {
        vectors.set(passage.vector.subarray(0, this.dims), row * this.dims)
        row++
      }
    }
    const saved: SavedIndex = {
      version: VERSION,
      model: this.model,
      dims: this.dims,
      sources: entries.map((entry) => ({
        path: entry.path,
        title: entry.title,
        kind: entry.kind,
        key: entry.key,
        projects: entry.projects,
        chunks: entry.passages.map((passage) => ({ h: passage.heading, t: passage.text }))
      }))
    }
    await this.storage.writeBinary(VECTORS_FILE, vectors.buffer)
    await this.storage.write(INDEX_FILE, JSON.stringify(saved))
  }

  /** Everything forgotten, on disk too: the next update embeds the vault again. */
  async clear(): Promise<void> {
    this.entries.clear()
    this.dims = 0
    await this.save()
  }
}

function folded(title: string, heading: string, text: string): string {
  return fold(`${title}\n${heading}\n${text}`)
}
