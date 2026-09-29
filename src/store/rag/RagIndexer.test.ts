import { afterEach, describe, expect, it, vi } from 'vitest'
import { RagIndex } from './RagIndex'
import { RagIndexer } from './RagIndexer'
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
    expect(failing.state).toEqual({ running: false, progress: null, error: 'Sidonie injoignable' })

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
})
