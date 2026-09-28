import { TFile, type App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { DEFAULT_SETTINGS, makeDocument, makeTask, type Project } from '../../types'
import { documentOf, statusForState } from '../Document'
import { DocumentStore } from '../DocumentStore'
import { ProjectStore } from '../ProjectStore'
import { VaultIndex } from '../VaultIndex'
import { DocLibrary } from './DocLibrary'
import { fileAsNew, fileAsVersion, type RegisterDeps } from './fileInRegister'
import { registerCandidates, registerEntries } from './libraryRegister'

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
    const ticket = (await reload()).tasks.find((task) => task.title === 'Planning génie civil')
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
    const ticket = (await reload()).tasks.find((task) => task.id === created.id)
    if (!ticket) throw new Error('ticket not written')
    await fileAsVersion(deps, await reload(), ticket, fileAt(b), DEPOSIT)

    const entries = registerEntries([await reload()])
    expect(entries.get(b)?.map((entry) => [entry.current, entry.version])).toEqual([[true, 2]])
    expect(entries.get(a)?.map((entry) => [entry.current, entry.version])).toEqual([[false, 1]])
    // Referred to where they are: neither file was archived away from the library.
    expect(fileAt(a).path).toBe(a)
    expect(fileAt(b).path).toBe(b)
  })

  it('adds a new document to the register, received, under the title it has in the library', async () => {
    await library.pour([{ kind: 'bytes', name: 'Note de calcul.pdf', bytes: bytes('ndc') }], {
      projects: [],
      move: false,
      today: '2026-09-28'
    })
    const [doc] = library.docs()
    const task = await fileAsNew(deps, await reload(), doc.title, fileAt(doc.file), DEPOSIT)
    const written = (await reload()).tasks.find((each) => each.id === task.id)
    expect(written).toMatchObject({
      title: 'Note de calcul',
      type: 'document',
      status: statusForState('received', store.configFor(await reload()).statuses)
    })
    expect(documentOf(written ?? makeTask())).toMatchObject({ state: 'received', file: doc.file, linked: true })
  })
})
