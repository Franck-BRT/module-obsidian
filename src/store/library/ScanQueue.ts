/**
 * The documents being read by the model that sees, one after the other: the one being
 * read, the page it is at and since when, the ones waiting, and how the last one ended.
 *
 * Kept by the plugin rather than by a notice, which the reader may close: the library and
 * the status bar draw it from here, so a reading that runs for twenty minutes can be seen
 * running — or seen stuck, a page started long ago — and stopped.
 */

export interface ScanJob {
  /** What the document is known by: its record's path. */
  key: string
  title: string
  /** Reads it, saying each page as it starts, and asking between pages whether to stop. */
  run: (progress: (page: number, total: number) => void, stopped: () => boolean) => Promise<void>
}

export interface ScanCurrent {
  key: string
  title: string
  page: number
  total: number
  /** When the page being read was started, in milliseconds. */
  since: number
}

export interface ScanOutcome {
  title: string
  ok: boolean
  /** Why it failed, or that it was stopped. */
  reason?: string
}

/** What is said when a reading stops because the reader asked it to. */
export class ScanStopped extends Error {
  constructor() {
    super('stopped')
    this.name = 'ScanStopped'
  }
}

export class ScanQueue {
  current: ScanCurrent | null = null
  waiting: ScanJob[] = []
  last: ScanOutcome | null = null
  private stopping = false
  private listeners = new Set<() => void>()

  constructor(private now: () => number = () => Date.now()) {}

  /**
   * Adds documents to read, after those waiting; one already waiting or being read is not
   * added twice. Settles once the queue is empty, when this call started it; at once when
   * it was running already.
   */
  async add(jobs: ScanJob[]): Promise<void> {
    for (const job of jobs) {
      if (this.current?.key === job.key || this.waiting.some((one) => one.key === job.key)) continue
      this.waiting.push(job)
    }
    this.changed()
    if (this.current) return
    this.stopping = false
    while (this.waiting.length && !this.stopping) {
      const job = this.waiting.shift() as ScanJob
      this.current = { key: job.key, title: job.title, page: 0, total: 0, since: this.now() }
      this.changed()
      try {
        await job.run(
          (page, total) => {
            if (!this.current) return
            this.current = { ...this.current, page, total, since: this.now() }
            this.changed()
          },
          () => this.stopping
        )
        this.last = this.stopping ? { title: job.title, ok: false, reason: 'stopped' } : { title: job.title, ok: true }
      } catch (error) {
        this.last = {
          title: job.title,
          ok: false,
          reason: error instanceof ScanStopped ? 'stopped' : error instanceof Error ? error.message : String(error)
        }
      } finally {
        this.current = null
        this.changed()
      }
    }
    this.waiting = []
    this.stopping = false
    this.changed()
  }

  /** Stops after the page being read, and forgets the documents waiting. */
  stop(): void {
    if (!this.current && !this.waiting.length) return
    this.stopping = true
    this.waiting = []
    this.changed()
  }

  /** Where a document stands: being read, waiting, or neither. */
  stateOf(key: string): 'reading' | 'waiting' | null {
    if (this.current?.key === key) return 'reading'
    return this.waiting.some((job) => job.key === key) ? 'waiting' : null
  }

  /** The last outcome, forgotten once seen. */
  dismiss(): void {
    this.last = null
    this.changed()
  }

  /** Told at each change; returns how to stop being told. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}
