import { beforeEach, describe, expect, it } from 'vitest'
import type { App } from 'obsidian'
import { TFile } from 'obsidian'
import { makeFakeApp, type FakeVault } from '../../test/fakeVault'
import { makeProject, makeTask, type Project, type Task } from '../types'
import { DocumentStore } from './DocumentStore'
import { documentOf } from './Document'

let app: App
let vault: FakeVault
let store: DocumentStore
let project: Project

beforeEach(async () => {
  const fake = makeFakeApp()
  app = fake.app as unknown as App
  vault = fake.vault
  store = new DocumentStore(app)
  await vault.createFolder('Projets')
  await vault.createFolder('Projets/Tour')
  await vault.create('Projets/Tour/Tour.md', '---\npm-project: true\n---\n')
  await vault.createFolder('Projets/Tour/_tasks')
  project = makeProject('Tour', 'Projets/Tour/Tour.md')
  await vault.createFolder('Entrant')
})

const incoming = async (name: string, content = 'bytes'): Promise<TFile> =>
  await vault.create(`Entrant/${name}`, content)

const doc = (over: Partial<Task> = {}): Task => makeTask({ type: 'document', title: 'Plan de masse', ...over })

describe('depositing a file into a project', () => {
  it('puts it in the project’s documents folder and points the document at it', async () => {
    const meta = await store.deposit(project, doc(), await incoming('plan.pdf'), { move: false, by: 'Ana', note: '' })
    expect(meta.file).toBe('Projets/Tour/_docs/plan.pdf')
    expect(vault.getAbstractFileByPath('Projets/Tour/_docs/plan.pdf')).toBeTruthy()
    expect(meta.versions).toHaveLength(1)
    expect(meta.state).toBe('received')
  })

  it('copies by default, leaving the file where it came from', async () => {
    await store.deposit(project, doc(), await incoming('plan.pdf'), { move: false, by: 'Ana', note: '' })
    expect(vault.getAbstractFileByPath('Entrant/plan.pdf')).toBeTruthy()
  })

  it('moves it when asked, so nothing is left behind in the inbox', async () => {
    await store.deposit(project, doc(), await incoming('plan.pdf'), { move: true, by: 'Ana', note: '' })
    expect(vault.getAbstractFileByPath('Entrant/plan.pdf')).toBeNull()
    expect(vault.getAbstractFileByPath('Projets/Tour/_docs/plan.pdf')).toBeTruthy()
  })
})

describe('a second version', () => {
  it('keeps the current path and puts the file it replaced in the versions folder', async () => {
    const first = await store.deposit(project, doc(), await incoming('plan.pdf', 'v1'), {
      move: false,
      by: 'Ana',
      note: ''
    })
    const task = doc({ document: first })
    const second = await store.deposit(project, task, await incoming('plan-corrige.pdf', 'v2'), {
      move: false,
      by: 'Bo',
      note: 'échelle corrigée'
    })

    // The document's own path has not moved: a link to it still lands on the latest file.
    expect(second.file).toBe('Projets/Tour/_docs/plan.pdf')
    expect(vault.contentAt('Projets/Tour/_docs/plan.pdf')).toBe('v2')
    expect(second.versions.map((v) => v.version)).toEqual([1, 2])
    expect(second.versions[0].file).toBe('Projets/Tour/_docs/_versions/plan-v1.pdf')
    expect(vault.contentAt('Projets/Tour/_docs/_versions/plan-v1.pdf')).toBe('v1')
    expect(second.versions[1].note).toBe('échelle corrigée')
  })

  it('never overwrites an archive, however many times a version number comes round', async () => {
    let meta = await store.deposit(project, doc(), await incoming('a.pdf', 'one'), { move: false, by: 'A', note: '' })
    meta = await store.deposit(project, doc({ document: meta }), await incoming('b.pdf', 'two'), {
      move: false,
      by: 'A',
      note: ''
    })
    meta = await store.deposit(project, doc({ document: meta }), await incoming('c.pdf', 'three'), {
      move: false,
      by: 'A',
      note: ''
    })
    const archived = meta.versions.slice(0, 2).map((v) => v.file)
    expect(new Set(archived).size).toBe(2)
    expect(archived.map((path) => vault.contentAt(path))).toEqual(['one', 'two'])
  })
})

describe('a file referenced where it already lives', () => {
  it('is not moved, and is remembered as linked', async () => {
    const elsewhere = await vault.create('Ailleurs/notice.pdf', 'bytes')
    const meta = await store.link(doc(), elsewhere, { by: 'Ana', note: '' })
    expect(meta.linked).toBe(true)
    expect(meta.file).toBe('Ailleurs/notice.pdf')
    expect(vault.getAbstractFileByPath('Ailleurs/notice.pdf')).toBeTruthy()
    expect(meta.versions).toHaveLength(1)
  })

  it('is left alone when a later deposit takes over: it was never ours to move', async () => {
    const elsewhere = await vault.create('Ailleurs/notice.pdf', 'bytes')
    const linked = await store.link(doc(), elsewhere, { by: 'Ana', note: '' })
    const meta = await store.deposit(project, doc({ document: linked }), await incoming('notice-v2.pdf'), {
      move: false,
      by: 'Ana',
      note: ''
    })
    expect(vault.getAbstractFileByPath('Ailleurs/notice.pdf')).toBeTruthy()
    expect(meta.linked).toBe(false)
    expect(meta.file).toBe('Projets/Tour/_docs/notice-v2.pdf')
  })
})

describe('restoring an old version', () => {
  it('brings it back as a new deposit rather than rewinding the log', async () => {
    let meta = await store.deposit(project, doc(), await incoming('plan.pdf', 'v1'), { move: false, by: 'A', note: '' })
    meta = await store.deposit(project, doc({ document: meta }), await incoming('plan2.pdf', 'v2'), {
      move: false,
      by: 'A',
      note: ''
    })
    const restored = await store.restore(project, doc({ document: meta }), 1)
    expect(restored?.versions.map((v) => v.version)).toEqual([1, 2, 3])
    expect(restored?.versions[2].note).toBe('restore v1')
    expect(vault.contentAt(restored?.file ?? '')).toBe('v1')
  })

  it('says nothing happened when the version is not one it has', async () => {
    const meta = await store.deposit(project, doc(), await incoming('plan.pdf'), { move: false, by: 'A', note: '' })
    expect(await store.restore(project, doc({ document: meta }), 7)).toBeNull()
  })
})

describe('files nobody claims', () => {
  it('lists what sits in the documents folder that no document points at', async () => {
    const meta = await store.deposit(project, doc(), await incoming('plan.pdf'), { move: false, by: 'A', note: '' })
    await vault.create('Projets/Tour/_docs/tombe-ici.pdf', 'bytes')
    expect(store.orphanFiles(project, [doc({ document: meta })])).toEqual(['Projets/Tour/_docs/tombe-ici.pdf'])
  })

  it('does not count an archived version as unclaimed', async () => {
    let meta = await store.deposit(project, doc(), await incoming('plan.pdf'), { move: false, by: 'A', note: '' })
    meta = await store.deposit(project, doc({ document: meta }), await incoming('plan2.pdf'), {
      move: false,
      by: 'A',
      note: ''
    })
    expect(store.orphanFiles(project, [doc({ document: meta })])).toEqual([])
  })
})

describe('what the document says it holds', () => {
  it('finds the current file, and admits when it is gone', async () => {
    const meta = await store.deposit(project, doc(), await incoming('plan.pdf'), { move: false, by: 'A', note: '' })
    expect(store.fileOf(meta)?.path).toBe('Projets/Tour/_docs/plan.pdf')
    const file = vault.getAbstractFileByPath('Projets/Tour/_docs/plan.pdf')
    if (file) await vault.trashFile(file)
    expect(store.fileOf(meta)).toBeNull()
    expect(documentOf(doc({ document: meta })).versions).toHaveLength(1)
  })
})

describe('what counts as loose', () => {
  it('does not count a file a document points at, wherever the document sits', async () => {
    const meta = await store.deposit(project, doc(), await incoming('plan.pdf'), { move: false, by: 'A', note: '' })
    const linked = await vault.create('Ailleurs/notice.pdf', 'bytes')
    const linkedMeta = await store.link(doc(), linked, { by: 'A', note: '' })
    expect(store.orphanFiles(project, [doc({ document: meta }), doc({ document: linkedMeta })])).toEqual([])
  })

  it('ignores what sits in the versions folder, which belongs to the log', async () => {
    const first = await store.deposit(project, doc(), await incoming('plan.pdf'), { move: false, by: 'A', note: '' })
    await store.deposit(project, doc({ document: first }), await incoming('plan2.pdf'), {
      move: false,
      by: 'A',
      note: ''
    })
    // Even told about no documents at all, an archived version is not loose: it is not
    // in the documents folder itself.
    expect(store.orphanFiles(project, [])).toEqual(['Projets/Tour/_docs/plan.pdf'])
  })

  it('counts what is left behind when a document’s ticket is deleted', async () => {
    const meta = await store.deposit(project, doc(), await incoming('plan.pdf'), { move: false, by: 'A', note: '' })
    expect(meta.file).toBe('Projets/Tour/_docs/plan.pdf')
    // The ticket is gone; the file is deliberately not.
    expect(store.orphanFiles(project, [])).toEqual(['Projets/Tour/_docs/plan.pdf'])
  })
})
