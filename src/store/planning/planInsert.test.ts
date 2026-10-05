import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { DEFAULT_SETTINGS, type PMSettings } from '../../types'
import { ProjectStore } from '../ProjectStore'
import { VaultIndex } from '../VaultIndex'
import { flattenTasks } from '../TaskTreeOps'
import { planTasks, type Plan } from './plan'
import { insertPlanTree } from './planInsert'

const plan: Plan = {
  name: 'B12',
  warnings: [],
  lines: [
    {
      key: '1',
      title: 'Gros œuvre',
      level: 1,
      start: '',
      due: '',
      milestone: false,
      progress: 0,
      people: [],
      notes: '',
      links: []
    },
    {
      key: '2',
      title: 'Coffrage',
      level: 2,
      start: '2026-10-05',
      due: '2026-10-09',
      milestone: false,
      progress: 100,
      people: ['Garonne'],
      notes: '',
      links: []
    },
    {
      key: '3',
      title: 'Coulage',
      level: 2,
      start: '2026-10-14',
      due: '2026-10-16',
      milestone: false,
      progress: 0,
      people: [],
      notes: 'Béton',
      links: [
        { key: '2', type: 'FS', lag: 2 },
        { key: '5', type: 'SS', lag: 0 }
      ]
    },
    {
      key: '4',
      title: 'Radier coulé',
      level: 2,
      start: '2026-10-16',
      due: '2026-10-16',
      milestone: true,
      progress: 0,
      people: [],
      notes: '',
      links: [{ key: '3', type: 'FF', lag: 0 }]
    },
    {
      key: '5',
      title: 'Électricité',
      level: 1,
      start: '2026-10-12',
      due: '2026-10-20',
      milestone: false,
      progress: 0,
      people: [],
      notes: '',
      links: []
    }
  ]
}

describe('a planning imported', () => {
  it('is written as tickets and read back with its outline and its links, forward ones included', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const settings: PMSettings = structuredClone(DEFAULT_SETTINGS)
    const index = new VaultIndex(app, () => settings)
    const store = new ProjectStore(app, () => settings, index)
    const project = await store.createProject('B12', 'Projects')
    let count = 0
    for (const task of planTasks(plan)) count += await insertPlanTree(store, project, task, null)
    expect(count).toBe(5)
    index.build()
    const cold = new ProjectStore(app, () => settings, index)
    const loaded = await cold.loadProjectByPath(project.filePath)
    const tasks = flattenTasks(loaded?.tasks ?? []).map((flat) => flat.task)
    const byTitle = (title: string) => tasks.find((task) => task.title === title)
    expect(loaded?.tasks.map((task) => [task.title, task.type])).toEqual([
      ['Gros œuvre', 'phase'],
      ['Électricité', 'task']
    ])
    expect(byTitle('Coffrage')).toMatchObject({ status: 'done', assignees: ['Garonne'] })
    const coulage = byTitle('Coulage')
    expect(coulage?.dependencies.sort()).toEqual([byTitle('Coffrage')?.id, byTitle('Électricité')?.id].sort())
    expect(coulage?.dependencyOptions?.[byTitle('Coffrage')?.id ?? '']).toEqual({ type: 'FS', lag: 2 })
    expect(coulage?.dependencyOptions?.[byTitle('Électricité')?.id ?? '']).toEqual({ type: 'SS', lag: 0 })
    expect(byTitle('Radier coulé')).toMatchObject({ type: 'milestone', due: '2026-10-16' })
  })
})
