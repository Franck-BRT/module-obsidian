import { TFile, type App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { DocLibrary, type PourItem } from './DocLibrary'
import { parseCategories } from './libraryClass'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const outside = (name: string, text: string): PourItem => ({ kind: 'bytes', name, bytes: bytes(text) })
const TITLES: Record<string, string> = {
  'Work/Génie civil/Génie civil.md': 'Génie civil',
  'Work/Tunnel/Tunnel.md': 'Tunnel'
}
const GC = 'Work/Génie civil/Génie civil.md'
const TUNNEL = 'Work/Tunnel/Tunnel.md'
const TODAY = '2026-09-28'

describe('DocLibrary', () => {
  let vault: FakeVault
  let library: DocLibrary

  const fileAt = (path: string): TFile => {
    const file = vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) throw new Error(`no file at ${path}`)
    return file
  }

  beforeEach(async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    await vault.create(GC, '---\npm-project: true\n---\n')
    await vault.create(TUNNEL, '---\npm-project: true\n---\n')
    library = new DocLibrary(
      fake.app as unknown as App,
      () => 'Bibliothèque',
      () => ({ filesFolder: 'Fichiers', notesHeading: 'Notes' }),
      (path) => TITLES[path] ?? path
    )
  })

  it('keeps a file brought from outside in its folder, with a record naming its projects', async () => {
    const report = await library.pour([outside('Planning_GC  S39.pdf', 'planning')], {
      projects: [GC, TUNNEL],
      move: false,
      today: TODAY
    })
    expect(report).toMatchObject({ added: ['Bibliothèque/Planning_GC  S39.md'], known: [], failed: [] })
    expect(report.docs.map((each) => each.record)).toEqual(report.added)
    expect(vault.getAbstractFileByPath('Bibliothèque/Fichiers/Planning_GC  S39.pdf')).toBeInstanceOf(TFile)
    const [doc] = library.docs()
    expect(doc).toMatchObject({
      record: 'Bibliothèque/Planning_GC  S39.md',
      title: 'Planning GC S39',
      file: 'Bibliothèque/Fichiers/Planning_GC  S39.pdf',
      projects: [GC, TUNNEL],
      added: TODAY,
      size: 8
    })
    expect(doc.hash).toMatch(/^[0-9a-f]{64}$/)
    const record = vault.contentAt(doc.record) ?? ''
    expect(record).toContain('file: "[[Bibliothèque/Fichiers/Planning_GC  S39.pdf]]"')
    expect(record).toContain('"[[Génie civil|Génie civil]]"')
    expect(record).toContain('## Notes')
  })

  it('files a document that belongs to no project too', async () => {
    await library.pour([outside('Norme.pdf', 'norme')], { projects: [], move: false, today: TODAY })
    expect(library.docs()[0].projects).toEqual([])
  })

  it('knows the same bytes poured again, even under another name, and only adds the projects', async () => {
    await library.pour([outside('CR 12.pdf', 'compte rendu')], { projects: [GC], move: false, today: TODAY })
    const report = await library.pour([outside('CR 12 (copie).pdf', 'compte rendu')], {
      projects: [TUNNEL, GC],
      move: false,
      today: TODAY
    })
    expect(report).toMatchObject({ added: [], docs: [], known: ['Bibliothèque/CR 12.md'], failed: [] })
    expect(library.docs()).toHaveLength(1)
    expect(library.docs()[0].projects).toEqual([GC, TUNNEL])
    expect(vault.getAbstractFileByPath('Bibliothèque/Fichiers/CR 12 (copie).pdf')).toBeNull()
  })

  it('pours two copies in the same batch once', async () => {
    const report = await library.pour([outside('a.pdf', 'même'), outside('b.pdf', 'même')], {
      projects: [],
      move: false,
      today: TODAY
    })
    expect(report.added).toHaveLength(1)
    expect(report.known).toEqual(['Bibliothèque/a.md'])
  })

  it('writes nothing when a known document already has the projects', async () => {
    await library.pour([outside('x.pdf', 'x')], { projects: [GC], move: false, today: TODAY })
    const before = vault.modifyCount.get('Bibliothèque/x.md') ?? 0
    await library.pour([outside('x.pdf', 'x')], { projects: [GC], move: false, today: TODAY })
    expect(vault.modifyCount.get('Bibliothèque/x.md') ?? 0).toBe(before)
  })

  it('does not overwrite two different files of the same name', async () => {
    await library.pour([outside('Plan.pdf', 'un'), outside('Plan.pdf', 'deux')], {
      projects: [],
      move: false,
      today: TODAY
    })
    expect(
      library
        .docs()
        .map((doc) => doc.file)
        .sort()
    ).toEqual(['Bibliothèque/Fichiers/Plan-1.pdf', 'Bibliothèque/Fichiers/Plan.pdf'])
  })

  it('leaves a vault file where it is unless asked to move it', async () => {
    const file = await vault.createBinary('Inbox/Devis.pdf', bytes('devis').buffer as ArrayBuffer)
    await library.pour([{ kind: 'vault', file }], { projects: [GC], move: false, today: TODAY })
    expect(library.docs()[0].file).toBe('Inbox/Devis.pdf')
  })

  it('moves a vault file into the library when asked', async () => {
    const file = await vault.createBinary('Inbox/Devis.pdf', bytes('devis').buffer as ArrayBuffer)
    await library.pour([{ kind: 'vault', file }], { projects: [], move: true, today: TODAY })
    expect(vault.getAbstractFileByPath('Inbox/Devis.pdf')).toBeNull()
    expect(library.docs()[0].file).toBe('Bibliothèque/Fichiers/Devis.pdf')
  })

  it('never moves a file a project keeps in its documents', async () => {
    const file = await vault.createBinary('Work/Tunnel/_docs/Plan.pdf', bytes('plan').buffer as ArrayBuffer)
    await library.pour([{ kind: 'vault', file }], { projects: [TUNNEL], move: true, today: TODAY })
    expect(library.docs()[0].file).toBe('Work/Tunnel/_docs/Plan.pdf')
  })

  it('does not move a file already in the library folder', async () => {
    const file = await vault.createBinary('Bibliothèque/Fichiers/Scan.pdf', bytes('scan').buffer as ArrayBuffer)
    await library.pour([{ kind: 'vault', file }], { projects: [], move: true, today: TODAY })
    expect(library.docs()[0].file).toBe('Bibliothèque/Fichiers/Scan.pdf')
  })

  it('names a project once even when it is given twice', async () => {
    await library.pour([outside('x.pdf', 'x')], { projects: [GC, GC], move: false, today: TODAY })
    expect((vault.contentAt('Bibliothèque/x.md') ?? '').split('Génie civil|').length - 1).toBe(1)
  })

  it('reads a project named twice by hand, in two ways, once', async () => {
    await vault.create(
      'Bibliothèque/Main.md',
      '---\npm-library-doc: true\nprojects:\n  - "[[Génie civil]]"\n  - "[[Work/Génie civil/Génie civil.md|GC]]"\n  - "[[Nulle part]]"\n---\n'
    )
    expect(library.docs()[0]).toMatchObject({ title: 'Main', file: '', projects: [GC] })
  })

  it('knows a vault file already recorded by its path', async () => {
    const file = await vault.createBinary('Inbox/Devis.pdf', bytes('devis').buffer as ArrayBuffer)
    await library.pour([{ kind: 'vault', file }], { projects: [], move: false, today: TODAY })
    const report = await library.pour([{ kind: 'vault', file }], { projects: [GC], move: false, today: TODAY })
    expect(report.known).toEqual(['Bibliothèque/Devis.md'])
    expect(library.docs()[0].projects).toEqual([GC])
  })

  it('reports a file it could not pour and goes on with the others', async () => {
    const gone = await vault.createBinary('Inbox/Parti.pdf', bytes('parti').buffer as ArrayBuffer)
    await vault.trashFile(gone)
    const progress: number[] = []
    const report = await library.pour(
      [{ kind: 'vault', file: gone }, outside('Reste.pdf', 'reste')],
      { projects: [], move: false, today: TODAY },
      (done) => progress.push(done)
    )
    expect(report.failed.map((failure) => failure.name)).toEqual(['Parti.pdf'])
    expect(report.added).toEqual(['Bibliothèque/Reste.md'])
    expect(progress).toEqual([1, 2])
  })

  it('says a document belongs to other projects, and to none', async () => {
    await library.pour([outside('x.pdf', 'x')], { projects: [GC], move: false, today: TODAY })
    await library.setProjects(library.docs()[0], [TUNNEL])
    expect(library.docs()[0].projects).toEqual([TUNNEL])
    await library.setProjects(library.docs()[0], [])
    expect(library.docs()[0].projects).toEqual([])
  })

  it('follows its file when the file is renamed', async () => {
    await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY })
    const record = 'Bibliothèque/x.md'
    await vault.process(fileAt(record), (text) => text.replace('Fichiers/x.pdf', 'Fichiers/y.pdf'))
    await vault.rename(fileAt('Bibliothèque/Fichiers/x.pdf'), 'Bibliothèque/Fichiers/y.pdf')
    expect(library.docs()[0].file).toBe('Bibliothèque/Fichiers/y.pdf')
  })

  it('takes a document out with the file it brought in, and leaves a file that was only recorded', async () => {
    const inVault = await vault.createBinary('Inbox/Devis.pdf', bytes('devis').buffer as ArrayBuffer)
    await library.pour([outside('x.pdf', 'x'), { kind: 'vault', file: inVault }], {
      projects: [],
      move: false,
      today: TODAY
    })
    for (const doc of library.docs()) await library.remove(doc)
    expect(library.docs()).toEqual([])
    expect(vault.getAbstractFileByPath('Bibliothèque/Fichiers/x.pdf')).toBeNull()
    expect(vault.getAbstractFileByPath('Inbox/Devis.pdf')).toBeInstanceOf(TFile)
  })

  it('pours documents, not the plugin’s own notes nor hidden files', async () => {
    const note = await vault.create('Notes/CR.md', '---\ntags: [cr]\n---\nCompte rendu')
    const hidden = await vault.createBinary('Notes/.DS_Store', bytes('x').buffer as ArrayBuffer)
    const pdf = await vault.createBinary('Notes/Plan.pdf', bytes('plan').buffer as ArrayBuffer)
    await vault.create('Chats/Conversation.md', '---\npm-chat: true\n---\n')
    await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY })
    expect(library.pourable(note)).toBe(true)
    expect(library.pourable(pdf)).toBe(true)
    expect(library.pourable(hidden)).toBe(false)
    expect(library.pourable(fileAt(GC))).toBe(false)
    expect(library.pourable(fileAt('Chats/Conversation.md'))).toBe(false)
    expect(library.pourable(fileAt('Bibliothèque/x.md'))).toBe(false)
  })

  it('files what it pours: the classification given, the category guessed from the name when none is', async () => {
    const categories = parseCategories('Plan : plan, coupe\nCompte rendu : cr, réunion')
    await library.pour(
      [outside('CR réunion 12.pdf', 'cr'), outside('Coupe AA.pdf', 'coupe'), outside('Divers.pdf', 'd')],
      {
        projects: [],
        move: false,
        today: TODAY,
        categories,
        classification: { lot: 'Lot 2', issuer: 'Setec', tags: ['#chantier', 'zone B'] }
      }
    )
    const byTitle = new Map(library.docs().map((doc) => [doc.title, doc]))
    expect(byTitle.get('CR réunion 12')).toMatchObject({
      category: 'Compte rendu',
      lot: 'Lot 2',
      issuer: 'Setec',
      tags: ['chantier', 'zone-B']
    })
    expect(byTitle.get('Coupe AA')?.category).toBe('Plan')
    expect(byTitle.get('Divers')?.category).toBe('')
    // A category given is not second-guessed.
    await library.pour([outside('CR 13.pdf', 'cr13')], {
      projects: [],
      move: false,
      today: TODAY,
      categories,
      classification: { category: 'Plan' }
    })
    expect(library.docs().find((doc) => doc.title === 'CR 13')?.category).toBe('Plan')
  })

  it('poured again, keeps how it was filed and only fills what it lacked', async () => {
    await library.pour([outside('x.pdf', 'x')], {
      projects: [],
      move: false,
      today: TODAY,
      classification: { category: 'Plan', tags: ['a'] }
    })
    await library.pour([outside('x.pdf', 'x')], {
      projects: [],
      move: false,
      today: TODAY,
      classification: { category: 'Devis', lot: 'Lot 3', tags: ['b'] }
    })
    expect(library.docs()[0]).toMatchObject({ category: 'Plan', lot: 'Lot 3', tags: ['a', 'b'] })
    const before = vault.modifyCount.get('Bibliothèque/x.md') ?? 0
    await library.pour([outside('x.pdf', 'x')], {
      projects: [],
      move: false,
      today: TODAY,
      classification: { category: 'Devis', lot: 'Lot 4', tags: ['a'] }
    })
    expect(vault.modifyCount.get('Bibliothèque/x.md') ?? 0).toBe(before)
  })

  it('files a document again, the fields given replacing, tags added, and takes tags off', async () => {
    await library.pour([outside('x.pdf', 'x')], {
      projects: [],
      move: false,
      today: TODAY,
      classification: { category: 'Plan', lot: 'Lot 1', tags: ['a'] }
    })
    await library.classify(library.docs()[0], { lot: 'Lot 2', issuer: '', tags: ['b'] })
    expect(library.docs()[0]).toMatchObject({ category: 'Plan', lot: 'Lot 2', issuer: '', tags: ['a', 'b'] })
    await library.untag(library.docs()[0], ['A'])
    expect(library.docs()[0].tags).toEqual(['b'])
  })

  it('reads a lot written as a bare number, and tags written with a hash', async () => {
    await vault.create('Bibliothèque/Main.md', '---\npm-library-doc: true\nlot: 2\ntags:\n  - "#chantier"\n---\n')
    expect(library.docs()[0]).toMatchObject({ lot: '2', category: '', issuer: '', tags: ['chantier'] })
  })

  it('finds a record wherever it has been moved, and tells records from other notes', async () => {
    await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY })
    const record = fileAt('Bibliothèque/x.md')
    await vault.rename(record, 'Ailleurs/x.md')
    expect(library.docs().map((doc) => doc.record)).toEqual(['Ailleurs/x.md'])
    expect(library.isRecord(record)).toBe(true)
    expect(library.isRecord(fileAt(GC))).toBe(false)
  })
})
