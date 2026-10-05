import type { App } from 'obsidian'
import { beforeAll, describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { setLocale } from '../../i18n'
import { DEFAULT_SETTINGS, type PMSettings } from '../../types'
import { ProjectStore } from '../../store/ProjectStore'
import { VaultIndex } from '../../store/VaultIndex'
import { DocLibrary } from '../../store/library/DocLibrary'
import { RequirementStore } from '../../store/requirements/RequirementStore'
import { readContacts } from '../../store/contacts'
import { flattenTasks } from '../../store/TaskTreeOps'
import { documentOf } from '../../store/Document'
import { createDemo, removeDemo } from './demo'
import { DEMO_B12, DEMO_C7 } from './demoContent'

beforeAll(() => setLocale('fr'))

describe('the demonstration', () => {
  it('builds two projects with their people, requirements and documents, then takes them all away', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    ;(app as unknown as { workspace: unknown }).workspace = { getLeaf: () => ({ openFile: async () => {} }) }
    const settings: PMSettings = structuredClone(DEFAULT_SETTINGS)
    const index = new VaultIndex(app, () => settings)
    const store = new ProjectStore(app, () => settings, index)
    const library = new DocLibrary(
      app,
      () => 'Bibliothèque',
      () => ({ filesFolder: 'Fichiers', notesHeading: 'Notes' }),
      (path) => path
    )
    const requirements = new RequirementStore(
      app,
      () => settings.requirements,
      async () => {},
      index
    )
    await fake.vault.create('People/Anne Leroy.md', '---\nrole: Vraie personne\n---\n')
    const opened: string[] = []
    const plugin = {
      app,
      settings,
      store,
      index,
      library,
      requirements,
      saveSettings: async () => {},
      router: {
        openScope: (spec: { path: string }) => {
          opened.push(spec.path)
          return Promise.resolve()
        }
      }
    } as never

    await createDemo(plugin)
    index.build()
    const manifest = settings.demo
    expect(manifest?.projects).toHaveLength(2)
    const b12 = await store.loadProjectByPath(manifest?.projects[0] ?? '')
    expect(b12?.title).toBe(DEMO_B12)
    expect(opened).toEqual([b12?.filePath])
    const tasks = flattenTasks(b12?.tasks ?? []).map((flat) => flat.task)
    expect(tasks.filter((task) => task.type === 'risk')).toHaveLength(4)
    expect(tasks.filter((task) => task.type === 'decision')).toHaveLength(3)
    expect(tasks.filter((task) => task.type === 'reserve').map((task) => task.reserve?.number)).toEqual([
      'R-001',
      'R-002',
      'R-003',
      'R-004'
    ])
    expect(tasks.find((task) => task.title === 'Fournir le plan de réservations')?.type).toBe('subtask')
    const note = tasks.find((task) => task.title === 'Note de calcul du radier')
    expect(documentOf(note!).approvers).toEqual(['Anne Leroy', 'Paul Martin'])
    expect(fake.vault.getAbstractFileByPath(documentOf(note!).file)).toBeTruthy()
    expect((await store.loadProjectByPath(manifest?.projects[1] ?? ''))?.title).toBe(DEMO_C7)
    expect(index.requirementRefs().map((one) => one.id)).toEqual(['DEMO-GO-001', 'DEMO-GO-002', 'DEMO-GO-003'])
    expect(
      library
        .docs()
        .map((doc) => doc.title)
        .sort()
    ).toEqual(['CCTP Lot 02 — Gros œuvre', 'Statement of work — Site maintenance'])
    // A person already known is left as they were, and not taken away after.
    expect(manifest?.contacts.some((path) => path.endsWith('Anne Leroy.md'))).toBe(false)
    expect(readContacts(app, 'People').map((one) => one.name)).toContain('Garonne Bâtiment')

    // Asked twice, it is not made twice.
    await createDemo(plugin)
    expect(index.projectPaths()).toHaveLength(2)

    await removeDemo(plugin)
    expect(settings.demo).toBeUndefined()
    expect(index.projectPaths()).toHaveLength(0)
    expect(library.docs()).toEqual([])
    expect(index.requirementRefs()).toEqual([])
    expect(readContacts(app, 'People').map((one) => one.name)).toEqual(['Anne Leroy'])
  })
})
