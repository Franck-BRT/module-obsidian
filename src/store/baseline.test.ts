import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, makeTask } from '../types'
import { baselineGap, gapText, planEnds } from './baseline'
import { ProjectStore } from './ProjectStore'
import { findTaskById } from './TaskIndex'

describe('how a ticket stands against the reference', () => {
  it('counts the days its end and its start moved, later above zero', () => {
    const gap = baselineGap({
      start: '2026-10-05',
      due: '2026-10-15',
      baseline: { start: '2026-10-01', due: '2026-10-10' }
    })
    expect(gap).toEqual({ end: 5, start: 4 })
    expect(
      baselineGap({ start: '2026-09-28', due: '2026-10-08', baseline: { start: '2026-10-01', due: '2026-10-10' } })
    ).toEqual({ end: -2, start: -3 })
  })

  it('takes a milestone’s day for its end, and says nothing where a plan has no date', () => {
    expect(baselineGap({ start: '2026-10-20', due: '', baseline: { start: '2026-10-14', due: '' } })?.end).toBe(6)
    expect(baselineGap({ start: '', due: '', baseline: { start: '2026-10-01', due: '2026-10-10' } })).toEqual({
      end: null,
      start: null
    })
    expect(baselineGap({ start: '2026-10-01', due: '2026-10-10' })).toBeNull()
  })

  it('is written with its sign, and not at all when it did not move', () => {
    expect(gapText(5, 'j')).toBe('+5 j')
    expect(gapText(-2, 'j')).toBe('−2 j')
    expect(gapText(0, 'j')).toBe('')
    expect(gapText(null, 'j')).toBe('')
  })

  it('says when the plan ends now and in the reference, lots and tickets made since aside', () => {
    expect(
      planEnds([
        { start: '2026-10-01', due: '2026-11-20', type: 'task', baseline: { start: '2026-10-01', due: '2026-11-06' } },
        { start: '2026-10-01', due: '2026-12-31', type: 'phase', baseline: { start: '', due: '2026-12-01' } },
        { start: '2026-12-01', due: '2026-12-24', type: 'task' }
      ])
    ).toEqual({ now: '2026-11-20', planned: '2026-11-06' })
  })
})

describe('freezing the plan as the reference', () => {
  it('keeps each ticket’s dates in its note, read back after a restart, and forgets them when cleared', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const store = new ProjectStore(app, () => DEFAULT_SETTINGS)
    const project = await store.createProject('Génie civil', 'Work')
    const radier = makeTask({ title: 'Radier', start: '2026-10-01', due: '2026-10-10' })
    const dalle = makeTask({ title: 'Dalle', start: '', due: '' })
    await store.insertTask(project, radier)
    await store.insertTask(project, dalle)
    expect(await store.setBaseline(project, '2026-10-01')).toBe(2)
    await store.updateTask(project, radier.id, { due: '2026-10-15' })

    const again = new ProjectStore(app, () => DEFAULT_SETTINGS)
    const reloaded = await again.loadProjectByPath(project.filePath)
    expect(reloaded?.baselineAt).toBe('2026-10-01')
    const read = reloaded ? findTaskById(reloaded, radier.id) : null
    expect(read).toMatchObject({ due: '2026-10-15', baseline: { start: '2026-10-01', due: '2026-10-10' } })
    expect(read && baselineGap(read)?.end).toBe(5)
    expect(reloaded ? findTaskById(reloaded, dalle.id)?.baseline : null).toEqual({ start: '', due: '' })

    if (reloaded) await again.clearBaseline(reloaded)
    const cleared = await new ProjectStore(app, () => DEFAULT_SETTINGS).loadProjectByPath(project.filePath)
    expect(cleared?.baselineAt).toBeUndefined()
    expect(cleared ? findTaskById(cleared, radier.id)?.baseline : 'x').toBeUndefined()
  })
})
