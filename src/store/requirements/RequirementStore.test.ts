import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { DEFAULT_REQUIREMENT_SETTINGS, DEFAULT_SETTINGS, type RequirementSettings } from '../../types'
import { VaultIndex } from '../VaultIndex'
import { RequirementStore } from './RequirementStore'
import { setText } from './Requirement'

/**
 * The whole chain, end to end: minting an id, writing the note, Obsidian parsing it,
 * the index hydrating it. Every layer of that is tested on its own; this is the one that
 * catches the layers disagreeing, which is where the mistakes actually live.
 */
describe('RequirementStore against a vault', () => {
  let vault: FakeVault
  let app: App
  let index: VaultIndex
  let settings: RequirementSettings
  let saves: number
  let store: RequirementStore

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    app = fake.app as unknown as App
    index = new VaultIndex(app, () => ({ ...DEFAULT_SETTINGS }))
    settings = structuredClone(DEFAULT_REQUIREMENT_SETTINGS)
    saves = 0
    store = new RequirementStore(
      app,
      () => settings,
      () => {
        saves += 1
        return Promise.resolve()
      },
      index
    )
  })

  it('writes a requirement the index reads back as the same requirement', async () => {
    const created = await store.create({ title: 'Ouverture de trappe', category: 'SYS' })
    expect(created?.id).toBe('REQ-SYS-0001')
    expect(created?.filePath).toBe('Requirements/REQ-SYS-0001 Ouverture de trappe.md')

    index.build()
    const indexed = index.requirementById('REQ-SYS-0001')
    expect(indexed?.title).toBe('Ouverture de trappe')
    expect(indexed?.category).toBe('SYS')
    expect(indexed?.sourceLang).toBe('fr')
  })

  it('remembers the number it handed out, so the counter survives a deletion', async () => {
    await store.create({ category: 'SYS' })
    expect(settings.counters.SYS).toBe(1)
    expect(saves).toBe(1)

    index.build()
    const file = vault.getAbstractFileByPath('Requirements/REQ-SYS-0001.md')
    expect(file).not.toBeNull()
    if (file) await vault.trashFile(file)
    index.build()
    expect(index.requirementIds()).toEqual([])

    const second = await store.create({ category: 'SYS' })
    expect(second?.id).toBe('REQ-SYS-0002')
  })

  it('counts on from what the library already holds', async () => {
    await store.create({ category: 'SYS' })
    index.build()
    const second = await store.create({ category: 'SYS' })
    expect(second?.id).toBe('REQ-SYS-0002')
  })

  it('carries a wording through the note and back', async () => {
    const created = await store.create({ title: 'Trappe', category: 'SYS' })
    const path = created?.filePath ?? ''
    await store.update(path, (requirement) => setText(requirement, 'fr', 'La trappe doit ouvrir en 3 s.', 'franck'))

    const reloaded = await store.load(path)
    expect(reloaded?.text.fr.body).toBe('La trappe doit ouvrir en 3 s.')
    index.build()
    expect(index.requirementAt(path)?.text.fr.body).toBe('La trappe doit ouvrir en 3 s.')
  })

  it('bumps the revision when the source moves, and marks the translation behind', async () => {
    const created = await store.create({ category: 'SYS' })
    const path = created?.filePath ?? ''
    await store.update(path, (requirement) => setText(requirement, 'fr', 'Version un.', 'a'))
    await store.update(path, (requirement) => setText(requirement, 'en', 'Version one.', 'a'))
    await store.update(path, (requirement) => setText(requirement, 'fr', 'Version deux.', 'a'))

    const reloaded = await store.load(path)
    expect(reloaded?.rev).toBe(2)
    expect(reloaded?.text.en.fromRev).toBe(1)
  })

  // An editor saves on close whether or not anything was typed, so a save that rewrites
  // the note anyway would put a new mtime on every requirement merely looked at.
  it('does not touch the note at all when nothing about the requirement moved', async () => {
    const created = await store.create({ category: 'SYS' })
    const path = created?.filePath ?? ''
    await store.update(path, (requirement) => setText(requirement, 'fr', 'Stable.', 'a'))
    vault.resetCounts()

    await store.update(path, (requirement) => setText(requirement, 'fr', 'Stable.', 'a'))
    expect(vault.modifyCount.get(path) ?? 0).toBe(0)
  })

  it('keeps what the reader typed into the note when the requirement is saved again', async () => {
    const created = await store.create({ title: 'Trappe', category: 'SYS' })
    const path = created?.filePath ?? ''
    await store.update(path, (requirement) => setText(requirement, 'fr', 'La trappe doit ouvrir.', 'a'))
    const file = vault.getAbstractFileByPath(path)
    if (file) await vault.process(file as never, (content) => `${content}\n## Notes\n\nVu en revue.\n`)

    await store.update(path, (requirement) => ({ ...requirement, status: 'approved' }))
    const content = await app.vault.cachedRead(vault.getAbstractFileByPath(path) as never)
    expect(content).toContain('Vu en revue.')
    expect(content.match(/Vu en revue\./g)).toHaveLength(1)
  })

  it('renames the note when the title is rewritten, and leaves the id leading it', async () => {
    const created = await store.create({ title: 'Trappe', category: 'SYS' })
    const path = created?.filePath ?? ''
    const saved = await store.update(path, (requirement) => ({ ...requirement, title: 'Ouverture de trappe' }))
    expect(saved).not.toBeNull()
    const moved = saved === null ? null : await store.syncFileName({ ...saved, filePath: path })
    expect(moved).toBe('Requirements/REQ-SYS-0001 Ouverture de trappe.md')
    expect(vault.getAbstractFileByPath(moved ?? '')).not.toBeNull()
  })

  // Naming a requirement renames its note, so an editor that keeps the path it opened
  // writes its next edit to a file that is no longer there, and loses it without a word.
  it('says where the requirement went when saving moved it', async () => {
    const created = await store.create({ title: '', category: 'SYS' })
    const first = created?.filePath ?? ''
    expect(first).toBe('Requirements/REQ-SYS-0001.md')

    const saved = await store.save(first, (requirement) => ({ ...requirement, title: 'Trappe' }))
    expect(saved?.path).toBe('Requirements/REQ-SYS-0001 Trappe.md')
    expect(saved?.requirement.filePath).toBe('Requirements/REQ-SYS-0001 Trappe.md')
    expect(vault.getAbstractFileByPath(first)).toBeNull()

    // And a second save, made where the first one said, still lands.
    const again = await store.save(saved?.path ?? '', (requirement) => ({ ...requirement, status: 'approved' }))
    expect(again?.requirement.status).toBe('approved')
    expect((await store.load(again?.path ?? ''))?.status).toBe('approved')
  })

  it('reports the same path when nothing about the name moved', async () => {
    const created = await store.create({ title: 'Trappe', category: 'SYS' })
    const path = created?.filePath ?? ''
    const saved = await store.save(path, (requirement) => ({ ...requirement, owner: 'franck' }))
    expect(saved?.path).toBe(path)
  })

  it('refuses a note that is not a requirement', async () => {
    await vault.create('Notes/plain.md', '---\ntitle: Plain\n---\n\nnothing here\n')
    expect(await store.load('Notes/plain.md')).toBeNull()
  })
})
