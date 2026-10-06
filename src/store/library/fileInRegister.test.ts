import { TFile, type App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { DEFAULT_SETTINGS, makeDocument, makeTask, type Project } from '../../types'
import { documentOf, statusForState } from '../Document'
import { DocumentStore } from '../DocumentStore'
import { ProjectStore } from '../ProjectStore'
import { VaultIndex } from '../VaultIndex'
import { DocLibrary } from './DocLibrary'
import { fileAsNew, fileAsVersion, followMoves, type RegisterDeps } from './fileInRegister'
import { proposeMatches, registerCandidates, registerEntries } from './libraryRegister'
import { flattenTasks } from '../TaskTreeOps'
import { findLot } from '../projectLots'

/** Every ticket of a project, at whatever depth: a document filed goes in its Documents lot. */
const all = (project: Project) => flattenTasks(project.tasks).map((flat) => flat.task)

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const DEPOSIT = { by: 'Anne', note: 'Versé depuis la bibliothèque' }

describe('a library document followed in a register', () => {
  let vault: FakeVault
  let app: App
  let store: ProjectStore
  let deps: RegisterDeps
  let library: DocLibrary
  let project: Project

  const fileAt = (path: string): TFile => {
    const file = vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) throw new Error(`no file at ${path}`)
    return file
  }
  const reload = async (): Promise<Project> => {
    const loaded = await store.loadProjectByPath(project.filePath)
    if (!loaded) throw new Error('project gone')
    return loaded
  }

  beforeEach(async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
    const index = new VaultIndex(app, () => DEFAULT_SETTINGS)
    store = new ProjectStore(app, () => DEFAULT_SETTINGS, index)
    deps = { store, documents: new DocumentStore(app) }
    library = new DocLibrary(
      app,
      () => 'Library',
      () => ({ filesFolder: '_files', notesHeading: 'Notes' }),
      () => 'Ligne 6'
    )
    project = await store.createProject('Ligne 6', 'Work')
  })

  it('answers an awaited document where the file lives, received, and is found there by the library', async () => {
    await store.insertTask(
      project,
      makeTask({
        title: 'Planning génie civil',
        type: 'document',
        status: statusForState('expected', store.configFor(project).statuses) ?? 'todo',
        document: makeDocument({ reference: 'PL-02' })
      })
    )
    await library.pour([{ kind: 'bytes', name: 'Planning GC indice C.pdf', bytes: bytes('planning') }], {
      projects: [project.filePath],
      move: false,
      today: '2026-09-28'
    })
    const [doc] = library.docs()
    const awaited = registerCandidates(await reload(), doc.title, doc.file)[0]
    expect(awaited.title).toBe('Planning génie civil')
    const statusBefore = awaited.status

    const meta = await fileAsVersion(deps, await reload(), awaited, fileAt(doc.file), DEPOSIT)
    expect(meta).toMatchObject({ state: 'received', file: doc.file, linked: true })

    // Kept in the project's note, and the file never moved into its _docs.
    const ticket = all(await reload()).find((task) => task.title === 'Planning génie civil')
    expect(documentOf(ticket ?? makeTask())).toMatchObject({ state: 'received', file: doc.file, linked: true })
    expect(ticket?.document?.versions).toHaveLength(1)
    expect(ticket?.document?.versions[0]).toMatchObject({
      version: 1,
      file: doc.file,
      by: 'Anne',
      note: 'Versé depuis la bibliothèque'
    })
    expect(fileAt(doc.file).path).toBe('Library/_files/Planning GC indice C.pdf')
    // The ticket's status moved on with its state, as a deposit made in the register does.
    const statuses = store.configFor(await reload()).statuses
    expect(statusBefore).toBe(statusForState('expected', statuses))
    expect(ticket?.status).toBe(statusForState('received', statuses))
    expect(statusForState('received', statuses)).not.toBe(statusForState('expected', statuses))

    const entries = registerEntries([await reload()]).get(doc.file)
    expect(entries?.map((entry) => [entry.task.title, entry.current, entry.version])).toEqual([
      ['Planning génie civil', true, 1]
    ])
  })

  it('makes a new issue the next version, the one before kept as an earlier version', async () => {
    await library.pour(
      [
        { kind: 'bytes', name: 'Plan indice A.pdf', bytes: bytes('A') },
        { kind: 'bytes', name: 'Plan indice B.pdf', bytes: bytes('B') }
      ],
      { projects: [project.filePath], move: false, today: '2026-09-28' }
    )
    const [a, b] = ['Library/_files/Plan indice A.pdf', 'Library/_files/Plan indice B.pdf']
    const created = await fileAsNew(deps, await reload(), 'Plan de coffrage', fileAt(a), DEPOSIT)
    const ticket = all(await reload()).find((task) => task.id === created.id)
    if (!ticket) throw new Error('ticket not written')
    await fileAsVersion(deps, await reload(), ticket, fileAt(b), DEPOSIT)

    const entries = registerEntries([await reload()])
    expect(entries.get(b)?.map((entry) => [entry.current, entry.version])).toEqual([[true, 2]])
    expect(entries.get(a)?.map((entry) => [entry.current, entry.version])).toEqual([[false, 1]])
    // Referred to where they are: neither file was archived away from the library.
    expect(fileAt(a).path).toBe(a)
    expect(fileAt(b).path).toBe(b)
  })

  it('gives the ticket the library’s reference, issue and issuer, and a new version its issue', async () => {
    await library.pour(
      [
        { kind: 'bytes', name: 'Plan A.pdf', bytes: bytes('A') },
        { kind: 'bytes', name: 'Plan B.pdf', bytes: bytes('B') }
      ],
      { projects: [project.filePath], move: false, today: '2026-09-28' }
    )
    const [a, b] = ['Library/_files/Plan A.pdf', 'Library/_files/Plan B.pdf']
    const created = await fileAsNew(deps, await reload(), 'Plan', fileAt(a), DEPOSIT, {
      reference: 'GC-PL-001',
      issue: 'A',
      issuer: 'Setec'
    })
    expect(created.document).toMatchObject({ reference: 'GC-PL-001', issue: 'A', issuer: 'Setec' })
    const ticket = all(await reload()).find((task) => task.id === created.id)
    if (!ticket) throw new Error('ticket not written')
    await fileAsVersion(deps, await reload(), ticket, fileAt(b), DEPOSIT, {
      reference: 'AUTRE',
      issue: 'B',
      issuer: ''
    })
    const after = all(await reload()).find((task) => task.id === created.id)
    // Its own reference and issuer kept; the new version's issue taken.
    expect(after?.document).toMatchObject({ reference: 'GC-PL-001', issue: 'B', issuer: 'Setec' })
  })

  it('adds a new document to the register, received, under the title it has in the library', async () => {
    await library.pour([{ kind: 'bytes', name: 'Note de calcul.pdf', bytes: bytes('ndc') }], {
      projects: [],
      move: false,
      today: '2026-09-28'
    })
    const [doc] = library.docs()
    const task = await fileAsNew(deps, await reload(), doc.title, fileAt(doc.file), DEPOSIT)
    const written = all(await reload()).find((each) => each.id === task.id)
    expect(written).toMatchObject({
      title: 'Note de calcul',
      type: 'document',
      status: statusForState('received', store.configFor(await reload()).statuses)
    })
    expect(documentOf(written ?? makeTask())).toMatchObject({ state: 'received', file: doc.file, linked: true })
    // In the project's Documents lot, made once for it: a second one goes in the same.
    const lot = findLot(await reload(), 'Documents')
    expect(lot?.subtasks.map((each) => each.id)).toEqual([task.id])
    const second = await fileAsNew(deps, await reload(), 'Autre', fileAt(doc.file), DEPOSIT)
    expect((await reload()).tasks.filter((each) => each.type === 'phase')).toHaveLength(1)
    expect(findLot(await reload(), 'documents')?.subtasks.map((each) => each.id)).toEqual([task.id, second.id])
  })

  it('proposes, right after a pour, the awaited document a file is, and files it there once chosen', async () => {
    await store.insertTask(
      project,
      makeTask({ title: 'Plan de coffrage radier', type: 'document', document: makeDocument({ reference: 'PL-002' }) })
    )
    await store.insertTask(
      project,
      makeTask({ title: 'Note de calcul radier', type: 'document', document: makeDocument({ reference: 'NDC-04' }) })
    )
    const report = await library.pour(
      [
        { kind: 'bytes', name: 'PL_002 indice A.pdf', bytes: bytes('plan') },
        { kind: 'bytes', name: 'Facture 12.pdf', bytes: bytes('facture') }
      ],
      { projects: [project.filePath], move: false, today: '2026-09-28' }
    )
    // The new documents come back from the pour itself, not from a cache still catching up.
    const proposals = proposeMatches(
      report.docs.map((doc) => ({ key: doc.record, title: doc.title, file: doc.file, projects: doc.projects })),
      [await reload()]
    )
    expect(proposals.map((p) => [p.subject.title, p.chosen?.task.title])).toEqual([
      ['PL 002 indice A', 'Plan de coffrage radier']
    ])
    const [proposal] = proposals
    const match = proposal.chosen
    if (!match) throw new Error('no match')
    await fileAsVersion(deps, match.project, match.task, fileAt(proposal.subject.file), DEPOSIT)
    const ticket = all(await reload()).find((task) => task.title === 'Plan de coffrage radier')
    expect(documentOf(ticket ?? makeTask())).toMatchObject({ state: 'received', file: proposal.subject.file })
  })

  it('follows the files the library moves, current and earlier versions, in the register', async () => {
    await library.pour(
      [
        { kind: 'bytes', name: 'Plan indice A.pdf', bytes: bytes('A') },
        { kind: 'bytes', name: 'Plan indice B.pdf', bytes: bytes('B') }
      ],
      { projects: [project.filePath], move: false, today: '2026-09-28' }
    )
    const [a, b] = ['Library/_files/Plan indice A.pdf', 'Library/_files/Plan indice B.pdf']
    const created = await fileAsNew(deps, await reload(), 'Plan de coffrage', fileAt(a), DEPOSIT)
    const ticket = all(await reload()).find((task) => task.id === created.id)
    if (!ticket) throw new Error('ticket not written')
    await fileAsVersion(deps, await reload(), ticket, fileAt(b), DEPOSIT)
    // Its first issue moved first, then its folder renamed with its current one in it.
    const first = library.docs().find((doc) => doc.file === a)
    if (!first) throw new Error('no document')
    const moved = await library.moveTo(first, 'Plans')
    expect(await followMoves(store, [await reload()], moved)).toBe(1)
    for (const doc of library.docs().filter((each) => each.file === b)) {
      expect(await followMoves(store, [await reload()], await library.moveTo(doc, 'Plans'))).toBe(1)
    }
    const renamed = await library.renameFolder('Plans', 'Coffrage')
    const shown = await reload()
    expect(await followMoves(store, [shown], renamed?.moves ?? new Map<string, string>())).toBe(1)
    // The project as the caller holds it says so at once, before it is read again.
    const held = all(shown).find((task) => task.id === created.id)
    expect(documentOf(held ?? makeTask()).file).toBe('Library/Coffrage/_files/Plan indice B.pdf')

    const after = documentOf(all(await reload()).find((task) => task.id === created.id) ?? makeTask())
    expect(after.file).toBe('Library/Coffrage/_files/Plan indice B.pdf')
    expect(after.versions.map((version) => version.file)).toEqual([
      'Library/Coffrage/_files/Plan indice A.pdf',
      'Library/Coffrage/_files/Plan indice B.pdf'
    ])
    expect(registerEntries([await reload()]).get('Library/Coffrage/_files/Plan indice B.pdf')).toHaveLength(1)
    // Nothing moved, nothing told.
    expect(await followMoves(store, [await reload()], new Map())).toBe(0)
    expect(await followMoves(store, [await reload()], new Map([['Elsewhere.pdf', 'Else.pdf']]))).toBe(0)
  })
})
