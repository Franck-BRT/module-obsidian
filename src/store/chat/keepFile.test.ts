import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { DEFAULT_SETTINGS } from '../../types'
import { DocumentStore } from '../DocumentStore'
import { ProjectStore } from '../ProjectStore'
import { VaultIndex } from '../VaultIndex'
import { projectInboxFolder } from '../vaultFs'
import { keepDroppedFile, type KeepDeps } from './keepFile'

describe('a file dropped on the chat', () => {
  let app: App
  let store: ProjectStore
  let deps: KeepDeps

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    app = fake.app as unknown as App
    const index = new VaultIndex(app, () => DEFAULT_SETTINGS)
    store = new ProjectStore(app, () => DEFAULT_SETTINGS, index)
    deps = { app, store, documents: new DocumentStore(app), looseFolder: 'Chats/Fichiers', by: 'Anne', note: 'Reçu' }
  })

  // A planning received is a document the project was sent: filed the way its inbox files one.
  it('is filed into the attached project as a document ticket, received', async () => {
    const project = await store.createProject('Ligne 6', 'Work')
    const kept = await keepDroppedFile(deps, 'Planning: indice C.pdf', new Uint8Array([1, 2]), project.filePath)
    expect(kept).toEqual({ path: 'Work/Ligne 6/_docs/Planning- indice C.pdf', filed: true })
    expect(app.vault.getAbstractFileByPath(kept.path)).not.toBeNull()
    const reloaded = await store.loadProjectByPath(project.filePath)
    const ticket = reloaded?.tasks.find((task) => task.type === 'document')
    expect(ticket?.title).toBe('Planning: indice C')
    expect(ticket?.document).toMatchObject({ state: 'received', file: kept.path })
    expect(ticket?.document?.versions[0]).toMatchObject({ by: 'Anne', note: 'Reçu' })
    // Nothing left behind in the inbox: it went through it, as a deposit moves a file.
    const inbox = projectInboxFolder(app, project.filePath)
    expect(inbox).toMatch(/^Work\/Ligne 6\//)
    expect(app.vault.getAbstractFileByPath(`${inbox}/Planning- indice C.pdf`)).toBeNull()
  })

  it('goes beside the conversations with no project, never on top of another file', async () => {
    const first = await keepDroppedFile(deps, 'planning.pdf', new Uint8Array([1]), null)
    const second = await keepDroppedFile(deps, 'planning.pdf', new Uint8Array([2]), null)
    expect([first.path, second.path]).toEqual(['Chats/Fichiers/planning.pdf', 'Chats/Fichiers/planning-1.pdf'])
    expect(first.filed).toBe(false)
  })

  it('is not filed into a programme, which holds no tickets', async () => {
    const programme = await store.createProject('Réseau', 'Work', { program: true })
    const kept = await keepDroppedFile(deps, 'note.pdf', new Uint8Array([1]), programme.filePath)
    expect(kept).toEqual({ path: 'Chats/Fichiers/note.pdf', filed: false })
  })
})
