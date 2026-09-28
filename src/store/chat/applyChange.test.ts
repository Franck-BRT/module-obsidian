import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { DEFAULT_REQUIREMENT_SETTINGS, DEFAULT_SETTINGS, makeTask, type RequirementSettings } from '../../types'
import { ProjectStore } from '../ProjectStore'
import { RequirementStore } from '../requirements/RequirementStore'
import { addLink, setText } from '../requirements/Requirement'
import { findTaskById } from '../TaskIndex'
import { VaultIndex } from '../VaultIndex'
import { applyToRequirement, applyToTicket } from './applyChange'
import { parseChange, verificationOptions, type ChangeSpec, type ReqOptions } from './chatChange'

/**
 * A proposal applied the whole way: found in the vault, checked, written through the
 * stores, read back. The resolution is tested on its own; this is where it meets the
 * library's revisions and the plan's scheduling.
 */

function spec<K extends ChangeSpec['kind']>(kind: K, source: object): Extract<ChangeSpec, { kind: K }> {
  const read = parseChange(JSON.stringify(source))
  if (!('spec' in read) || read.spec.kind !== kind) throw new Error('not read')
  return read.spec as Extract<ChangeSpec, { kind: K }>
}

describe('applying a change to a requirement', () => {
  let index: VaultIndex
  let store: RequirementStore
  let settings: RequirementSettings
  let options: ReqOptions

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    index = new VaultIndex(app, () => ({ ...DEFAULT_SETTINGS }))
    settings = structuredClone(DEFAULT_REQUIREMENT_SETTINGS)
    store = new RequirementStore(
      app,
      () => settings,
      () => Promise.resolve(),
      index
    )
    options = {
      statuses: settings.statuses.map(({ id, label }) => ({ id, label })),
      types: settings.types.map(({ id, label }) => ({ id, label })),
      criticalities: [],
      verifications: verificationOptions((method) => method),
      languages: ['fr', 'en']
    }
  })

  async function library(): Promise<{ source: string; child: string }> {
    const source = await store.create({ title: 'Journaux', category: 'LOG' })
    const child = await store.create({ title: 'Débit', category: 'LOG' })
    if (!source?.filePath || !child?.filePath) throw new Error('not created')
    await store.save(source.filePath, (current) =>
      setText(current, 'fr', 'Transmettre rapidement les journaux.', 'Anne')
    )
    await store.save(source.filePath, (current) => setText(current, 'en', 'Send the logs quickly.', 'Anne'))
    await store.save(child.filePath, (current) => addLink(current, 'derives-from', source.id))
    index.build()
    return { source: source.id, child: child.id }
  }

  it('rewrites the wording as a revision, a machine’s, with its translation and its dependants in doubt', async () => {
    const { source, child } = await library()
    const path = index.requirementById(source)?.filePath ?? ''
    const done = await applyToRequirement(
      store,
      path,
      spec('requirement', { requirement: source, field: 'text', value: 'Transmettre les journaux en 10 min.' }),
      options,
      'Anne'
    )
    expect(done).toEqual({ ok: true, name: source, changed: true })
    index.build()
    const after = index.requirementById(source)
    expect(after?.text.fr).toMatchObject({
      body: 'Transmettre les journaux en 10 min.',
      origin: 'machine',
      reviewed: false
    })
    expect(after?.rev).toBe(2)
    expect(after?.history.at(-1)).toMatchObject({ lang: 'fr', was: 'Transmettre rapidement les journaux.' })
    // The English wording is now behind, and the requirement deriving from this one suspect.
    expect(after?.text.en.fromRev).toBeLessThan(after?.rev ?? 0)
    expect(index.requirementById(child)?.links[0]).toMatchObject({ to: source, suspect: true })
  })

  it('writes nothing a second time, and says the change was already there', async () => {
    const { source } = await library()
    const path = index.requirementById(source)?.filePath ?? ''
    const change = spec('requirement', { requirement: source, field: 'status', value: settings.statuses[1].label })
    expect(await applyToRequirement(store, path, change, options, 'Anne')).toMatchObject({ ok: true, changed: true })
    index.build()
    const rev = index.requirementById(source)?.updatedAt
    expect(await applyToRequirement(store, path, change, options, 'Anne')).toMatchObject({ ok: true, changed: false })
    index.build()
    expect(index.requirementById(source)?.updatedAt).toBe(rev)
    expect(index.requirementById(source)?.status).toBe(settings.statuses[1].id)
  })

  it('refuses a value outside the reader’s lists without writing', async () => {
    const { source } = await library()
    const path = index.requirementById(source)?.filePath ?? ''
    const before = index.requirementById(source)?.updatedAt
    const done = await applyToRequirement(
      store,
      path,
      spec('requirement', { requirement: source, field: 'status', value: 'Inventé' }),
      options,
      'Anne'
    )
    expect(done).toMatchObject({ ok: false, problem: 'unknown' })
    index.build()
    expect(index.requirementById(source)?.updatedAt).toBe(before)
  })

  // A new title renames the note, as it does from the editor: the link keeps working.
  it('renames the note when the title changes', async () => {
    const { source } = await library()
    const path = index.requirementById(source)?.filePath ?? ''
    await applyToRequirement(
      store,
      path,
      spec('requirement', { requirement: source, field: 'title', value: 'Journaux de vol' }),
      options,
      'Anne'
    )
    index.build()
    expect(index.requirementById(source)?.filePath).toBe(`Requirements/${source} Journaux de vol.md`)
  })
})

describe('applying a change to a ticket', () => {
  let index: VaultIndex
  let store: ProjectStore

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    index = new VaultIndex(app, () => DEFAULT_SETTINGS)
    store = new ProjectStore(app, () => DEFAULT_SETTINGS, index)
  })

  async function plan(): Promise<{ path: string; first: string; second: string }> {
    const project = await store.createProject('Génie civil', 'Work')
    const first = makeTask({ title: 'Déblais', start: '2026-07-01', due: '2026-07-03' })
    const second = makeTask({ title: 'Soutènement', start: '2026-07-06', due: '2026-07-07', dependencies: [first.id] })
    await store.insertTask(project, first)
    await store.insertTask(project, second)
    index.build()
    return { path: project.filePath, first: first.id, second: second.id }
  }

  async function task(path: string, id: string) {
    const project = await store.loadProjectByPath(path)
    return project ? findTaskById(project, id) : null
  }

  it('moves a due date, and what waits on the ticket moves with it', async () => {
    const { path, first, second } = await plan()
    const done = await applyToTicket(
      index,
      store,
      spec('ticket', { ticket: 'déblais', field: 'due', value: '2026-07-08' })
    )
    expect(done).toEqual({ ok: true, name: 'Déblais', changed: true })
    expect((await task(path, first))?.due).toBe('2026-07-08')
    const moved = await task(path, second)
    expect(moved?.start && moved.start > '2026-07-08').toBe(true)
  })

  it('finishes a ticket by its status label, stamping when it was finished', async () => {
    const { path, first } = await plan()
    const label = DEFAULT_SETTINGS.statuses.find((status) => status.id === 'done')?.label ?? 'done'
    const done = await applyToTicket(index, store, spec('ticket', { ticket: 'Déblais', field: 'status', value: label }))
    expect(done).toMatchObject({ ok: true, changed: true })
    const finished = await task(path, first)
    expect(finished?.status).toBe('done')
    expect(finished?.completed).not.toBe('')
  })

  it('says when the ticket is not there, or is not the only one of its name', async () => {
    await plan()
    expect(
      await applyToTicket(index, store, spec('ticket', { ticket: 'Terrassements', field: 'progress', value: 10 }))
    ).toMatchObject({ ok: false, problem: 'none' })
    const other = await store.createProject('Équipements', 'Work')
    await store.insertTask(other, makeTask({ title: 'Déblais' }))
    index.build()
    expect(
      await applyToTicket(index, store, spec('ticket', { ticket: 'Déblais', field: 'progress', value: 10 }))
    ).toMatchObject({ ok: false, problem: 'ambiguous', count: 2 })
    expect(
      await applyToTicket(
        index,
        store,
        spec('ticket', { ticket: 'Déblais', project: 'Équipements', field: 'progress', value: 10 })
      )
    ).toMatchObject({ ok: true, changed: true })
  })
})
