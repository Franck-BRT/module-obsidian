import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { DocLibrary } from '../library/DocLibrary'
import { DocTextIndex, type TextShelf } from '../library/DocTextIndex'
import { RagIndex } from './RagIndex'
import { RagIndexer } from './RagIndexer'
import { lookUpVault, SEARCH_DEFAULTS, vaultContext } from './ragSearch'
import { excludedFolders, vaultSources } from './ragSources'
import { MemoryStorage, wordEmbedder } from './ragTestKit'

class MemoryShelf implements TextShelf {
  kept = new Map<string, string>()
  async read(key: string): Promise<string | null> {
    return this.kept.get(key) ?? null
  }
  async write(key: string, raw: string): Promise<void> {
    this.kept.set(key, raw)
  }
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('a question asked of the whole vault', () => {
  it('is answered from the notes, tickets and documents that say it, cited by their links, and follows the vault', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const v = fake.vault
    await v.create('Work/GC/GC.md', '---\npm-project: true\n---\n# Génie civil')
    await v.create(
      'Work/GC/_tasks/t1.md',
      '---\npm-task: true\nid: t1\ntitle: Réception du fond de fouille\nstatus: en attente\nassignee: Anne\n---\nÀ faire avant le bétonnage.'
    )
    await v.create('Notes/CR 12.md', '# CR réunion 12\n\n## Décisions\n\nLe coulage du radier est décalé au 19/10.')
    await v.create('Archives/Ancien.md', 'Le radier sera coulé en 2019.')
    const library = new DocLibrary(
      app,
      () => 'Library',
      () => ({ filesFolder: '_files', notesHeading: 'Notes' }),
      (p) => p
    )
    const texts = new DocTextIndex(app, new MemoryShelf(), {
      words: () => ({ from: '', to: '', date: '', attachments: '' }),
      kept: async () => null
    })
    await library.pour(
      [{ kind: 'bytes', name: 'Planning.txt', bytes: bytes('Semaine 42 : bétonnage du radier, le 16/10.') }],
      {
        projects: ['Work/GC/GC.md'],
        move: false,
        today: '2026-09-29',
        classification: { category: 'Planning' }
      }
    )
    await texts.refresh(library.docs())

    const embed = wordEmbedder([['coulage', 'coule', 'coulee', 'betonnage', 'bétonnage']])
    const index = new RagIndex(new MemoryStorage())
    const indexer = new RagIndexer(index, {
      sources: () =>
        vaultSources({
          app,
          library,
          texts,
          excluded: excludedFolders('Archives'),
          words: { category: 'Catégorie', lot: 'Lot', issuer: 'Émetteur', tags: 'Étiquettes' }
        }),
      embed,
      model: () => 'sidonie/embeddings-cnes-latest',
      enabled: () => true
    })
    await indexer.run()
    expect(
      index
        .all()
        .map((entry) => entry.path)
        .sort()
    ).toEqual(['Library/_files/Planning.txt', 'Notes/CR 12.md', 'Work/GC/GC.md', 'Work/GC/_tasks/t1.md'])

    const reranked: string[] = []
    const { query, report } = await lookUpVault(
      index,
      {
        question: 'et le radier, on le coule quand ?',
        history: [
          { role: 'user', content: 'Où en est le génie civil ?' },
          { role: 'assistant', content: 'En cours.' }
        ],
        rewrite: async () => 'date de coulage du radier du génie civil',
        instruction: 'CONSIGNE'
      },
      {
        embed: async (text) => (await embed([text]))[0],
        rerank: async (_query, texts) => {
          reranked.push(...texts)
          return texts.map((text) => (text.includes('19/10') ? 2 : text.includes('16/10') ? 1 : 0))
        }
      },
      { ...SEARCH_DEFAULTS, projects: ['Work/GC/GC.md'] }
    )
    expect(query).toBe('date de coulage du radier du génie civil')
    expect(report.used).toEqual({ vectors: true, rerank: true })
    expect(report.found.slice(0, 2).map((each) => each.entry.path)).toEqual([
      'Notes/CR 12.md',
      'Library/_files/Planning.txt'
    ])
    expect(reranked.some((text) => text.startsWith('CR 12 › CR réunion 12 › Décisions'))).toBe(true)
    const context = vaultContext(report.found, {
      intro: 'INTRO',
      none: 'NONE',
      heading: (n, t) => `[${n}] ${t}`,
      kind: (k) => k
    })
    expect(context).toContain('note · [[Notes/CR 12.md|CR 12]]')
    expect(context).toContain('> **CR réunion 12 › Décisions**')
    expect(context).toContain('document · [[Library/_files/Planning.txt|Planning]]')
    expect(context).not.toContain('2019')

    // A note changed is indexed again; one deleted is forgotten.
    const cr = v.getAbstractFileByPath('Notes/CR 12.md') as unknown as { stat: { mtime: number } }
    await v.modify(cr as never, '# CR réunion 12\n\nRadier coulé le 21/10.')
    // As Obsidian says of a file written: a new date.
    cr.stat.mtime += 1000
    await v.trashFile(v.getAbstractFileByPath('Work/GC/_tasks/t1.md') as never)
    await indexer.run()
    expect(index.entry('Notes/CR 12.md')?.passages[0].text).toBe('Radier coulé le 21/10.')
    expect(index.entry('Work/GC/_tasks/t1.md')).toBeUndefined()
  })
})
