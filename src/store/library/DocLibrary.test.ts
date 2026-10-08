import { TFile, type App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { DocLibrary, findVaultFile, type PourItem } from './DocLibrary'
import { derivedFrom, likelyPair, otherLanguages, sourceCandidates } from './libraryDoc'
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

  it('links a new issue of a document to the one before it, and the one after to it', async () => {
    await library.pour([outside('CCTP lot 02 ind A.pdf', 'indice A')], { projects: [GC], move: false, today: TODAY })
    const report = await library.pour([outside('CCTP lot 02 ind B.pdf', 'indice B')], {
      projects: [GC],
      move: false,
      today: TODAY
    })
    expect(report.versions.map((one) => [one.doc.title, one.previous.title])).toEqual([
      ['CCTP lot 02 ind B', 'CCTP lot 02 ind A']
    ])
    const byTitle = (title: string) => library.docs().find((doc) => doc.title === title)
    // Said, not done: linked only once the reader agrees.
    expect(byTitle('CCTP lot 02 ind B')?.previous).toBeUndefined()
    const [found] = report.versions
    await library.setPrevious(found.doc, found.previous)
    expect(byTitle('CCTP lot 02 ind B')?.previous).toBe('Bibliothèque/CCTP lot 02 ind A.md')
    expect(byTitle('CCTP lot 02 ind A')?.previous).toBeUndefined()
    const next = await library.pour([outside('CCTP lot 02 ind C.pdf', 'indice C')], {
      projects: [GC],
      move: false,
      today: TODAY
    })
    // The last of its line is the one it follows.
    expect(next.versions.map((one) => one.previous.title)).toEqual(['CCTP lot 02 ind B'])
    await library.setPrevious(next.versions[0].doc, next.versions[0].previous)
    expect(byTitle('CCTP lot 02 ind C')?.previous).toBe('Bibliothèque/CCTP lot 02 ind B.md')
    // Unlinked by hand, it follows none.
    const c = byTitle('CCTP lot 02 ind C')
    if (c) await library.setPrevious(c, null)
    expect(byTitle('CCTP lot 02 ind C')?.previous).toBeUndefined()
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

  it('pours documents into the collections asked, one already there added to them', async () => {
    await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY, collections: ['Normes'] })
    expect(library.docs()[0].collections).toEqual(['Normes'])
    await library.pour([outside('x.pdf', 'x')], {
      projects: [],
      move: false,
      today: TODAY,
      collections: ['normes', 'CCTP']
    })
    expect(library.docs()).toHaveLength(1)
    expect(library.docs()[0].collections).toEqual(['Normes', 'CCTP'])
  })

  it('gathers a document in collections, kept in its record, and takes it out again', async () => {
    await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY })
    await library.setCollections(library.docs()[0], ['CCTP Lot 02', ' Normes ', 'CCTP Lot 02'])
    expect(library.docs()[0].collections).toEqual(['CCTP Lot 02', 'Normes'])
    await library.setCollections(library.docs()[0], [])
    expect(library.docs()[0].collections).toEqual([])
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

  it('pours a file under its own title, projects and issuer, its category guessed from the title too', async () => {
    const plan = await vault.createBinary('Work/Tunnel/_docs/PL-001.pdf', bytes('plan').buffer as ArrayBuffer)
    const categories = parseCategories('Plan : plan, coupe')
    await library.pour(
      [
        {
          kind: 'vault',
          file: plan,
          title: 'Plan de coffrage',
          projects: [TUNNEL],
          classification: { issuer: 'Setec' }
        }
      ],
      { projects: [GC], move: true, today: TODAY, categories }
    )
    expect(library.docs()[0]).toMatchObject({
      title: 'Plan de coffrage',
      file: 'Work/Tunnel/_docs/PL-001.pdf',
      projects: [GC, TUNNEL],
      issuer: 'Setec',
      category: 'Plan'
    })
    // Poured again under another register, the same file only gains that project.
    await library.pour([{ kind: 'vault', file: plan, projects: ['Work/Autre/Autre.md'] }], {
      projects: [],
      move: false,
      today: TODAY
    })
    expect(library.docs()).toHaveLength(1)
  })

  it('gives a document already there the projects of the register it is poured from again', async () => {
    const plan = await vault.createBinary('Work/Tunnel/_docs/Plan.pdf', bytes('plan').buffer as ArrayBuffer)
    await library.pour([{ kind: 'vault', file: plan }], { projects: [GC], move: false, today: TODAY })
    await library.pour([{ kind: 'vault', file: plan, projects: [TUNNEL] }], { projects: [], move: false, today: TODAY })
    expect(library.docs()[0].projects).toEqual([GC, TUNNEL])
  })

  it('finds a record wherever it has been moved, and tells records from other notes', async () => {
    await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY })
    const record = fileAt('Bibliothèque/x.md')
    await vault.rename(record, 'Ailleurs/x.md')
    expect(library.docs().map((doc) => doc.record)).toEqual(['Ailleurs/x.md'])
    expect(library.isRecord(record)).toBe(true)
    expect(library.isRecord(fileAt(GC))).toBe(false)
  })

  it('finds a file however its accents were written', async () => {
    const composed = 'Work/Génie civil/_docs/Réception.pdf'.normalize('NFC')
    await vault.createBinary(composed, bytes('x').buffer as ArrayBuffer)
    const app = { vault } as unknown as App
    expect(findVaultFile(app, composed.normalize('NFD'))?.path).toBe(composed)
    expect(findVaultFile(app, composed)?.path).toBe(composed)
    expect(findVaultFile(app, 'Work/Ailleurs.pdf')).toBeNull()
  })

  describe('folders', () => {
    it('makes folders, lists them in order without the files folders, and tells where each record is', async () => {
      expect(library.folders()).toEqual([])
      expect(await library.createFolder('Marchés')).toBe('Marchés')
      expect(await library.createFolder('Lot 2', 'Marchés')).toBe('Marchés/Lot 2')
      expect(await library.createFolder(' / ')).toBe('')
      await library.pour([outside('a.pdf', 'a')], { projects: [], move: false, today: TODAY, folder: 'Marchés/Lot 2' })
      await library.pour([outside('b.pdf', 'b')], { projects: [], move: false, today: TODAY })
      await vault.create('Bibliothèque/.cache/x.md', 'x')
      expect(library.folders()).toEqual(['Marchés', 'Marchés/Lot 2'])
      const byTitle = Object.fromEntries(library.docs().map((doc) => [doc.title, doc.folder]))
      expect(byTitle).toEqual({ a: 'Marchés/Lot 2', b: '' })
    })

    it('pours into a folder: the record in it, the file brought in beside it', async () => {
      const report = await library.pour([outside('Plan.pdf', 'plan')], {
        projects: [],
        move: false,
        today: TODAY,
        folder: 'Plans'
      })
      expect(report.added).toEqual(['Bibliothèque/Plans/Plan.md'])
      expect(report.docs[0]).toMatchObject({ folder: 'Plans', file: 'Bibliothèque/Plans/Fichiers/Plan.pdf' })
      expect(library.docs()[0]).toMatchObject({ folder: 'Plans', file: 'Bibliothèque/Plans/Fichiers/Plan.pdf' })
    })

    it('moves a vault file into the folder’s files when asked', async () => {
      const inVault = await vault.createBinary('Inbox/Devis.pdf', bytes('devis').buffer as ArrayBuffer)
      await library.pour([{ kind: 'vault', file: inVault }], {
        projects: [],
        move: true,
        today: TODAY,
        folder: 'Devis'
      })
      expect(library.docs()[0]).toMatchObject({
        record: 'Bibliothèque/Devis/Devis.md',
        file: 'Bibliothèque/Devis/Fichiers/Devis.pdf'
      })
    })

    it('says a record outside the library is in none of its folders', async () => {
      await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY, folder: 'A' })
      await vault.rename(fileAt('Bibliothèque/A/x.md'), 'Bibliothèque-bis/A/x.md')
      expect(library.docs()[0].folder).toBe('')
    })

    it('moves a document with the file it keeps, and back to the root', async () => {
      await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY })
      const moves = await library.moveTo(library.docs()[0], 'Marchés/Lot 2')
      const record = 'Bibliothèque/Marchés/Lot 2/x.md'
      expect([...moves]).toEqual([
        ['Bibliothèque/x.md', record],
        ['Bibliothèque/Fichiers/x.pdf', 'Bibliothèque/Marchés/Lot 2/Fichiers/x.pdf']
      ])
      expect(library.docs()[0]).toMatchObject({
        record,
        folder: 'Marchés/Lot 2',
        file: 'Bibliothèque/Marchés/Lot 2/Fichiers/x.pdf'
      })
      expect(vault.contentAt(record)).toContain('file: "[[Bibliothèque/Marchés/Lot 2/Fichiers/x.pdf]]"')
      expect(vault.getAbstractFileByPath('Bibliothèque/Fichiers/x.pdf')).toBeNull()

      await library.moveTo(library.docs()[0], '')
      expect(library.docs()[0]).toMatchObject({
        record: 'Bibliothèque/x.md',
        folder: '',
        file: 'Bibliothèque/Fichiers/x.pdf'
      })
    })

    it('never moves over another document of the same name', async () => {
      await library.pour([outside('x.pdf', 'one')], { projects: [], move: false, today: TODAY })
      await library.pour([outside('x.pdf', 'two')], { projects: [], move: false, today: TODAY, folder: 'A' })
      const atRoot = library.docs().find((doc) => doc.folder === '')
      if (!atRoot) throw new Error('no document at the root')
      await library.moveTo(atRoot, 'A')
      const records = library.docs().map((doc) => doc.record)
      expect(records.sort()).toEqual(['Bibliothèque/A/x-1.md', 'Bibliothèque/A/x.md'].sort())
      const files = library.docs().map((doc) => doc.file)
      expect(new Set(files).size).toBe(2)
      expect(files.every((file) => file.startsWith('Bibliothèque/A/Fichiers/'))).toBe(true)
    })

    it('leaves a file only recorded where it lives there: only its record moves', async () => {
      const inVault = await vault.createBinary('Work/Tunnel/_docs/Plan.pdf', bytes('plan').buffer as ArrayBuffer)
      await library.pour([{ kind: 'vault', file: inVault }], { projects: [], move: false, today: TODAY })
      const moves = await library.moveTo(library.docs()[0], 'A')
      expect([...moves]).toEqual([['Bibliothèque/Plan.md', 'Bibliothèque/A/Plan.md']])
      expect(library.docs()[0]).toMatchObject({ record: 'Bibliothèque/A/Plan.md', file: 'Work/Tunnel/_docs/Plan.pdf' })
    })

    it('leaves a document already in the folder as it is', async () => {
      await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY, folder: 'A' })
      const before = vault.contentAt('Bibliothèque/A/x.md')
      expect((await library.moveTo(library.docs()[0], 'A')).size).toBe(0)
      expect(vault.contentAt('Bibliothèque/A/x.md')).toBe(before)
      expect(library.docs()[0].file).toBe('Bibliothèque/A/Fichiers/x.pdf')
    })

    it('takes a document out with the file a folder keeps for it', async () => {
      await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY, folder: 'A' })
      const inLibrary = await vault.createBinary('Bibliothèque/A/Loose.pdf', bytes('loose').buffer as ArrayBuffer)
      await library.pour([{ kind: 'vault', file: inLibrary }], { projects: [], move: false, today: TODAY })
      const docs = library.docs()
      expect(docs.map((doc) => library.holdsFile(doc)).sort()).toEqual([false, true])
      for (const doc of docs) await library.remove(doc)
      expect(vault.getAbstractFileByPath('Bibliothèque/A/Fichiers/x.pdf')).toBeNull()
      // Put in the library's folder by hand, not brought in by it: only its record goes.
      expect(vault.getAbstractFileByPath('Bibliothèque/A/Loose.pdf')).toBeInstanceOf(TFile)
    })

    it('never takes for its own a file outside it in a folder of the same name as its files', async () => {
      const elsewhere = await vault.createBinary(
        'Archives du chantier/Fichiers/Devis.pdf',
        bytes('devis').buffer as ArrayBuffer
      )
      await library.pour([{ kind: 'vault', file: elsewhere }], { projects: [], move: false, today: TODAY })
      const [doc] = library.docs()
      expect(library.holdsFile(doc)).toBe(false)
      await library.remove(doc)
      expect(vault.getAbstractFileByPath('Archives du chantier/Fichiers/Devis.pdf')).toBeInstanceOf(TFile)
    })

    it('renames a folder where it is, its documents still finding their files', async () => {
      await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY, folder: 'Marchés/Lot 2' })
      await library.createFolder('Autre')
      const renamed = await library.renameFolder('Marchés/Lot 2', 'Lot 2 bis')
      expect(renamed?.folder).toBe('Marchés/Lot 2 bis')
      expect([...(renamed?.moves ?? [])].sort()).toEqual([
        ['Bibliothèque/Marchés/Lot 2/Fichiers/x.pdf', 'Bibliothèque/Marchés/Lot 2 bis/Fichiers/x.pdf'],
        ['Bibliothèque/Marchés/Lot 2/x.md', 'Bibliothèque/Marchés/Lot 2 bis/x.md']
      ])
      expect(library.docs()[0]).toMatchObject({
        folder: 'Marchés/Lot 2 bis',
        file: 'Bibliothèque/Marchés/Lot 2 bis/Fichiers/x.pdf'
      })
      expect(library.folders()).toEqual(['Autre', 'Marchés', 'Marchés/Lot 2 bis'])
    })

    it('renames a folder by a name only, never onto another folder nor to nothing', async () => {
      await library.createFolder('A')
      await library.createFolder('B')
      expect(await library.renameFolder('A', 'B')).toBeNull()
      expect(await library.renameFolder('A', ' / ')).toBeNull()
      expect(await library.renameFolder('', 'C')).toBeNull()
      expect(await library.renameFolder('Nowhere', 'C')).toBeNull()
      expect((await library.renameFolder('A', 'x/y'))?.folder).toBe('x y')
      expect((await library.renameFolder('B', 'B'))?.moves.size).toBe(0)
      expect(library.folders()).toEqual(['B', 'x y'])
    })

    it('takes a folder out: its documents go up, the files it keeps into the parent’s files, its folders whole', async () => {
      await library.pour([outside('x.pdf', 'one')], { projects: [], move: false, today: TODAY, folder: 'M' })
      await library.pour([outside('x.pdf', 'two')], { projects: [], move: false, today: TODAY, folder: 'M/Lot' })
      await library.pour([outside('x.pdf', 'three')], { projects: [], move: false, today: TODAY })
      const moves = await library.deleteFolder('M')
      expect(vault.getAbstractFileByPath('Bibliothèque/M')).toBeNull()
      expect(library.folders()).toEqual(['Lot'])
      const docs = library
        .docs()
        .map((doc) => [doc.folder, doc.record, doc.file])
        .sort()
      expect(docs).toEqual([
        ['', 'Bibliothèque/x-1.md', 'Bibliothèque/Fichiers/x-1.pdf'],
        ['', 'Bibliothèque/x.md', 'Bibliothèque/Fichiers/x.pdf'],
        ['Lot', 'Bibliothèque/Lot/x.md', 'Bibliothèque/Lot/Fichiers/x.pdf']
      ])
      expect(moves.get('Bibliothèque/M/Fichiers/x.pdf')).toBe('Bibliothèque/Fichiers/x-1.pdf')
      expect(moves.get('Bibliothèque/M/Lot/Fichiers/x.pdf')).toBe('Bibliothèque/Lot/Fichiers/x.pdf')
      expect(vault.contentAt('Bibliothèque/x-1.md')).toContain('file: "[[Bibliothèque/Fichiers/x-1.pdf]]"')
    })

    it('takes a folder at no depth out into the root, and nothing when there is no such folder', async () => {
      expect((await library.deleteFolder('')).size).toBe(0)
      expect((await library.deleteFolder('Nowhere')).size).toBe(0)
      await library.pour([outside('x.pdf', 'x')], { projects: [], move: false, today: TODAY, folder: 'A/B' })
      await library.deleteFolder('A/B')
      expect(library.docs()[0]).toMatchObject({ folder: 'A', file: 'Bibliothèque/A/Fichiers/x.pdf' })
      expect(library.folders()).toEqual(['A'])
    })
  })

  describe('ghosts', () => {
    const pourInto = (folder: string, name = 'Glossaire.pdf') =>
      library.pour([outside(name, 'glossaire DLA')], { projects: [], move: false, today: TODAY, folder, ghosts: true })

    it('leaves a ghost, not a copy, where a document already there is poured again', async () => {
      await pourInto('Normes')
      const report = await pourInto('Lot 2', 'Glossaire (copie).pdf')
      expect(report.added).toEqual([])
      expect(report.known).toEqual(['Bibliothèque/Normes/Glossaire.md'])
      expect(report.ghosts?.map((one) => one.ghost)).toEqual(['Bibliothèque/Lot 2/Glossaire.md'])
      expect(library.docs()).toHaveLength(1)
      const [entry] = library.ghosts()
      expect(entry.ghost).toMatchObject({ folder: 'Lot 2', title: 'Glossaire' })
      expect(entry.doc?.record).toBe('Bibliothèque/Normes/Glossaire.md')
      // Poured there again, or into its own folder: nothing more.
      expect((await pourInto('Lot 2')).ghosts ?? []).toEqual([])
      expect((await pourInto('Normes')).ghosts ?? []).toEqual([])
      expect(library.ghosts()).toHaveLength(1)
    })

    it('leaves no ghost when no folder was chosen', async () => {
      await pourInto('Normes')
      const report = await library.pour([outside('Glossaire.pdf', 'glossaire DLA')], {
        projects: [],
        move: false,
        today: TODAY
      })
      expect(report.ghosts ?? []).toEqual([])
      expect(library.ghosts()).toEqual([])
    })

    it('puts a document in the folder of reference, a ghost left where it was', async () => {
      await pourInto('Normes')
      await pourInto('Lot 2')
      const [doc] = library.docs()
      await library.toReference(doc, 'Références')
      const [moved] = library.docs()
      expect(moved.record).toBe('Bibliothèque/Références/Glossaire.md')
      expect(moved.file).toBe('Bibliothèque/Références/Fichiers/Glossaire.pdf')
      // Found again by its fingerprint, whatever became of their links.
      expect(
        library
          .ghosts()
          .map(({ ghost, doc: of }) => [ghost.folder, of?.record])
          .sort()
      ).toEqual([
        ['Lot 2', 'Bibliothèque/Références/Glossaire.md'],
        ['Normes', 'Bibliothèque/Références/Glossaire.md']
      ])
    })

    it('drops a ghost where its document comes, and all of them when it goes', async () => {
      await pourInto('Normes')
      await pourInto('Lot 2')
      await library.moveTo(library.docs()[0], 'Lot 2')
      expect(library.ghosts()).toEqual([])
      await pourInto('Lot 3')
      expect(library.ghosts()).toHaveLength(1)
      await library.remove(library.docs()[0])
      expect(library.ghosts()).toEqual([])
    })
  })

  describe('rename', () => {
    it('gives a document another title, and names its record and its file after it', async () => {
      await library.pour([outside('scan_0042.pdf', 'plan')], {
        projects: [],
        move: false,
        today: TODAY,
        folder: 'Plans'
      })
      const [doc] = library.docs()
      const moves = await library.rename(doc, '  Plan RDC  indice B ')
      const [renamed] = library.docs()
      expect(renamed).toMatchObject({
        title: 'Plan RDC indice B',
        record: 'Bibliothèque/Plans/Plan RDC indice B.md',
        file: 'Bibliothèque/Plans/Fichiers/Plan RDC indice B.pdf',
        hash: doc.hash
      })
      expect(moves.get('Bibliothèque/Plans/Fichiers/scan_0042.pdf')).toBe(
        'Bibliothèque/Plans/Fichiers/Plan RDC indice B.pdf'
      )
      expect(vault.contentAt(renamed.record)).toContain('file: "[[Bibliothèque/Plans/Fichiers/Plan RDC indice B.pdf]]"')
    })

    it('takes out what a file name cannot hold, and never writes over another file', async () => {
      await library.pour([outside('a.pdf', 'un'), outside('b.pdf', 'deux')], {
        projects: [],
        move: false,
        today: TODAY
      })
      const [first, second] = library.docs()
      await library.rename(first, 'Note : lot 2/3 ?')
      await library.rename(second, 'Note : lot 2/3 ?')
      const titles = library.docs().map((doc) => [doc.title, doc.file])
      expect(titles).toContainEqual(['Note : lot 2/3 ?', 'Bibliothèque/Fichiers/Note lot 2 3.pdf'])
      expect(titles).toContainEqual(['Note : lot 2/3 ?', 'Bibliothèque/Fichiers/Note lot 2 3-1.pdf'])
      expect(new Set(library.docs().map((doc) => doc.file)).size).toBe(2)
    })

    it('renames a file the library only records, where it lives, and its ghosts say the new title', async () => {
      await vault.createBinary('Chantier/photo.pdf', bytes('pv').buffer as ArrayBuffer)
      await library.pour([{ kind: 'vault', file: fileAt('Chantier/photo.pdf') }], {
        projects: [],
        move: false,
        today: TODAY,
        folder: 'PV'
      })
      await library.pour([outside('copie.pdf', 'pv')], {
        projects: [],
        move: false,
        today: TODAY,
        folder: 'Lot 2',
        ghosts: true
      })
      const [doc] = library.docs()
      await library.rename(doc, 'PV de réception')
      expect(library.docs()[0].file).toBe('Chantier/PV de réception.pdf')
      const [entry] = library.ghosts()
      expect(entry.doc?.title).toBe('PV de réception')
      const ghost = vault.contentAt(entry.ghost.record) ?? ''
      expect(ghost).toContain('title: PV de réception')
      expect(ghost).toContain('[[Bibliothèque/PV/PV de réception.md|PV de réception]]')
    })

    it('leaves all as it was for a title that says nothing', async () => {
      await library.pour([outside('a.pdf', 'un')], { projects: [], move: false, today: TODAY })
      const [doc] = library.docs()
      expect((await library.rename(doc, '  / ? ')).size).toBe(0)
      expect(library.docs()[0].title).toBe(doc.title)
    })
  })

  describe('languages', () => {
    const three = async (): Promise<void> => {
      await library.pour([outside('Spec FR.pdf', 'fr'), outside('Spec EN.pdf', 'en'), outside('Spec DE.pdf', 'de')], {
        projects: [],
        move: false,
        today: TODAY
      })
    }
    const byTitle = (title: string) => {
      const found = library.docs().find((doc) => doc.title === title)
      if (!found) throw new Error(`no ${title}`)
      return found
    }
    const others = (title: string): string[] =>
      otherLanguages(byTitle(title), library.docs())
        .map((doc) => `${doc.title}:${doc.language ?? ''}`)
        .sort()

    it('links two documents as the same one in two languages, each with its own', async () => {
      await three()
      await library.linkLanguages(byTitle('Spec FR'), byTitle('Spec EN'), 'fr', 'en')
      expect(byTitle('Spec EN').translationOf).toBe(byTitle('Spec FR').record)
      expect(others('Spec FR')).toEqual(['Spec EN:en'])
      expect(others('Spec EN')).toEqual(['Spec FR:fr'])
    })

    it('hangs every language of a document on one, whichever two were linked', async () => {
      await three()
      await library.linkLanguages(byTitle('Spec FR'), byTitle('Spec EN'), 'fr', 'en')
      // Linked from the English: the German hangs on the French too.
      await library.linkLanguages(byTitle('Spec EN'), byTitle('Spec DE'), 'en', 'de')
      expect(byTitle('Spec DE').translationOf).toBe(byTitle('Spec FR').record)
      expect(others('Spec DE')).toEqual(['Spec EN:en', 'Spec FR:fr'])
    })

    it('takes a document out of its languages, the others staying together', async () => {
      await three()
      await library.linkLanguages(byTitle('Spec FR'), byTitle('Spec EN'), 'fr', 'en')
      await library.linkLanguages(byTitle('Spec FR'), byTitle('Spec DE'), 'fr', 'de')
      await library.unlinkLanguages(byTitle('Spec FR'))
      expect(others('Spec FR')).toEqual([])
      expect(others('Spec EN')).toEqual(['Spec DE:de'])
      await library.setLanguage(byTitle('Spec FR'), '')
      expect(byTitle('Spec FR').language).toBeUndefined()
    })
  })

  describe('sources', () => {
    const byFile = (name: string) => {
      const found = library.docs().find((doc) => doc.file.endsWith(`/${name}`))
      if (!found) throw new Error(`no ${name}`)
      return found
    }

    it('links a PDF to the Word document it was printed from, and back again unlinked', async () => {
      await library.pour([outside('Spec.docx', 'word'), outside('Spec.pdf', 'pdf')], {
        projects: [],
        move: false,
        today: TODAY
      })
      expect(likelyPair(byFile('Spec.pdf'), library.docs())).toMatchObject({
        source: { file: 'Bibliothèque/Fichiers/Spec.docx' },
        derived: { file: 'Bibliothèque/Fichiers/Spec.pdf' }
      })
      expect(likelyPair(byFile('Spec.docx'), library.docs())?.derived.file).toBe('Bibliothèque/Fichiers/Spec.pdf')
      await library.addSource(byFile('Spec.pdf'), byFile('Spec.docx'))
      expect(byFile('Spec.pdf').sources).toEqual([byFile('Spec.docx').record])
      expect(derivedFrom(byFile('Spec.docx'), library.docs()).map((doc) => doc.file)).toEqual([
        'Bibliothèque/Fichiers/Spec.pdf'
      ])
      // Linked already: no longer offered.
      expect(likelyPair(byFile('Spec.docx'), library.docs())).toBeNull()
      // The other way round, the loop it would make is undone.
      await library.addSource(byFile('Spec.docx'), byFile('Spec.pdf'))
      expect(byFile('Spec.pdf').sources).toBeUndefined()
      expect(byFile('Spec.docx').sources).toEqual([byFile('Spec.pdf').record])
      await library.removeSource(byFile('Spec.docx'), null)
      expect(byFile('Spec.docx').sources).toBeUndefined()
    })

    it('links a file to several sources — a Word document and a workbook —, and unlinks one alone', async () => {
      await library.pour([outside('Note.docx', 'w'), outside('Note.xlsx', 'x'), outside('Note.pdf', 'p')], {
        projects: [],
        move: false,
        today: TODAY
      })
      await library.addSource(byFile('Note.pdf'), byFile('Note.docx'))
      await library.addSource(byFile('Note.pdf'), byFile('Note.xlsx'))
      // Linked twice to the same: once.
      await library.addSource(byFile('Note.pdf'), byFile('Note.docx'))
      expect(byFile('Note.pdf').sources).toEqual([byFile('Note.docx').record, byFile('Note.xlsx').record])
      expect(derivedFrom(byFile('Note.xlsx'), library.docs()).map((doc) => doc.file)).toEqual([
        'Bibliothèque/Fichiers/Note.pdf'
      ])
      // Linked to both: neither is offered again.
      expect(sourceCandidates(byFile('Note.pdf'), library.docs())).toEqual([])
      await library.removeSource(byFile('Note.pdf'), byFile('Note.docx'))
      expect(byFile('Note.pdf').sources).toEqual([byFile('Note.xlsx').record])
    })

    it('reads the one source a record of before named', async () => {
      await library.pour([outside('Old.docx', 'w'), outside('Old.pdf', 'p')], {
        projects: [],
        move: false,
        today: TODAY
      })
      const pdf = byFile('Old.pdf')
      const content = vault.contentAt(pdf.record) ?? ''
      await vault.modify(
        fileAt(pdf.record),
        content.replace('---\n\n', `source: "[[${byFile('Old.docx').record.replace(/\.md$/, '')}]]"\n---\n\n`)
      )
      expect(byFile('Old.pdf').sources).toEqual([byFile('Old.docx').record])
    })

    it('offers the documents of the same name in another kind first, and never one made from it', async () => {
      await library.pour([outside('Note.pdf', 'p'), outside('Autre.docx', 'a'), outside('Note.xlsx', 'x')], {
        projects: [],
        move: false,
        today: TODAY
      })
      await library.addSource(byFile('Autre.docx'), byFile('Note.pdf'))
      expect(sourceCandidates(byFile('Note.pdf'), library.docs()).map((doc) => doc.file)).toEqual([
        'Bibliothèque/Fichiers/Note.xlsx'
      ])
    })
  })

  describe('reference, edition, revision', () => {
    it('writes them empty in a new record, and reads them once filled in', async () => {
      await library.pour([outside('Glossaire.pdf', 'g')], { projects: [], move: false, today: TODAY })
      const [doc] = library.docs()
      const content = vault.contentAt(doc.record) ?? ''
      expect(content).toContain('reference: ""')
      expect(content).toContain('edition: ""')
      expect(content).toContain('revision: ""')
      await vault.modify(
        fileAt(doc.record),
        content
          .replace('reference: ""', 'reference: DLA-NM-0000000-01-PSP')
          .replace('edition: ""', 'edition: 2')
          .replace('revision: ""', 'revision: 15')
      )
      expect(library.docs()[0]).toMatchObject({ reference: 'DLA-NM-0000000-01-PSP', edition: '2', revision: '15' })
    })

    it('adds them, empty, to a record made before them, and leaves those it has', async () => {
      await vault.create('Bibliothèque/Ancien.md', '---\npm-library-doc: true\ntitle: Ancien\nedition: 4\n---\n')
      const [doc] = library.docs()
      await library.ensureHandFields(doc)
      const content = vault.contentAt(doc.record) ?? ''
      expect(content).toMatch(/edition: "?4"?/)
      expect(content).toContain('reference: ""')
      expect(content).toContain('revision: ""')
    })

    it('writes those the reader gives in the sheet, and leaves the others', async () => {
      await vault.create(
        'Bibliothèque/Spec.md',
        '---\npm-library-doc: true\ntitle: Spec\nedition: 4\nrevision: 2\n---\n'
      )
      await library.setHandFields(library.docs()[0], { reference: ' SP-01 ', revision: '' })
      const [doc] = library.docs()
      expect(doc).toMatchObject({ reference: 'SP-01', edition: '4' })
      expect(doc.revision ?? '').toBe('')
    })
  })

  describe('identity found', () => {
    it('fills what the record does not say, never over the reader, and once', async () => {
      await library.pour([outside('Spec.pdf', 's')], { projects: [], move: false, today: TODAY })
      const [doc] = library.docs()
      await vault.modify(fileAt(doc.record), (vault.contentAt(doc.record) ?? '').replace('edition: ""', 'edition: "7"'))
      const filled = await library.fillIdentity(library.docs()[0], {
        reference: 'SP-01-A',
        edition: '2',
        revision: '15'
      })
      expect(filled.sort()).toEqual(['reference', 'revision'])
      expect(library.docs()[0]).toMatchObject({
        reference: 'SP-01-A',
        edition: '7',
        revision: '15',
        identityRead: true
      })
    })

    it('shares a source’s and its PDF’s reference, edition and revision, where each says none', async () => {
      await library.pour([outside('Spec.docx', 'w'), outside('Spec.pdf', 'p')], {
        projects: [],
        move: false,
        today: TODAY
      })
      const word = library.docs().find((doc) => doc.file.endsWith('.docx'))
      const pdf = library.docs().find((doc) => doc.file.endsWith('.pdf'))
      if (!word || !pdf) throw new Error('no pair')
      await library.fillIdentity(word, { reference: 'SP-01-A', edition: '2' })
      await library.fillIdentity(pdf, { revision: '15' })
      await library.addSource(pdf, word)
      const after = (end: string) => library.docs().find((doc) => doc.file.endsWith(end))
      expect(after('.pdf')).toMatchObject({ reference: 'SP-01-A', edition: '2', revision: '15' })
      expect(after('.docx')).toMatchObject({ reference: 'SP-01-A', edition: '2', revision: '15' })
    })
  })
})
