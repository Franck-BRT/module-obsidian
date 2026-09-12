import { describe, expect, it, beforeEach } from 'vitest'
import type { App } from 'obsidian'
import { makeFakeApp } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, type PMSettings, type Project } from '../types'
import { ProjectScope } from './ProjectScope'
import { ProjectStore } from './ProjectStore'
import { VaultIndex } from './VaultIndex'
import { PROGRAM_FRONTMATTER_KEY } from './YamlParser'

const SETTINGS: PMSettings = DEFAULT_SETTINGS

/**
 * A programme groups projects and holds no work of its own. These pin the two halves of
 * that sentence: what the note says it is, and where a ticket is allowed to land.
 */
describe('a programme', () => {
  let store: ProjectStore
  let index: VaultIndex
  let app: App
  let program: Project
  let alpha: Project
  let beta: Project

  beforeEach(async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    app = fake.app as unknown as App
    index = new VaultIndex(app, () => SETTINGS)
    store = new ProjectStore(app, () => SETTINGS, index)
    program = await store.createProject('Ligne 6', 'Work', { program: true })
    alpha = await store.createProject('Génie civil', 'Work', { parentPath: program.filePath })
    beta = await store.createProject('Équipements', 'Work', { parentPath: program.filePath })
    index.build()
  })

  it('says so in its note, and an ordinary project says nothing', async () => {
    const file = app.vault.getAbstractFileByPath(program.filePath)
    const text = file ? await app.vault.cachedRead(file as never) : ''
    expect(text).toContain(`${PROGRAM_FRONTMATTER_KEY}: true`)
    const plain = app.vault.getAbstractFileByPath(alpha.filePath)
    const plainText = plain ? await app.vault.cachedRead(plain as never) : ''
    expect(plainText).not.toContain(PROGRAM_FRONTMATTER_KEY)
  })

  it('is read back as one, from the note and from the index', async () => {
    const file = app.vault.getAbstractFileByPath(program.filePath)
    const reloaded = file ? await store.loadProject(file as never) : null
    expect(reloaded?.program).toBe(true)
    expect(index.projectRef(program.filePath)?.program).toBe(true)
    expect(index.projectRef(alpha.filePath)?.program).toBe(false)
  })

  it('takes no ticket of its own: the projects under it are the destinations', () => {
    const scope = new ProjectScope({ kind: 'subtree', path: program.filePath }, [program, alpha, beta], store)
    expect(scope.isProgram).toBe(true)
    expect(scope.addableProjects.map((p) => p.title)).toEqual(['Génie civil', 'Équipements'])
    expect(scope.canAddTask).toBe(true)
  })

  it('offers nowhere to add while it holds nothing', () => {
    const scope = new ProjectScope({ kind: 'subtree', path: program.filePath }, [program], store)
    expect(scope.addableProjects).toEqual([])
    // The button would have nowhere to write, so it is not drawn at all.
    expect(scope.canAddTask).toBe(false)
  })

  it('is not a programme when the flag is absent, and its own project can still take tickets', () => {
    const scope = new ProjectScope({ kind: 'project', path: alpha.filePath }, [alpha], store)
    expect(scope.isProgram).toBe(false)
    expect(scope.canAddTask).toBe(true)
    expect(scope.addableProjects.map((p) => p.title)).toEqual(['Génie civil'])
  })

  it('gathers what its projects hold: the subtree is the programme and everything under it', () => {
    expect(
      index
        .descendantRefs(program.filePath)
        .map((ref) => ref.title)
        .sort()
    ).toEqual(['Génie civil', 'Équipements'])
  })
})
