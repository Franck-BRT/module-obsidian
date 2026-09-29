import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { citedFile } from './citedLink'

describe('citedFile', () => {
  it('finds a cited source however the model wrote its link, and never one that is not there', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    await fake.vault.create('Essai RAG/CR réunion 07.md', 'x')
    await fake.vault.createBinary('Library/_files/Planning GC.pdf', new ArrayBuffer(1))
    const consulted = ['Essai RAG/CR réunion 07.md', 'Library/_files/Planning GC.pdf']
    const at = (raw: string): string | undefined => citedFile(app, raw, 'Chats/C.md', consulted)?.file.path

    // As given, and as a model rewrites it.
    expect(at('Essai RAG/CR réunion 07.md')).toBe('Essai RAG/CR réunion 07.md')
    expect(at('Essai RAG/CR réunion 07')).toBe('Essai RAG/CR réunion 07.md')
    expect(at('CR réunion 07')).toBe('Essai RAG/CR réunion 07.md')
    expect(at('Essai%20RAG/CR%20r%C3%A9union%2007.md')).toBe('Essai RAG/CR réunion 07.md')
    expect(at('Essai RAG/CR réunion 07.md'.normalize('NFD'))).toBe('Essai RAG/CR réunion 07.md')
    expect(at('[[Essai RAG/CR réunion 07.md|CR réunion 07]]')).toBe('Essai RAG/CR réunion 07.md')
    expect(at('cr reunion  07')).toBe('Essai RAG/CR réunion 07.md')
    expect(at('RAG/CR réunion 07.md')).toBe('Essai RAG/CR réunion 07.md')
    // A document by its name, its extension left out.
    expect(at('Planning GC')).toBe('Library/_files/Planning GC.pdf')
    expect(citedFile(app, 'Essai RAG/CR réunion 07#Décisions', '', consulted)).toMatchObject({ subpath: '#Décisions' })
    // Not there: nothing, rather than a note made of its name.
    expect(at('CR réunion 99')).toBeUndefined()
    expect(at('')).toBeUndefined()
    expect(citedFile(app, 'CR réunion 99', '', [])).toBeNull()
  })
})
