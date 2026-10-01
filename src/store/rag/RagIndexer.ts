import type { Embedder, RagIndex, RagProgress, RagSourceSpec } from './RagIndex'

/**
 * Keeps the vault index following the vault: one indexing at a time, run again when
 * something changed meanwhile, a moment after the last change rather than at every key
 * pressed, stopped when asked. What it is doing is said to whoever listens — the status
 * bar, the settings.
 */

export interface IndexerDeps {
  sources: () => RagSourceSpec[]
  embed: Embedder
  /** The embedding model; '' when none is set, and nothing is indexed. */
  model: () => string
  /** Whether the vault search is on. */
  enabled: () => boolean
  /** Made ready before the sources are listed: the library's texts loaded. */
  prepare?: () => Promise<void>
}

export interface IndexerState {
  running: boolean
  progress: RagProgress | null
  /** Why the last indexing stopped short; '' when it did not. */
  error: string
  /** How many sources were left to read when it last looked: new, or changed since. */
  pending: number
}

/** A source asked for now, and who waits for it. */
interface Urgent {
  source: RagSourceSpec
  done: (passages: number) => void
  failed: (error: Error) => void
}

/** Why a source asked for was not read: the indexing was stopped first. */
export class ReindexStopped extends Error {
  constructor() {
    super('stopped')
    this.name = 'ReindexStopped'
  }
}

export class RagIndexer {
  state: IndexerState = { running: false, progress: null, error: '', pending: 0 }
  private listeners = new Set<() => void>()
  private timer: number | null = null
  private again = false
  private stopping = false
  private current: Promise<void> | null = null
  private urgent: Urgent[] = []

  constructor(
    private index: RagIndex,
    private deps: IndexerDeps
  ) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  get ready(): boolean {
    return this.deps.enabled() && !!this.deps.model()
  }

  /** An indexing a moment from now, the moment put off by each change until they stop. */
  schedule(delay = 5000): void {
    if (!this.ready) return
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = null
      void this.run()
    }, delay)
  }

  /** Brings the index up to date now; asked while one runs, another follows it. */
  run(): Promise<void> {
    if (!this.ready) return Promise.resolve()
    if (this.current) {
      this.again = true
      return this.current
    }
    this.current = (async () => {
      do {
        this.again = false
        await this.once()
      } while (this.again && !this.stopping)
    })().finally(() => {
      this.current = null
      this.stopping = false
    })
    return this.current
  }

  private async once(): Promise<void> {
    this.state = { ...this.state, running: true, progress: null, error: '' }
    this.changed()
    let sources: RagSourceSpec[] = []
    let error = ''
    try {
      await this.deps.prepare?.()
      sources = this.deps.sources()
      await this.index.update(sources, this.deps.embed, {
        model: this.deps.model(),
        onProgress: (progress) => {
          this.state = { ...this.state, progress }
          this.changed()
        },
        stop: () => this.stopping,
        urgent: () => this.urgent[0]?.source,
        onIndexed: (path, passages) => {
          const at = this.urgent.findIndex((one) => one.source.path === path)
          if (at >= 0) this.urgent.splice(at, 1)[0].done(passages)
        }
      })
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure)
    }
    // Asked for and not read — stopped, or the gateway failing —: said to whoever waits.
    // Asked for as this one ended, it waits for the next, which asking it called for.
    if (error || this.stopping) {
      for (const left of this.urgent.splice(0)) left.failed(error ? new Error(error) : new ReindexStopped())
    }
    this.state = { running: false, progress: null, error, pending: sources.length ? this.index.pending(sources) : 0 }
    this.changed()
  }

  /**
   * One source read again now, changed or not — before those waiting, when an indexing
   * runs —: how many passages it was cut into, once it is. Null when the vault search
   * does not look through it — a folder left out, a kind of file it does not read.
   */
  async reindex(path: string): Promise<number | null> {
    if (!this.ready) return null
    await this.deps.prepare?.()
    const source = this.deps.sources().find((one) => one.path === path)
    if (!source) return null
    const read = new Promise<number>((resolve, reject) => this.urgent.push({ source, done: resolve, failed: reject }))
    void this.run()
    return read
  }

  /** How many sources are left to read, looked at now, without reading any. */
  async refreshPending(): Promise<void> {
    if (!this.ready || this.state.running) return
    await this.index.load(this.deps.model())
    await this.deps.prepare?.()
    this.state = { ...this.state, pending: this.index.pending(this.deps.sources()) }
    this.changed()
  }

  /** The indexing under way stopped after the passage it is at; what was done is kept. */
  stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
    if (this.current) this.stopping = true
  }

  /** Everything forgotten and made again. */
  async rebuild(): Promise<void> {
    this.stop()
    await this.current
    await this.index.load(this.deps.model())
    await this.index.clear()
    this.changed()
    await this.run()
  }

  dispose(): void {
    this.stop()
    this.listeners.clear()
  }
}
