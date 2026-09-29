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
}

export class RagIndexer {
  state: IndexerState = { running: false, progress: null, error: '' }
  private listeners = new Set<() => void>()
  private timer: number | null = null
  private again = false
  private stopping = false
  private current: Promise<void> | null = null

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
    this.state = { running: true, progress: null, error: '' }
    this.changed()
    try {
      await this.deps.prepare?.()
      await this.index.update(this.deps.sources(), this.deps.embed, {
        model: this.deps.model(),
        onProgress: (progress) => {
          this.state = { ...this.state, progress }
          this.changed()
        },
        stop: () => this.stopping
      })
      this.state = { running: false, progress: null, error: '' }
    } catch (error) {
      this.state = { running: false, progress: null, error: error instanceof Error ? error.message : String(error) }
    }
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
