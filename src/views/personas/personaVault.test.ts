import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { personaChoices } from './personaVault'

describe('the personas offered in the settings', () => {
  it('are the persona notes of the vault, by their name or their note’s, in order', async () => {
    const { app, vault } = makeFakeApp({ liveMetadataCache: true })
    await vault.create(
      'Chats/Personas/Juriste.md',
      '---\npm-persona: true\nname: Juriste marchés publics\n---\n\nTu es…\n'
    )
    await vault.create('Chats/Personas/Conducteur.md', '---\npm-persona: true\n---\n\nTu es…\n')
    await vault.create('Chats/Prompts/CR.md', '---\npm-prompt: true\n---\n\nRédige…\n')
    expect(personaChoices(app as unknown as App)).toEqual([
      { path: 'Chats/Personas/Conducteur.md', name: 'Conducteur' },
      { path: 'Chats/Personas/Juriste.md', name: 'Juriste marchés publics' }
    ])
  })
})
