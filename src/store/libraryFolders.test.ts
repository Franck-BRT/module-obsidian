import { TFile, type App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../test/fakeVault'
import { moveInto, parentOf } from './libraryFolders'

describe('library folders', () => {
  it('moves a file into another folder, never over one of the same name, and leaves it where it already is', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    await fake.vault.create('L/A/x.md', 'a')
    await fake.vault.create('L/x.md', 'b')
    const file = fake.vault.getAbstractFileByPath('L/A/x.md')
    if (!(file instanceof TFile)) throw new Error('no file')
    expect([...(await moveInto(app, file, 'L/A'))]).toEqual([])
    expect(file.path).toBe('L/A/x.md')
    expect([...(await moveInto(app, file, 'L'))]).toEqual([['L/A/x.md', 'L/x-1.md']])
  })

  it('tells the folder a folder is in', () => {
    expect(parentOf('A/B/C')).toBe('A/B')
    expect(parentOf('A')).toBe('')
  })
})
