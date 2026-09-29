import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { DocLibrary } from '../library/DocLibrary'
import { DocTextIndex, type TextShelf } from '../library/DocTextIndex'
import { NoteLibrary } from '../notes/NoteLibrary'
import { chatNoteContent, readChatNote } from './chatNote'
import { documentSource, lookUp, noteSource, retrievalContext, type SourceWords } from './libraryRetrieval'

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
const WORDS: SourceWords = {
  document: 'Document',
  note: 'Note',
  issuedBy: (issuer) => `émis par ${issuer}`,
  addedOn: (date) => `versé le ${date}`
}
const GC = 'Work/Génie civil/Génie civil.md'
const title = (path: string): string => (path === GC ? 'Génie civil' : path)

describe('a question asked of the whole library', () => {
  it('finds the passages of the documents and notes it holds, and the conversation keeps where they came from', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    await fake.vault.create(GC, '---\npm-project: true\n---\n')
    const library = new DocLibrary(
      app,
      () => 'Library',
      () => ({ filesFolder: '_files', notesHeading: 'Notes' }),
      title
    )
    const texts = new DocTextIndex(app, new MemoryShelf(), {
      words: () => ({ from: 'De :', to: 'À :', date: 'Date :', attachments: 'PJ :' }),
      kept: async () => null
    })
    const notes = new NoteLibrary(app, () => 'Notes', title)

    await library.pour(
      [
        {
          kind: 'bytes',
          name: 'Planning GC S39.txt',
          bytes: bytes('Semaine 40 : ventilateurs.\n\nSemaine 42 : coulage du radier, réception le 16/10.')
        },
        { kind: 'bytes', name: 'Budget 2026.txt', bytes: bytes('Ventilation : 340 000 €.') }
      ],
      { projects: [GC], move: false, today: '2026-09-28', classification: { category: 'Planning', issuer: 'Setec' } }
    )
    await notes.create('CR réunion 12', '# CR réunion 12\n\nLe radier est décalé au 19/10.', 'Réunions')
    // Read once, as the library view does; a new chat finds it kept.
    await texts.refresh(library.docs())
    const fresh = new DocTextIndex(app, (texts as unknown as { shelf: TextShelf }).shelf, {
      words: () => ({ from: '', to: '', date: '', attachments: '' }),
      kept: async () => null
    })
    await fresh.load(library.docs())

    const sources = [
      ...library.docs().map((doc) => documentSource(doc, fresh.entry(doc)?.text ?? '', title, WORDS)),
      ...(await notes.entries()).map((entry) => noteSource(entry, notes.body(entry), title, WORDS))
    ]
    const found = lookUp(sources, ['Quand coule-t-on le radier ?'])
    expect(found.map((each) => each.source.path).sort()).toEqual([
      'Library/_files/Planning GC S39.txt',
      'Notes/Réunions/CR réunion 12.md'
    ])
    const planning = found.find((each) => each.source.kind === 'document')
    expect(planning?.source.detail).toBe('Document · Planning · émis par Setec · Génie civil · versé le 2026-09-28')
    const context = retrievalContext(found, { intro: 'INTRO', none: 'NONE', heading: (n, t) => `[${n}] ${t}` })
    expect(context).toContain('[[Library/_files/Planning GC S39.txt|Planning GC S39]]')
    expect(context).toContain('> Semaine 42 : coulage du radier, réception le 16/10.')
    expect(context).toContain('Note · Réunions')
    expect(context).not.toContain('340 000')

    // A follow-up too short to find anything by is looked up with the question before it.
    expect(lookUp(sources, ['Quand coule-t-on le radier ?', 'Et pour le lot 3 ?'])).toHaveLength(2)
    expect(lookUp(sources, ['Et pour le lot 3 ?'])).toEqual([])

    const question = {
      role: 'user' as const,
      content: 'Quand coule-t-on le radier ?',
      at: '2026-09-29T10:00:00.000Z',
      library: found.map((each) => each.source.path)
    }
    const saved = chatNoteContent({ title: 'Radier', model: 'm', created: question.at }, [question], {
      user: 'Question',
      assistant: 'Réponse'
    })
    expect(readChatNote(saved).turns[0].library).toEqual(question.library)
  })
})
