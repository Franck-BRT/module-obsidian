import { describe, expect, it } from 'vitest'
import type PMPlugin from '../main'
import type { ProjectRef, TaskRef } from './VaultIndex'
import { ZoneRadar } from './ZoneRadar'

const projectRef = (path: string, zones: string[]): ProjectRef =>
  ({ path, title: path, zones, template: false, impactRole: 'both' }) as unknown as ProjectRef

const taskRef = (id: string, projectPath: string, start: string, due: string): TaskRef =>
  ({ id, title: id, projectPath, start, due, status: 'todo', zones: ['rn7'], archived: false }) as unknown as TaskRef

/** A plugin reduced to what the radar reads: an index it asks twice, and the settings. */
function fakePlugin(tasks: TaskRef[]) {
  const state = { tasks }
  const plugin = {
    settings: {
      zones: [{ id: 'rn7', label: 'RN7', color: '#000', icon: 'map-pin' }],
      statuses: [{ id: 'done', complete: true }]
    },
    index: {
      allTaskRefs: () => state.tasks,
      projectRefs: () => [projectRef('P/a.md', []), projectRef('P/b.md', [])]
    }
  } as unknown as PMPlugin
  return { plugin, state }
}

describe('keeping the crossings current', () => {
  const crossing = (): TaskRef[] => [
    taskRef('a1', 'P/a.md', '2026-04-06', '2026-04-10'),
    taskRef('b1', 'P/b.md', '2026-04-08', '2026-04-14')
  ]

  it('finds the crossing across two projects', () => {
    const { plugin } = fakePlugin(crossing())
    expect(new ZoneRadar(plugin).all()).toHaveLength(1)
    expect(new ZoneRadar(plugin).forTask('a1')).toHaveLength(1)
  })

  /**
   * The bug this exists for: a date cleared in a note left the crossing on screen,
   * because the cache was only ever invalidated once, at startup.
   */
  it('lets go of a crossing once a date is cleared', () => {
    const { plugin, state } = fakePlugin(crossing())
    const radar = new ZoneRadar(plugin)
    expect(radar.all()).toHaveLength(1)

    state.tasks = [taskRef('a1', 'P/a.md', '', ''), taskRef('b1', 'P/b.md', '2026-04-08', '2026-04-14')]
    radar.invalidate()

    expect(radar.all()).toEqual([])
    expect(radar.forTask('b1')).toEqual([])
  })

  it('answers from the cache until it is told the world moved', () => {
    const { plugin, state } = fakePlugin(crossing())
    const radar = new ZoneRadar(plugin)
    expect(radar.all()).toHaveLength(1)
    state.tasks = []
    // Deliberate: recomputing on every read would walk the vault on every redrawn row.
    expect(radar.all()).toHaveLength(1)
    radar.invalidate()
    expect(radar.all()).toEqual([])
  })

  it('says it is not armed until a zone exists', () => {
    const { plugin } = fakePlugin([])
    expect(new ZoneRadar(plugin).armed).toBe(true)
    const bare = { ...plugin, settings: { ...plugin.settings, zones: [] } } as unknown as PMPlugin
    expect(new ZoneRadar(bare).armed).toBe(false)
  })

  it('names a zone by its label, and falls back to its id once deleted', () => {
    const { plugin } = fakePlugin([])
    const radar = new ZoneRadar(plugin)
    expect(radar.zoneLabel('rn7')).toBe('RN7')
    expect(radar.zoneLabel('gone')).toBe('gone')
  })
})

describe('reading the vault into the pass', () => {
  /**
   * The adapter, not the detector. The two speak different names for the same things —
   * a ref calls it `impactLevel`, the pass calls it `level` — and an optional field
   * means a mismatch compiles and is silently always absent.
   */
  const ref = (over: Partial<TaskRef>): TaskRef =>
    ({
      id: 'a1',
      title: 'a1',
      projectPath: 'P/a.md',
      start: '2026-04-06',
      due: '2026-04-10',
      status: 'todo',
      zones: ['rn7'],
      impactLevel: undefined,
      archived: false,
      ...over
    }) as unknown as TaskRef

  function plugin(tasks: TaskRef[], projectLevel = 'caution') {
    return {
      settings: {
        zones: [{ id: 'rn7', label: 'RN7', color: '#000', icon: 'map-pin' }],
        statuses: [{ id: 'done', complete: true }]
      },
      index: {
        allTaskRefs: () => tasks,
        projectRefs: () => [
          { path: 'P/a.md', title: 'a', zones: [], template: false, impactRole: 'both', impactLevel: projectLevel },
          { path: 'P/b.md', title: 'b', zones: [], template: false, impactRole: 'both', impactLevel: projectLevel }
        ]
      }
    } as unknown as PMPlugin
  }

  it('carries a level a ticket claims for itself all the way through', () => {
    const radar = new ZoneRadar(
      plugin([ref({ id: 'a1', impactLevel: 'blocking' }), ref({ id: 'b1', projectPath: 'P/b.md' })])
    )
    expect(radar.all()).toHaveLength(1)
    expect(radar.all()[0].level).toBe('blocking')
  })

  it('falls back to the project level when the ticket claims none', () => {
    const radar = new ZoneRadar(plugin([ref({ id: 'a1' }), ref({ id: 'b1', projectPath: 'P/b.md' })], 'info'))
    expect(radar.all()[0].level).toBe('info')
  })

  /** Both sides disturb here, so the crossing is as grave as the graver of the two. */
  it('takes the graver level when the two projects disagree', () => {
    const radar = new ZoneRadar(
      plugin([ref({ id: 'a1', impactLevel: 'blocking' }), ref({ id: 'b1', projectPath: 'P/b.md' })], 'info')
    )
    expect(radar.all()[0].level).toBe('blocking')
  })

  it('reads a ticket zone rather than only the project one', () => {
    const radar = new ZoneRadar(
      plugin([ref({ id: 'a1', zones: ['rn7'] }), ref({ id: 'b1', projectPath: 'P/b.md', zones: ['rn7'] })])
    )
    expect(radar.all()[0].zone).toBe('rn7')
  })

  it('leaves out what the pass is meant to leave out', () => {
    const both = [ref({ id: 'a1' }), ref({ id: 'b1', projectPath: 'P/b.md' })]
    expect(new ZoneRadar(plugin(both)).all()).toHaveLength(1)
    expect(new ZoneRadar(plugin([ref({ id: 'a1', archived: true }), both[1]])).all()).toEqual([])
    expect(new ZoneRadar(plugin([ref({ id: 'a1', status: 'done' }), both[1]])).all()).toEqual([])
    expect(new ZoneRadar(plugin([ref({ id: 'a1', start: '', due: '' }), both[1]])).all()).toEqual([])
  })
})
