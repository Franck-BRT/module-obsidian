import { afterEach, describe, expect, it, vi } from 'vitest'
import { RagIndex } from './RagIndex'
import { RagIndexer, ReindexStopped } from './RagIndexer'
import { MemoryStorage, source, wordEmbedder } from './ragTestKit'

const MODEL = 'sidonie/embeddings-cnes-latest'

describe('RagIndexer', () => {
  afterEach(() => vi.useRealTimers())

  it('indexes when asked, says how far it has got, and does nothing without a model or switched off', async () => {
    const index = new RagIndex(new MemoryStorage())
    let enabled = true
    let model = MODEL
    const sources = [source('A.md', 'Radier.'), source('B.md', 'Coffrage.')]
    const indexer = new RagIndexer(index, {
      sources: () => sources,
      embed: wordEmbedder(),
      model: () => model,
      enabled: () => enabled
    })
    const seen: string[] = []
    indexer.onChange(() => seen.push(indexer.state.running ? `${indexer.state.progress?.done ?? '-'}` : 'idle'))
    await indexer.run()
    expect(index.sourceCount).toBe(2)
    expect(seen).toEqual(['-', '0', '1', '2', 'idle'])

    enabled = false
    await indexer.run()
    model = ''
    enabled = true
    expect(indexer.ready).toBe(false)
    await indexer.run()
    expect(seen.at(-1)).toBe('idle')
    expect(seen).toHaveLength(5)
  })

  it('runs once at a time, and once more when asked meanwhile', async () => {
    const index = new RagIndex(new MemoryStorage())
    let sources = [source('A.md', 'Radier.')]
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    let started: () => void = () => undefined
    const embedding = new Promise<void>((resolve) => (started = resolve))
    const embed = wordEmbedder()
    let calls = 0
    const indexer = new RagIndexer(index, {
      sources: () => sources,
      embed: async (texts) => {
        calls++
        if (calls === 1) {
          started()
          await gate
        }
        return embed(texts)
      },
      model: () => MODEL,
      enabled: () => true
    })
    const first = indexer.run()
    // Changed while the first indexing is embedding what it listed before.
    await embedding
    sources = [source('A.md', 'Radier.'), source('B.md', 'Nouvelle.')]
    const second = indexer.run()
    expect(second).toBe(first)
    release()
    await first
    expect(index.all().map((entry) => entry.path)).toEqual(['A.md', 'B.md'])
  })

  it('says why it stopped short, and stops when asked keeping what was done', async () => {
    const index = new RagIndex(new MemoryStorage())
    const failing = new RagIndexer(index, {
      sources: () => [source('A.md', 'Radier.')],
      embed: async () => {
        throw new Error('Sidonie injoignable')
      },
      model: () => MODEL,
      enabled: () => true
    })
    await failing.run()
    expect(failing.state).toEqual({ running: false, progress: null, error: 'Sidonie injoignable', pending: 1 })

    const embed = wordEmbedder()
    const stopping = new RagIndexer(index, {
      sources: () => [source('A.md', 'Un.'), source('B.md', 'Deux.'), source('C.md', 'Trois.')],
      embed: async (texts) => {
        stopping.stop()
        return embed(texts)
      },
      model: () => MODEL,
      enabled: () => true
    })
    await stopping.run()
    expect(index.all().map((entry) => entry.path)).toEqual(['A.md'])
  })

  it('waits for the changes to stop before indexing, and makes everything again when asked', async () => {
    vi.useFakeTimers()
    const index = new RagIndex(new MemoryStorage())
    const calls: string[][] = []
    const indexer = new RagIndexer(index, {
      sources: () => [source('A.md', 'Radier.')],
      embed: wordEmbedder([], calls),
      model: () => MODEL,
      enabled: () => true
    })
    indexer.schedule(1000)
    vi.advanceTimersByTime(900)
    indexer.schedule(1000)
    vi.advanceTimersByTime(900)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    await vi.waitFor(() => expect(index.sourceCount).toBe(1))
    expect(calls).toHaveLength(1)
    vi.useRealTimers()
    await indexer.rebuild()
    expect(calls).toHaveLength(2)
    indexer.dispose()
  })

  it('reads one note again when asked, unchanged, and counts what is left to read', async () => {
    const index = new RagIndex(new MemoryStorage())
    const sources = [source('A.md', 'Radier coulé.'), source('B.md', 'Coffrage posé.')]
    const calls: string[][] = []
    const indexer = new RagIndexer(index, {
      sources: () => sources,
      embed: wordEmbedder([], calls),
      model: () => MODEL,
      enabled: () => true
    })
    await indexer.refreshPending()
    expect(indexer.state.pending).toBe(2)
    await indexer.run()
    expect(indexer.state.pending).toBe(0)
    calls.length = 0
    // Unchanged, read again all the same; nothing else is.
    expect(await indexer.reindex('A.md')).toBe(1)
    expect(calls.flat().join(' ')).toContain('Radier')
    expect(calls.flat().join(' ')).not.toContain('Coffrage')
    // A note the search does not look through: nothing to do.
    expect(await indexer.reindex('Exclu/C.md')).toBeNull()
    sources.push(source('C.md', 'Dalle.'))
    await indexer.refreshPending()
    expect(indexer.state.pending).toBe(1)
  })

  it('reads a note asked for during a long indexing before those still waiting', async () => {
    const index = new RagIndex(new MemoryStorage())
    const sources = ['A', 'B', 'C', 'D'].map((name) => source(`${name}.md`, `Texte ${name}.`))
    const order: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const embed = wordEmbedder()
    const indexer = new RagIndexer(index, {
      sources: () => sources,
      embed: async (texts) => {
        order.push(texts[0].includes('Texte A') ? 'A' : texts[0].replace(/[\s\S]*Texte (\w)[\s\S]*/, '$1'))
        if (order.length === 1) await gate
        return embed(texts)
      },
      model: () => MODEL,
      enabled: () => true
    })
    const running = indexer.run()
    await Promise.resolve()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const asked = indexer.reindex('D.md')
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    release()
    expect(await asked).toBe(1)
    await running
    expect(order).toEqual(['A', 'D', 'B', 'C'])
  })

  it('says a note asked for was not read when the indexing is stopped first, or fails', async () => {
    const index = new RagIndex(new MemoryStorage())
    const indexer = new RagIndexer(index, {
      sources: () => [source('A.md', 'Radier.')],
      embed: () => Promise.reject(new Error('gateway down')),
      model: () => MODEL,
      enabled: () => true
    })
    await expect(indexer.reindex('A.md')).rejects.toThrow('gateway down')
    expect(indexer.state.error).toBe('gateway down')

    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const embed = wordEmbedder()
    const stopped = new RagIndexer(new RagIndex(new MemoryStorage()), {
      sources: () => [source('A.md', 'Radier.'), source('B.md', 'Dalle.')],
      embed: async (texts) => {
        await gate
        return embed(texts)
      },
      model: () => MODEL,
      enabled: () => true
    })
    const running = stopped.run()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    const asked = stopped.reindex('B.md')
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    stopped.stop()
    release()
    await expect(asked).rejects.toBeInstanceOf(ReindexStopped)
    await running
  })
})
