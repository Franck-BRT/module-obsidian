import type { App } from 'obsidian'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../test/fakeVault'
import { DocLibrary } from './library/DocLibrary'
import { ChangeLibrary, isChangeNote } from './changeLibrary'
import { changeOf, emptyChange, recordDecision } from './change'

const GC = 'Work/Génie civil/Génie civil.md'
const TUNNEL = 'Work/Tunnel/Tunnel.md'
const TITLES: Record<string, string> = { [GC]: 'Génie civil', [TUNNEL]: 'Tunnel' }

describe('the changes kept in the library', () => {
  let vault: FakeVault
  let library: DocLibrary
  let changes: ChangeLibrary

  beforeEach(async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    await vault.create(GC, '---\npm-project: true\n---\n')
    await vault.create(TUNNEL, '---\npm-project: true\n---\n')
    const app = fake.app as unknown as App
    library = new DocLibrary(
      app,
      () => 'Bibliothèque',
      () => ({ filesFolder: 'Fichiers', notesHeading: 'Notes' }),
      (path) => TITLES[path] ?? path
    )
    changes = new ChangeLibrary(
      app,
      library,
      () => 'Modifications',
      () => 'DM / PM'
    )
  })

  const create = (number: string, projects: string[], over = {}) =>
    changes.create({
      title: `Objet ${number}`,
      change: emptyChange({ number, origin: 'Thales', group: 2, reason: 'Infiltrations', ...over }),
      projects,
      assignees: ['Anne Leroy'],
      due: '2026-11-30',
      today: '2026-10-09'
    })

  it('writes a change as a library record of its own, its number the reference and who asks the issuer', async () => {
    const task = await create('DM-001', [GC])
    expect(task.filePath).toBe('Bibliothèque/Modifications/DM-001 Objet DM-001.md')
    const content = await vault.read(vault.getAbstractFileByPath(task.filePath ?? '') as never)
    expect(content).toContain('pm-library-doc: true')
    expect(content).toContain('pm-change: true')
    expect(content).toContain('reference: DM-001')
    expect(content).toContain('issuer: Thales')
    expect(content).toContain('category: DM / PM')
    const [doc] = library.docs()
    expect(doc.title).toBe('Objet DM-001')
    expect(doc.projects).toEqual([GC])
    expect(doc.reference).toBe('DM-001')
    expect(doc.issuer).toBe('Thales')
    expect(doc.file).toBe(task.filePath)
  })

  it('reads every change back whole, and those of a project — one change may belong to several', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
    await create('DM-001', [GC])
    await create('DM-002', [GC, TUNNEL])
    await create('DM-003', [])
    // Past the moment a change just written is believed over what Obsidian reads.
    vi.setSystemTime(new Date('2026-10-09T10:01:00Z'))
    const all = changes.all()
    expect(all.map((one) => changeOf(one.task).number).sort()).toEqual(['DM-001', 'DM-002', 'DM-003'])
    const read = all.find((one) => changeOf(one.task).number === 'DM-002')?.task
    expect(read?.type).toBe('change')
    expect(read?.assignees).toEqual(['Anne Leroy'])
    expect(read?.due).toBe('2026-11-30')
    expect(changeOf(read ?? {}).origin).toBe('Thales')
    expect(changeOf(read ?? {}).group).toBe(2)
    expect(changeOf(read ?? {}).reason).toBe('Infiltrations')
    expect(changes.forProjects([TUNNEL]).map((one) => changeOf(one.task).number)).toEqual(['DM-002'])
    expect(
      changes
        .forProjects([GC])
        .map((one) => changeOf(one.task).number)
        .sort()
    ).toEqual(['DM-001', 'DM-002'])
    expect(changes.nextNumber()).toBe('DM-004')
    vi.useRealTimers()
  })

  it('keeps the board’s decisions and the tickets carrying it out when saved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
    const task = await create('DM-001', [GC])
    const decided = {
      ...task,
      title: 'Connecteur étanche',
      change: { ...recordDecision(changeOf(task), 0, 'accepted', '2026-10-09', 'OK'), tasks: ['t1'] }
    }
    await changes.save(decided)
    vi.setSystemTime(new Date('2026-10-09T10:01:00Z'))
    const back = changes.at(task.filePath ?? '')?.task
    expect(back?.title).toBe('Connecteur étanche')
    expect(changeOf(back ?? {}).rounds).toEqual([{ round: 0, decision: 'accepted', date: '2026-10-09', comment: 'OK' }])
    expect(changeOf(back ?? {}).tasks).toEqual(['t1'])
    expect(changeOf(back ?? {}).number).toBe('DM-001')
    expect(library.docs()[0].title).toBe('Connecteur étanche')
    vi.useRealTimers()
  })

  it('belongs to the projects it is given, as a document', async () => {
    const task = await create('DM-001', [GC])
    const record = changes.at(task.filePath ?? '')
    if (!record) throw new Error('no record')
    await changes.setProjects(record.doc, [GC, TUNNEL])
    expect(changes.forProjects([TUNNEL]).map((one) => one.task.filePath)).toEqual([task.filePath])
  })

  it('is told from a document by its property', () => {
    expect(isChangeNote({ 'pm-change': true })).toBe(true)
    expect(isChangeNote({ 'pm-library-doc': true })).toBe(false)
  })
})
