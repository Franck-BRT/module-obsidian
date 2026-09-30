import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { DEFAULT_REQUIREMENT_SETTINGS, DEFAULT_SETTINGS, makeTask, type RequirementSettings } from '../../types'
import { ProjectStore } from '../ProjectStore'
import { RequirementStore } from '../requirements/RequirementStore'
import { addLink, setText } from '../requirements/Requirement'
import { findTaskById } from '../TaskIndex'
import { VaultIndex } from '../VaultIndex'
import {
  applyCreate,
  applyToRequirement,
  applyToTicket,
  applyWithUndo,
  applyProject,
  projectTarget,
  asModifications,
  createLot,
  existingTicket,
  createPlace,
  projectsLike,
  ticketPlaces,
  undoChange
} from './applyChange'
import { changeBlocks, parseChange, verificationOptions, type ChangeSpec, type ReqOptions } from './chatChange'

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

  // What a revised planning asks for most: a task two weeks later, its start past its old
  // due. One proposal, both dates, and what waits on it moved after it.
  it('moves a task two weeks later, and what waits on it follows', async () => {
    const { path, first, second } = await plan()
    const done = await applyToTicket(
      index,
      store,
      spec('ticket', { ticket: 'Déblais', changes: { start: '2026-07-15', due: '2026-07-17' } })
    )
    expect(done).toMatchObject({ ok: true, changed: true })
    expect(await task(path, first)).toMatchObject({ start: '2026-07-15', due: '2026-07-17' })
    const moved = await task(path, second)
    expect(moved?.start && moved.start > '2026-07-17').toBe(true)
  })

  it('sets what a ticket follows, and schedules it after', async () => {
    const { path, first, second } = await plan()
    const project = await store.loadProjectByPath(path)
    if (!project) throw new Error('no project')
    const third = makeTask({ title: 'Radier', start: '2026-07-01', due: '2026-07-02' })
    await store.insertTask(project, third)
    index.build()
    const done = await applyToTicket(
      index,
      store,
      spec('ticket', { ticket: 'Radier', changes: { after: ['Soutènement'] } })
    )
    expect(done).toMatchObject({ ok: true, changed: true })
    const radier = await task(path, third.id)
    expect(radier?.dependencies).toEqual([second])
    // Scheduled after what it now follows.
    expect(radier?.start && radier.start > '2026-07-07').toBe(true)
    // Said again: nothing to do.
    index.build()
    expect(
      await applyToTicket(index, store, spec('ticket', { ticket: 'Radier', changes: { after: ['Soutènement'] } }))
    ).toMatchObject({ ok: true, changed: false })
    expect((await task(path, first))?.dependencies).toEqual([])
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

describe('creating a ticket from the chat', () => {
  let index: VaultIndex
  let store: ProjectStore

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    index = new VaultIndex(app, () => DEFAULT_SETTINGS)
    store = new ProjectStore(app, () => DEFAULT_SETTINGS, index)
  })

  const label = (type: string): string => ({ milestone: 'Jalon', phase: 'Lot', document: 'Document' })[type] ?? type

  it('writes it into its lot, after what it follows, once', async () => {
    const project = await store.createProject('Génie civil', 'Work')
    const lot = makeTask({ title: 'Terrassements', type: 'phase', start: '' })
    const soutenement = makeTask({ title: 'Soutènement', start: '2026-09-14', due: '2026-10-09' })
    await store.insertTask(project, lot)
    await store.insertTask(project, soutenement, lot.id)
    index.build()
    const change = spec('create', {
      create: 'Radier',
      project: 'Génie civil',
      parent: 'Terrassements',
      // Asked to start before what it follows ends: the project's scheduling moves it, as
      // a link drawn in the Gantt would.
      changes: { start: '2026-10-01', due: '2026-11-13', assignees: ['Chloé'], after: ['Soutènement'] }
    })
    expect(await applyCreate(index, store, change, label)).toEqual({ ok: true, name: 'Radier', changed: true })
    const reloaded = await store.loadProjectByPath(project.filePath)
    const radier = reloaded?.tasks[0].subtasks.find((task) => task.title === 'Radier')
    expect(radier).toMatchObject({
      type: 'task',
      assignees: ['Chloé'],
      dependencies: [soutenement.id]
    })
    expect(radier?.start && radier.start > '2026-10-09').toBe(true)
    // A second click finds it there, and makes no twin.
    index.build()
    expect(await applyCreate(index, store, change, label)).toEqual({ ok: true, name: 'Radier', changed: false })
    expect((await store.loadProjectByPath(project.filePath))?.tasks[0].subtasks).toHaveLength(2)
  })

  it('takes a programme named for the one of its projects that holds the lot, and creates the tickets there', async () => {
    const program = await store.createProject('COSMA - GMAO', 'Work', { program: true })
    const cosma = await store.createProject('COSMA', 'Work', { parentPath: program.filePath })
    const other = await store.createProject('COSMA - Formation', 'Work', { parentPath: program.filePath })
    await store.insertTask(cosma, makeTask({ title: 'Actions complémentaires', type: 'phase', start: '' }))
    await store.insertTask(other, makeTask({ title: 'Sessions', type: 'phase', start: '' }))
    index.build()
    const change = spec('create', {
      create: 'Définir les codes intervention',
      project: 'COSMA - GMAO',
      // As a model may write it: case and accents aside.
      parent: 'actions complementaires'
    })
    expect(await createPlace(index, store, change)).toMatchObject({
      project: { path: cosma.filePath, title: 'COSMA' },
      via: 'COSMA - GMAO'
    })
    expect(await applyCreate(index, store, change, label)).toEqual({
      ok: true,
      name: 'Définir les codes intervention',
      changed: true
    })
    const lot = (await store.loadProjectByPath(cosma.filePath))?.tasks.find(
      (task) => task.title === 'Actions complémentaires'
    )
    expect(lot?.subtasks.map((task) => task.title)).toEqual(['Définir les codes intervention'])
  })

  it('offers the programme’s projects when none or several hold the lot, and keeps to the one chosen once made', async () => {
    const program = await store.createProject('COSMA - GMAO', 'Work', { program: true })
    const a = await store.createProject('COSMA', 'Work', { parentPath: program.filePath })
    const b = await store.createProject('COSMA - Formation', 'Work', { parentPath: program.filePath })
    // A programme within it is no place for a ticket either.
    await store.createProject('Sous-programme', 'Work', { parentPath: program.filePath, program: true })
    index.build()
    const change = spec('create', { create: 'Tester la sélection', project: 'COSMA - GMAO' })
    const place = await createPlace(index, store, change)
    expect(place && 'choices' in place ? place.choices.map((each) => each.title).sort() : place).toEqual([
      'COSMA',
      'COSMA - Formation'
    ])
    expect(await applyCreate(index, store, change, label)).toMatchObject({ ok: false, problem: 'project' })
    // Chosen by the reader: created there — and found there afterwards, the programme named.
    expect(await applyCreate(index, store, { ...change, project: b.filePath }, label)).toMatchObject({ ok: true })
    index.build()
    expect(await createPlace(index, store, change)).toMatchObject({ project: { path: b.filePath } })
    expect((await store.loadProjectByPath(a.filePath))?.tasks).toHaveLength(0)
    // A programme with a single project: that one.
    const lone = await store.createProject('Solo', 'Work', { program: true })
    const only = await store.createProject('Seul projet', 'Work', { parentPath: lone.filePath })
    index.build()
    expect(await createPlace(index, store, spec('create', { create: 'X', project: 'Solo' }))).toMatchObject({
      project: { path: only.filePath },
      via: 'Solo'
    })
    // Nothing of that name: nothing.
    expect(await createPlace(index, store, spec('create', { create: 'X', project: 'Inconnu' }))).toBeNull()
  })

  it('turns a ticket proposed as new but already there into the change to it, and leaves new ones as they are', async () => {
    const program = await store.createProject('COSMA - GMAO', 'Work', { program: true })
    const cosma = await store.createProject('COSMA', 'Work', { parentPath: program.filePath })
    const other = await store.createProject('Autre', 'Work')
    const radier = makeTask({ title: 'Radier', start: '2026-10-01', due: '2026-10-09' })
    await store.insertTask(cosma, radier)
    await store.insertTask(other, makeTask({ title: 'Réception', start: '' }))
    await store.insertTask(cosma, makeTask({ title: 'Réception', start: '' }))
    index.build()
    const block = (record: object): string => ['```pm-change', JSON.stringify(record), '```'].join('\n')
    const reply = [
      'Voici les modifications :',
      block({
        create: 'radier',
        project: 'COSMA - GMAO',
        parent: 'Terrassements',
        changes: { type: 'Tâche', due: '2026-10-20', assignees: ['Anne'] },
        why: 'Retard.'
      }),
      // In another project than the one named: a new ticket there.
      block({ create: 'Radier', project: 'Autre', changes: { due: '2026-10-20' } }),
      // Nothing a ticket changes: left, the card says it is there.
      block({ create: 'Radier', project: 'COSMA', changes: { type: 'Tâche' } }),
      // Two of that name, and no project to tell them apart: not guessed.
      block({ create: 'Réception', project: 'Inconnu', changes: { due: '2026-10-20' } }),
      block({ create: 'Pose', project: 'COSMA', changes: { due: '2026-10-20' } })
    ].join('\n\n')
    const turned = changeBlocks(await asModifications(index, store, reply)).map(
      (source) => JSON.parse(source) as Record<string, unknown>
    )
    expect(turned).toEqual([
      {
        ticket: 'Radier',
        project: 'COSMA',
        changes: { due: '2026-10-20', assignees: ['Anne'] },
        why: 'Retard.'
      },
      { create: 'Radier', project: 'Autre', changes: { due: '2026-10-20' } },
      { create: 'Radier', project: 'COSMA', changes: { type: 'Tâche' } },
      { create: 'Réception', project: 'Inconnu', changes: { due: '2026-10-20' } },
      { create: 'Pose', project: 'COSMA', changes: { due: '2026-10-20' } }
    ])
    // A project the vault does not have: the only ticket of that title, wherever it is.
    expect(await existingTicket(index, store, spec('create', { create: 'Radier', project: 'Inconnu' }))).toMatchObject({
      id: radier.id
    })
    // And the change, applied, is to the ticket that was there.
    const change = spec('ticket', turned[0])
    expect(await applyToTicket(index, store, change)).toMatchObject({ ok: true, changed: true })
    const reloaded = await store.loadProjectByPath(cosma.filePath)
    expect(reloaded?.tasks.filter((task) => task.title === 'Radier')).toHaveLength(1)
    expect(findTaskById(reloaded!, radier.id)).toMatchObject({ due: '2026-10-20', assignees: ['Anne'] })
  })

  it('makes the lot a ticket goes under, once, then the ticket goes under it', async () => {
    const project = await store.createProject('COSMA', 'Work')
    index.build()
    const change = spec('create', { create: 'Définir les codes', project: 'COSMA', parent: 'Actions complémentaires' })
    expect(await applyCreate(index, store, change, label)).toMatchObject({ ok: false, problem: 'parent' })
    expect(await createLot(store, project.filePath, ' Actions complémentaires ')).toBe(true)
    // Already there, however it is written: not made twice.
    expect(await createLot(store, project.filePath, 'actions complementaires')).toBe(false)
    expect(await createLot(store, project.filePath, '  ')).toBe(false)
    expect(await createLot(store, 'Work/Nowhere.md', 'Lot')).toBe(false)
    index.build()
    expect(await applyCreate(index, store, change, label)).toMatchObject({ ok: true, changed: true })
    const lots = (await store.loadProjectByPath(project.filePath))?.tasks ?? []
    expect(lots.map((task) => [task.title, task.type, task.subtasks.map((sub) => sub.title)])).toEqual([
      ['Actions complémentaires', 'phase', ['Définir les codes']]
    ])
  })

  it('offers the projects whose title looks like the name first, and says where tickets can go, with their lots', async () => {
    const program = await store.createProject('COSMA - GMAO', 'Work', { program: true })
    const cosma = await store.createProject('COSMA', 'Work', { parentPath: program.filePath })
    await store.createProject('Autre', 'Work')
    await store.createProject('Modèle COSMA', 'Work', { template: true })
    await store.insertTask(cosma, makeTask({ title: 'Actions complémentaires', type: 'phase', start: '' }))
    await store.insertTask(cosma, makeTask({ title: 'Ticket seul', start: '' }))
    const done = makeTask({ title: 'Vieux lot', type: 'phase', start: '' })
    await store.insertTask(cosma, done)
    await store.archiveTask(cosma, done.id)
    index.build()
    expect(projectsLike(index, 'cosma').map((each) => each.title)).toEqual(['COSMA', 'Autre'])
    expect(projectsLike(index, 'Inconnu').map((each) => each.title)).toEqual(['Autre', 'COSMA'])
    expect(await ticketPlaces(index, store, [program.filePath, cosma.filePath, 'Work/Nowhere.md'])).toEqual([
      { title: 'COSMA', lots: ['Actions complémentaires'] }
    ])
  })

  it('gives a document its register entry, and refuses a programme as its project', async () => {
    const project = await store.createProject('Génie civil', 'Work')
    await store.createProject('Ligne 6', 'Work', { program: true })
    index.build()
    await applyCreate(
      index,
      store,
      spec('create', { create: 'Plan de coffrage', project: 'Génie civil', changes: { type: 'Document' } }),
      label
    )
    const made = (await store.loadProjectByPath(project.filePath))?.tasks[0]
    expect(made).toMatchObject({ type: 'document', document: { state: 'expected', reference: 'Plan de coffrage' } })
    expect(await applyCreate(index, store, spec('create', { create: 'X', project: 'Ligne 6' }), label)).toEqual({
      ok: false,
      problem: 'project',
      allowed: ['Ligne 6']
    })
  })
})

describe('undoing a change applied from the chat', () => {
  let index: VaultIndex
  let store: ProjectStore
  const label = (type: string): string => type

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    index = new VaultIndex(app, () => DEFAULT_SETTINGS)
    store = new ProjectStore(app, () => DEFAULT_SETTINGS, index)
  })

  async function plan() {
    const civil = await store.createProject('Génie civil', 'Work')
    const other = await store.createProject('Équipements', 'Work')
    const first = makeTask({ title: 'Déblais', start: '2026-07-01', due: '2026-07-03', assignees: ['Anne'] })
    const second = makeTask({ title: 'Soutènement', start: '2026-07-06', due: '2026-07-07', dependencies: [first.id] })
    // In another project, waiting on the second: a date moved reaches it too.
    const third = makeTask({ title: 'Pompes', start: '2026-07-08', due: '2026-07-09', dependencies: [second.id] })
    const alone = makeTask({ title: 'Clôture', start: '2026-07-01', due: '2026-07-02' })
    await store.insertTask(civil, first)
    await store.insertTask(civil, second)
    await store.insertTask(civil, alone)
    await store.insertTask(other, third)
    index.build()
    return { civil: civil.filePath, other: other.filePath, first: first.id, second: second.id, third: third.id }
  }

  async function task(path: string, id: string) {
    const project = await store.loadProjectByPath(path)
    return project ? findTaskById(project, id) : null
  }

  it('puts back the ticket and everything its new dates moved, in every project', async () => {
    const { civil, other, first, second, third } = await plan()
    const change = spec('ticket', {
      ticket: 'Déblais',
      changes: { start: '2026-07-15', due: '2026-07-17', assignees: ['Paul'], status: 'Done' }
    })
    const { done, record } = await applyWithUndo(index, store, change, 'Déblais', label, () =>
      applyToTicket(index, store, change)
    )
    expect(done).toMatchObject({ ok: true, changed: true })
    expect(record?.changed.map((step) => step.title).sort()).toEqual(['Déblais', 'Pompes', 'Soutènement'])
    expect(record?.created).toEqual([])
    expect((await task(other, third))?.start).not.toBe('2026-07-08')
    index.build()
    expect(await undoChange(store, record!)).toEqual({ restored: 3, removed: 0, conflicts: [] })
    expect(await task(civil, first)).toMatchObject({
      start: '2026-07-01',
      due: '2026-07-03',
      assignees: ['Anne'],
      completed: ''
    })
    expect((await task(civil, first))?.status).not.toBe('done')
    expect(await task(civil, second)).toMatchObject({ start: '2026-07-06', due: '2026-07-07' })
    expect(await task(other, third)).toMatchObject({ start: '2026-07-08', due: '2026-07-09' })
  })

  it('leaves a ticket changed since, and names it', async () => {
    const { civil, other, first, second, third } = await plan()
    const change = spec('ticket', { ticket: 'Déblais', changes: { due: '2026-07-10' } })
    const { record } = await applyWithUndo(index, store, change, 'Déblais', label, () =>
      applyToTicket(index, store, change)
    )
    const project = await store.loadProjectByPath(civil)
    await store.updateTask(project!, second, { assignees: ['Chloé'], due: '2026-07-30' })
    index.build()
    expect(await undoChange(store, record!)).toMatchObject({ restored: 2, conflicts: ['Soutènement'] })
    expect((await task(civil, first))?.due).toBe('2026-07-03')
    expect((await task(civil, second))?.due).toBe('2026-07-30')
    // What waits on the ticket left as it is stays after it.
    const pumps = await task(other, third)
    expect(pumps?.start && pumps.start > '2026-07-30').toBe(true)
  })

  it('removes a ticket it made, unless changed since; records nothing when nothing was written', async () => {
    const { civil } = await plan()
    const change = spec('create', { create: 'Radier', project: 'Génie civil', changes: { after: ['Déblais'] } })
    const { record } = await applyWithUndo(index, store, change, 'Radier', label, () =>
      applyCreate(index, store, change, label)
    )
    expect(record?.created.map((made) => made.title)).toEqual(['Radier'])
    index.build()
    expect(await undoChange(store, record!)).toMatchObject({ removed: 1, conflicts: [] })
    const titles = async () =>
      (await store.loadProjectByPath(civil))?.tasks.map((one) => one.title).filter((title) => title === 'Radier')
    expect(await titles()).toEqual([])
    // Made again, then renamed by hand: left.
    const again = await applyWithUndo(index, store, change, 'Radier', label, () =>
      applyCreate(index, store, change, label)
    )
    const project = await store.loadProjectByPath(civil)
    const radier = project?.tasks.find((one) => one.title === 'Radier')
    await store.updateTask(project!, radier!.id, { due: '2026-12-01' })
    expect(await undoChange(store, again.record!)).toMatchObject({ removed: 0, conflicts: ['Radier'] })
    // Asked again, already there: nothing written, nothing to undo.
    index.build()
    const twice = await applyWithUndo(index, store, change, 'Radier', label, () =>
      applyCreate(index, store, change, label)
    )
    expect(twice).toMatchObject({ done: { ok: true, changed: false }, record: null })
  })
})

describe('creating a project or a programme from the chat', () => {
  let index: VaultIndex
  let store: ProjectStore

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    index = new VaultIndex(app, () => DEFAULT_SETTINGS)
    store = new ProjectStore(app, () => DEFAULT_SETTINGS, index)
  })

  const folderFor = (parent: string | null) => (parent ? parent.slice(0, parent.lastIndexOf('/')) : 'Projects')

  it('makes a programme in the plan, where projects are kept, once', async () => {
    const change = spec('project', { newProgram: 'FDS', description: 'Programme FDS', why: 'Demandé.' })
    expect(change).toMatchObject({ kind: 'project', title: 'FDS', program: true, parent: '' })
    expect(await applyProject(index, store, change, folderFor)).toEqual({ ok: true, name: 'FDS', changed: true })
    index.build()
    const made = index.projectRefs().find((ref) => ref.title === 'FDS')
    expect(made).toMatchObject({ program: true })
    expect(made?.path.startsWith('Projects/')).toBe(true)
    expect(await applyProject(index, store, change, folderFor)).toEqual({ ok: true, name: 'FDS', changed: false })
  })

  it('makes a project under the programme it names, and refuses one the vault does not have', async () => {
    const program = await store.createProject('FDS', 'Work', { program: true })
    index.build()
    const change = spec('project', { newProject: 'FDS - Lot 1', parent: 'fds' })
    expect(projectTarget(index, change)).toMatchObject({ parent: { path: program.filePath }, existing: null })
    expect(await applyProject(index, store, change, folderFor)).toMatchObject({ ok: true, changed: true })
    index.build()
    expect(index.projectRefs().find((ref) => ref.title === 'FDS - Lot 1')).toMatchObject({
      program: false,
      parentPath: program.filePath
    })
    const lost = spec('project', { newProject: 'Autre', parent: 'Inconnu' })
    expect(projectTarget(index, lost)).toEqual({ problem: 'parent', allowed: ['FDS'] })
    expect(await applyProject(index, store, lost, folderFor)).toMatchObject({ ok: false, problem: 'parent' })
  })
})
