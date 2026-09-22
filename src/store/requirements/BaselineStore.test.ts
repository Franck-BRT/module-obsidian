import type { App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import { makeRequirement, setText } from './Requirement'
import { BaselineStore } from './BaselineStore'

/**
 * A baseline, written to a vault and taken away again.
 *
 * The writing is proved in Baseline.test.ts, which needs no vault; this is the layer
 * that has a file to lose.
 */
describe('BaselineStore against a vault', () => {
  let vault: FakeVault
  let store: BaselineStore

  const library = [
    setText(makeRequirement({ id: 'REQ-SYS-0001', sourceLang: 'fr' }), 'fr', 'La trappe doit ouvrir.', 'franck')
  ]

  beforeEach(() => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    store = new BaselineStore(fake.app as unknown as App, () => 'Requirements')
  })

  it('writes one where the library can find it', async () => {
    const made = await store.create('Revue de janvier', library)
    expect(made?.filePath).toBe('Requirements/_baselines/Revue de janvier.md')
    expect(vault.getAbstractFileByPath('Requirements/_baselines/Revue de janvier.md')).not.toBeNull()
  })

  it('takes one away', async () => {
    const made = await store.create('Revue de janvier', library)
    expect(await store.delete(made?.filePath ?? '')).toBe(true)
    expect(vault.getAbstractFileByPath('Requirements/_baselines/Revue de janvier.md')).toBeNull()
  })

  // Deleting a record deletes a record: a baseline holds a copy of what the requirements
  // said, never the notes themselves.
  it('leaves the requirements where they are', async () => {
    await vault.create('Requirements/REQ-SYS-0001.md', '---\npm-requirement: true\nid: "REQ-SYS-0001"\n---\n')
    const made = await store.create('Revue de janvier', library)
    await store.delete(made?.filePath ?? '')
    expect(vault.getAbstractFileByPath('Requirements/REQ-SYS-0001.md')).not.toBeNull()
  })

  it('says so rather than throwing when there is nothing there to delete', async () => {
    expect(await store.delete('Requirements/_baselines/Jamais écrite.md')).toBe(false)
  })

  // The name is the file name, and a second baseline under it would overwrite the first
  // record of what was agreed.
  it('refuses a name already taken', async () => {
    await store.create('Revue de janvier', library)
    expect(await store.create('Revue de janvier', library)).toBeNull()
  })
})
