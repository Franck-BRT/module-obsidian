import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, makeProject, makeTask } from '../types'
import { ProjectStore } from './ProjectStore'
import { documentsLot, ensureLot, findLot, projectLots, reservesLot } from './projectLots'

describe('project lots', () => {
  it('makes a new project with Documents always, then the settings’ lots, each once', () => {
    expect(projectLots({ projectLots: [reservesLot(), ' Études ', 'documents', ''] })).toEqual([
      documentsLot(),
      reservesLot(),
      'Études'
    ])
    expect(projectLots({ projectLots: [] })).toEqual([documentsLot()])
  })

  it('finds a lot at the project’s top level by its name, case and accents aside, and makes it once', async () => {
    const project = makeProject('P', 'P.md')
    project.tasks = [makeTask({ title: 'Réserves', type: 'phase' }), makeTask({ title: 'Documents', type: 'task' })]
    expect(findLot(project, 'reserves')?.title).toBe('Réserves')
    // A ticket of that name is not a lot.
    expect(findLot(project, 'Documents')).toBeUndefined()
    const inserted: string[] = []
    const store = {
      insertTask: async (target: typeof project, task: (typeof project.tasks)[number]) => {
        target.tasks.push(task)
        inserted.push(task.title)
      }
    }
    const id = await ensureLot(store, project, 'Documents')
    expect(await ensureLot(store, project, 'documents')).toBe(id)
    expect(inserted).toEqual(['Documents'])
  })
})

describe('a new project', () => {
  it('is made with its lots, but a programme and a template are not', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const store = new ProjectStore(fake.app as unknown as App, () => DEFAULT_SETTINGS)
    const lots = projectLots({ projectLots: [reservesLot()] })
    const project = await store.createProject('Chantier', 'Projects', undefined, lots)
    const reloaded = await store.loadProjectByPath(project.filePath)
    expect(reloaded?.tasks.map((task) => [task.title, task.type])).toEqual([
      [documentsLot(), 'phase'],
      [reservesLot(), 'phase']
    ])
    const programme = await store.createProject('Programme', 'Projects', { program: true }, lots)
    expect((await store.loadProjectByPath(programme.filePath))?.tasks).toEqual([])
    const plain = await store.createProject('Sans lots', 'Projects')
    expect((await store.loadProjectByPath(plain.filePath))?.tasks).toEqual([])
  })
})
