import { describe, expect, it, beforeEach } from 'vitest'
import type { App } from 'obsidian'
import { makeFakeApp } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, makeDocument, makeTask, type PMSettings, type Project } from '../types'
import { ProjectStore } from './ProjectStore'
import { VaultIndex } from './VaultIndex'
import { flattenTasks } from './TaskTreeOps'
import { TEMPLATE_FRONTMATTER_KEY } from './YamlParser'

const SETTINGS: PMSettings = DEFAULT_SETTINGS

describe('starting a project from a template', () => {
  let store: ProjectStore
  let index: VaultIndex
  let app: App
  let template: Project

  beforeEach(async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    app = fake.app as unknown as App
    index = new VaultIndex(app, () => SETTINGS)
    store = new ProjectStore(app, () => SETTINGS, index)
    template = await store.createProject('Lancement type', 'Modèles', { template: true })
    const lot = makeTask({ title: 'Lot 1 — Études', type: 'phase', start: '2026-01-05', due: '2026-02-05' })
    await store.insertTask(template, lot, null)
    await store.insertTask(template, makeTask({ title: 'Revue', type: 'milestone', due: '2026-02-05' }), lot.id)
    await store.insertTask(
      template,
      makeTask({
        title: 'Plan de masse',
        type: 'document',
        due: '2026-01-20',
        status: 'done',
        progress: 100,
        document: makeDocument({ reference: 'PL-001', issuer: 'BET', file: 'x.pdf', state: 'approved' })
      }),
      lot.id
    )
    index.build()
  })

  it('is a project, not another template', async () => {
    const made = await store.createFromTemplate(template, { title: 'VA280', folder: 'Projets', start: '2026-06-01' })
    expect(made.template).toBeUndefined()
    const file = app.vault.getAbstractFileByPath(made.filePath)
    const text = file ? await app.vault.cachedRead(file as never) : ''
    expect(text).not.toContain(TEMPLATE_FRONTMATTER_KEY)
  })

  it('brings the shape across, lots and milestones included', async () => {
    const made = await store.createFromTemplate(template, { title: 'VA281', folder: 'Projets', start: '2026-06-01' })
    const titles = flattenTasks(made.tasks).map((flat) => flat.task.title)
    expect(titles).toContain('Lot 1 — Études')
    expect(titles).toContain('Revue')
    expect(titles).toContain('Plan de masse')
    expect(flattenTasks(made.tasks)).toHaveLength(3)
  })

  it('gives every ticket a new identity, so the two projects never share one', async () => {
    const made = await store.createFromTemplate(template, { title: 'VA282', folder: 'Projets', start: '2026-06-01' })
    const before = new Set(flattenTasks(template.tasks).map((flat) => flat.task.id))
    for (const { task } of flattenTasks(made.tasks)) expect(before.has(task.id)).toBe(false)
  })

  it('moves the plan to the day asked for, and drops the history', async () => {
    const made = await store.createFromTemplate(template, { title: 'VA283', folder: 'Projets', start: '2026-06-01' })
    const lot = made.tasks[0]
    expect(lot?.start).toBe('2026-06-01')
    expect(lot?.due).toBe('2026-07-02')
    const doc = flattenTasks(made.tasks).find((flat) => flat.task.title === 'Plan de masse')?.task
    expect(doc?.status).toBe('todo')
    expect(doc?.progress).toBe(0)
    expect(doc?.document?.reference).toBe('PL-001')
    expect(doc?.document?.file).toBe('')
  })

  it('leaves the template exactly as it was', async () => {
    await store.createFromTemplate(template, { title: 'VA284', folder: 'Projets', start: '2026-06-01' })
    expect(template.tasks[0]?.start).toBe('2026-01-05')
    expect(flattenTasks(template.tasks).find((f) => f.task.title === 'Plan de masse')?.task.status).toBe('done')
  })

  it('is kept out of the lists and the scopes, while the project it made is in them', async () => {
    const made = await store.createFromTemplate(template, { title: 'VA285', folder: 'Projets', start: '2026-06-01' })
    index.build()
    const paths = index.projectPaths()
    expect(paths).toContain(made.filePath)
    expect(paths).not.toContain(template.filePath)
    expect(index.templateRefs().map((ref) => ref.title)).toEqual(['Lancement type'])
    // Its tickets are a shape, so nothing that gathers tasks across the vault sees them.
    const gathered = index.allTaskRefs().map((ref) => ref.projectPath)
    expect(gathered).not.toContain(template.filePath)
  })
})
