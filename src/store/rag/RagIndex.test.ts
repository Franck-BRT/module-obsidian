import { describe, expect, it } from 'vitest'
import type { App } from 'obsidian'
import { adapterStorage, RagIndex } from './RagIndex'
import { MemoryStorage, source, wordEmbedder } from './ragTestKit'

const MODEL = 'sidonie/embeddings-cnes-latest'

describe('RagIndex', () => {
  it('cuts and embeds each source once, and again only when it changes', async () => {
    const storage = new MemoryStorage()
    const index = new RagIndex(storage)
    const calls: string[][] = []
    const embed = wordEmbedder([], calls)
    const sources = [
      source('Notes/CR.md', '# CR\n\n## Décisions\n\nLe radier est décalé au 19/10.'),
      source('Notes/Vide.md', '')
    ]
    const progress: string[] = []
    expect(
      await index.update(sources, embed, { model: MODEL, onProgress: (p) => progress.push(`${p.done}/${p.total}`) })
    ).toEqual({ embedded: 2, removed: 0 })
    expect(progress).toEqual(['0/2', '1/2', '2/2'])
    expect(calls).toEqual([['CR › CR › Décisions\n\nLe radier est décalé au 19/10.']])
    expect(index.entry('Notes/CR.md')?.passages.map((p) => p.heading)).toEqual(['CR › Décisions'])
    expect(index.entry('Notes/Vide.md')?.passages).toEqual([])
    expect(index.passageCount).toBe(1)

    // Nothing changed: nothing sent.
    expect(await index.update(sources, embed, { model: MODEL })).toEqual({ embedded: 0, removed: 0 })
    expect(calls).toHaveLength(1)
    // One changed, one gone.
    const changed = [source('Notes/CR.md', '# CR\n\nLe radier est coulé.', { key: 'v2' })]
    expect(await index.update(changed, embed, { model: MODEL })).toEqual({ embedded: 1, removed: 1 })
    expect(index.entry('Notes/CR.md')?.passages[0].text).toBe('Le radier est coulé.')
    expect(index.sourceCount).toBe(1)
  })

  it('keeps what it made across a restart, and starts again for another model', async () => {
    const storage = new MemoryStorage()
    const first = new RagIndex(storage)
    const sources = [
      source('A.md', 'Radier.', { projects: ['P.md'], kind: 'ticket', title: 'Ticket A' }),
      source('B.md', 'Coffrage.')
    ]
    await first.update(sources, wordEmbedder(), { model: MODEL })

    const again = new RagIndex(storage)
    await again.load(MODEL)
    expect(again.all()).toHaveLength(2)
    const a = again.entry('A.md')
    expect(a).toMatchObject({ title: 'Ticket A', kind: 'ticket', projects: ['P.md'], key: sources[0].key })
    expect([...(a?.passages[0].vector ?? [])]).toEqual([...(first.entry('A.md')?.passages[0].vector ?? [])])
    expect(a?.passages[0].folded).toBe('ticket a\n\nradier.')
    const calls: string[][] = []
    await again.update(sources, wordEmbedder([], calls), { model: MODEL })
    expect(calls).toEqual([])

    const other = new RagIndex(storage)
    await other.load('another-model')
    expect(other.all()).toEqual([])
    expect(other.modelName).toBe('another-model')
  })

  it('is read once when asked for twice at once, both callers finding it read', async () => {
    const storage = new MemoryStorage()
    await new RagIndex(storage).update([source('A.md', 'Radier.')], wordEmbedder(), { model: MODEL })
    const index = new RagIndex(storage)
    const [first, second] = [index.load(MODEL), index.load(MODEL)]
    await second
    expect(index.passageCount).toBe(1)
    await first
  })

  it('sets aside what it cannot read: bad JSON, vectors of the wrong length, another version', async () => {
    const storage = new MemoryStorage()
    await new RagIndex(storage).update([source('A.md', 'Radier.')], wordEmbedder(), { model: MODEL })
    storage.files.set('vectors.bin', new ArrayBuffer(3))
    const short = new RagIndex(storage)
    await short.load(MODEL)
    expect(short.all()).toEqual([])
    storage.files.set('index.json', '{oops')
    const broken = new RagIndex(storage)
    await broken.load(MODEL)
    expect(broken.all()).toEqual([])
  })

  it('embeds in batches, stops when asked keeping what was done, and says so when the gateway sends too few', async () => {
    const storage = new MemoryStorage()
    const index = new RagIndex(storage)
    const long = Array.from({ length: 10 }, (_, i) => `## Partie ${i}\n\n${'mot '.repeat(250)}`).join('\n\n')
    const calls: string[][] = []
    await index.update([source('Long.md', long)], wordEmbedder([], calls), { model: MODEL, batch: 4 })
    expect(calls.map((batch) => batch.length)).toEqual([4, 4, 2])

    let asked = 0
    const stopping = new RagIndex(new MemoryStorage())
    const report = await stopping.update(
      [source('A.md', 'Un.'), source('B.md', 'Deux.'), source('C.md', 'Trois.')],
      wordEmbedder(),
      { model: MODEL, stop: () => ++asked > 3 }
    )
    expect(report.embedded).toBe(1)
    expect(stopping.all().map((entry) => entry.path)).toEqual(['A.md'])

    const short = async (texts: string[]) => (await wordEmbedder()(texts)).slice(1)
    await expect(
      new RagIndex(new MemoryStorage()).update([source('A.md', 'Un.')], short, { model: MODEL })
    ).rejects.toThrow('sent 0 embeddings for 1 texts')
  })

  it('saves as it goes on a long first indexing, and starts again when the vectors change size', async () => {
    const storage = new MemoryStorage()
    const index = new RagIndex(storage)
    const many = Array.from({ length: 5 }, (_, i) => source(`N${i}.md`, `Note ${i} radier.`))
    await index.update(many, wordEmbedder(), { model: MODEL, saveEvery: 0 })
    expect(storage.writes).toBe(6)
    const quiet = new MemoryStorage()
    await new RagIndex(quiet).update(many, wordEmbedder(), { model: MODEL })
    expect(quiet.writes).toBe(1)

    const wider = async (texts: string[]) => texts.map(() => new Array<number>(128).fill(1))
    await index.update([...many, source('New.md', 'Nouveau.')], wider, { model: MODEL })
    expect(
      index
        .all()
        .map((entry) => entry.path)
        .sort()
    ).toEqual(['N0.md', 'N1.md', 'N2.md', 'N3.md', 'N4.md', 'New.md'])
    expect(index.all().every((entry) => entry.passages.every((passage) => passage.vector.length === 128))).toBe(true)
    await index.clear()
    const reread = new RagIndex(storage)
    await reread.load(MODEL)
    expect(reread.all()).toEqual([])
  })
})

describe('adapterStorage', () => {
  it('keeps the index in a hidden folder it makes when first written to', async () => {
    const files = new Map<string, string | ArrayBuffer>()
    const folders = new Set<string>()
    const adapter = {
      exists: async (path: string) => files.has(path) || folders.has(path),
      mkdir: async (path: string) => {
        folders.add(path)
      },
      read: async (path: string) => files.get(path) as string,
      readBinary: async (path: string) => files.get(path) as ArrayBuffer,
      write: async (path: string, data: string) => {
        if (!folders.has(path.slice(0, path.lastIndexOf('/')))) throw new Error('no folder')
        files.set(path, data)
      },
      writeBinary: async (path: string, data: ArrayBuffer) => {
        if (!folders.has(path.slice(0, path.lastIndexOf('/')))) throw new Error('no folder')
        files.set(path, data)
      }
    }
    const storage = adapterStorage({ vault: { adapter } } as unknown as App, '.pm-rag')
    expect(await storage.read('index.json')).toBeNull()
    expect(await storage.readBinary('vectors.bin')).toBeNull()
    const index = new RagIndex(storage)
    await index.update([source('A.md', 'Radier.')], wordEmbedder(), { model: MODEL })
    expect([...files.keys()].sort()).toEqual(['.pm-rag/index.json', '.pm-rag/vectors.bin'])
    const again = new RagIndex(storage)
    await again.load(MODEL)
    expect(again.passageCount).toBe(1)
  })
})
