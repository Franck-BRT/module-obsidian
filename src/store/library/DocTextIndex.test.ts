import { TFile, type App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { encodeText, TEXT_VERSION } from './docText'
import { DocTextIndex, type TextShelf } from './DocTextIndex'
import type { LibraryDoc } from './libraryDoc'

const WORDS = { from: 'De :', to: 'À :', date: 'Date :', attachments: 'Pièces jointes :' }
const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer

class MemoryShelf implements TextShelf {
  kept = new Map<string, string>()
  reads = 0
  writes = 0
  async read(key: string): Promise<string | null> {
    this.reads++
    return this.kept.get(key) ?? null
  }
  async write(key: string, raw: string): Promise<void> {
    this.writes++
    this.kept.set(key, raw)
  }
}

const docOf = (hash: string, file: string): LibraryDoc => ({
  record: `L/${hash}.md`,
  title: hash,
  file,
  projects: [],
  added: '2026-09-28',
  size: 1,
  hash,
  category: '',
  lot: '',
  issuer: '',
  tags: [],
  folder: ''
})

describe('DocTextIndex', () => {
  let vault: FakeVault
  let app: App
  let shelf: MemoryShelf
  let transcripts: Map<string, string>
  let index: DocTextIndex

  const make = (): DocTextIndex =>
    new DocTextIndex(app, shelf, {
      words: () => WORDS,
      kept: async (file: TFile) => transcripts.get(file.path) ?? null
    })

  beforeEach(() => {
    const fake = makeFakeApp()
    vault = fake.vault
    app = fake.app as unknown as App
    shelf = new MemoryShelf()
    transcripts = new Map()
    index = make()
  })

  it('reads each document once, keeps what it says, and says how far it has got', async () => {
    await vault.createBinary('L/_files/cr.txt', bytes('Le radier est décalé.'))
    await vault.createBinary('L/_files/photo.jpg', bytes('jpeg'))
    const docs = [docOf('a', 'L/_files/cr.txt'), docOf('b', 'L/_files/photo.jpg')]
    const seen: (number | null)[] = []
    index.onChange(() => seen.push(index.progress?.done ?? null))
    await index.refresh(docs)
    expect(index.entry(docs[0])).toMatchObject({ state: 'ok', text: 'Le radier est décalé.' })
    expect(index.entry(docs[1])).toMatchObject({ state: 'scan' })
    expect(index.folded(docs[0])).toBe('le radier est decale.')
    expect(seen).toEqual([0, 1, 2, null])
    expect(index.progress).toBeNull()
    expect(shelf.kept.get('a')).toMatch(new RegExp(`^pm-text ${TEXT_VERSION} ok `))
    expect(index.counts(docs)).toEqual({ read: 1, scans: 1, unread: 0, pending: 0 })
  })

  it('loads what was kept at once, without reading a document never read nor one changed since', async () => {
    const file = await vault.createBinary('L/_files/cr.txt', bytes('Nouveau texte'))
    await vault.createBinary('L/_files/new.txt', bytes('Jamais lu'))
    shelf.kept.set('a', encodeText({ state: 'ok', text: 'Texte gardé', mtime: file.stat.mtime - 1 }))
    const docs = [docOf('a', 'L/_files/cr.txt'), docOf('b', 'L/_files/new.txt'), docOf('', 'L/_files/new.txt')]
    await index.load(docs)
    expect(index.entry(docs[0])?.text).toBe('Texte gardé')
    expect(index.entry(docs[1])).toBeUndefined()
    // Loaded once: what is in memory is not read from the shelf again.
    shelf.kept.set('a', encodeText({ state: 'ok', text: 'Autre', mtime: 0 }))
    await index.load(docs)
    expect(index.entry(docs[0])?.text).toBe('Texte gardé')
  })

  it('takes what was kept instead of reading again, and reads again a file changed since', async () => {
    const file = await vault.createBinary('L/_files/cr.txt', bytes('Nouveau texte'))
    shelf.kept.set('a', encodeText({ state: 'ok', text: 'Texte gardé', mtime: file.stat.mtime }))
    shelf.kept.set('b', encodeText({ state: 'ok', text: 'Ancien texte', mtime: file.stat.mtime - 1 }))
    await vault.createBinary('L/_files/autre.txt', bytes('Autre texte'))
    await index.refresh([docOf('a', 'L/_files/cr.txt'), docOf('b', 'L/_files/autre.txt')])
    expect(index.entry(docOf('a', ''))?.text).toBe('Texte gardé')
    expect(index.entry(docOf('b', ''))?.text).toBe('Autre texte')
  })

  it('reads again what an older reader kept', async () => {
    const file = await vault.createBinary('L/_files/cr.txt', bytes('Texte'))
    shelf.kept.set('a', `pm-text ${TEXT_VERSION - 1} ok ${file.stat.mtime}\nvieux`)
    await index.refresh([docOf('a', 'L/_files/cr.txt')])
    expect(index.entry(docOf('a', ''))?.text).toBe('Texte')
  })

  it('reads the same bytes once, and leaves out a document with no file or no fingerprint', async () => {
    await vault.createBinary('L/_files/cr.txt', bytes('Texte'))
    await index.refresh([
      docOf('a', 'L/_files/cr.txt'),
      docOf('a', 'L/_files/cr.txt'),
      docOf('c', ''),
      docOf('', 'L/_files/cr.txt')
    ])
    expect([...shelf.kept.keys()]).toEqual(['a'])
    expect(shelf.writes).toBe(1)
    expect(index.counts([docOf('c', ''), docOf('', 'L/_files/cr.txt')])).toEqual({
      read: 0,
      scans: 0,
      unread: 2,
      pending: 0
    })
  })

  it('reads a scan by the transcription kept beside it, even one made after it was first seen', async () => {
    await vault.createBinary('L/_files/planning.pdf', bytes('%PDF'))
    const doc = docOf('p', 'L/_files/planning.pdf')
    shelf.kept.set('p', encodeText({ state: 'scan', text: '', mtime: 0 }))
    await vault.createBinary('L/_files/photo.png', bytes('png'))
    const photo = docOf('q', 'L/_files/photo.png')
    await index.refresh([photo])
    expect(index.entry(photo)?.state).toBe('scan')
    transcripts.set('L/_files/photo.png', '| Radier | 19/10 |')
    transcripts.set('L/_files/planning.pdf', 'Planning lu')
    await index.refresh([doc, photo])
    expect(index.entry(doc)).toMatchObject({ state: 'ok', text: 'Planning lu', ocr: true })
    expect(index.entry(photo)).toMatchObject({ state: 'ok', text: '| Radier | 19/10 |', ocr: true })
  })

  it('takes a scan’s kept transcription the first time it sees it, without reading the file', async () => {
    await vault.createBinary('L/_files/planning.pdf', bytes('%PDF'))
    transcripts.set('L/_files/planning.pdf', 'Planning lu par le chat')
    const doc = docOf('p', 'L/_files/planning.pdf')
    await index.refresh([doc])
    expect(index.entry(doc)).toMatchObject({ state: 'ok', text: 'Planning lu par le chat', ocr: true })
  })

  it('takes a transcription as the reader corrected it since, and leaves the others be', async () => {
    await vault.createBinary('L/_files/planning.pdf', bytes('%PDF'))
    transcripts.set('L/_files/planning.pdf', '| Radier | 19/10 |')
    const doc = docOf('p', 'L/_files/planning.pdf')
    await index.refresh([doc])
    const writes = shelf.writes
    await index.refresh([doc])
    expect(shelf.writes).toBe(writes)
    transcripts.set('L/_files/planning.pdf', '| Radier | 20/10 |')
    await index.refresh([doc])
    expect(index.entry(doc)).toMatchObject({ state: 'ok', text: '| Radier | 20/10 |', ocr: true })
  })

  it('keeps what a model made of a scan as its text', async () => {
    await vault.createBinary('L/_files/photo.png', bytes('png'))
    const photo = docOf('q', 'L/_files/photo.png')
    await index.refresh([photo])
    await index.readScan(photo, async (file, data) => `lu : ${file.name} (${data.length} octets)`)
    expect(index.entry(photo)).toMatchObject({ state: 'ok', text: 'lu : photo.png (3 octets)', ocr: true })
    // Kept too: another index finds it without asking the model again.
    const again = make()
    await again.refresh([photo])
    expect(again.entry(photo)?.text).toBe('lu : photo.png (3 octets)')
  })

  it('reads a document again when asked, and forgets its folded text', async () => {
    const file = await vault.createBinary('L/_files/cr.txt', bytes('Avant'))
    const doc = docOf('a', 'L/_files/cr.txt')
    await index.refresh([doc])
    expect(index.folded(doc)).toBe('avant')
    await vault.process(file, () => 'Après')
    await index.reread(doc)
    expect(index.folded(doc)).toBe('apres')
  })

  it('runs one reading at a time, and the one asked for meanwhile after it', async () => {
    await vault.createBinary('L/_files/a.txt', bytes('A'))
    await vault.createBinary('L/_files/b.txt', bytes('B'))
    const first = index.refresh([docOf('a', 'L/_files/a.txt')])
    const second = index.refresh([docOf('b', 'L/_files/b.txt')])
    expect(second).toBe(first)
    await first
    expect(index.entry(docOf('a', ''))?.text).toBe('A')
    expect(index.entry(docOf('b', ''))?.text).toBe('B')
  })
})
