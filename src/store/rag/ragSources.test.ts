import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import { DocLibrary } from '../library/DocLibrary'
import { DocTextIndex, type TextShelf } from '../library/DocTextIndex'
import { excludedFolders, inProject, leftOut, vaultSources } from './ragSources'

class MemoryShelf implements TextShelf {
  kept = new Map<string, string>()
  async read(key: string): Promise<string | null> {
    return this.kept.get(key) ?? null
  }
  async write(key: string, raw: string): Promise<void> {
    this.kept.set(key, raw)
  }
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const WORDS = { category: 'Catégorie', lot: 'Lot', issuer: 'Émetteur', tags: 'Étiquettes' }

describe('the vault’s sources', () => {
  it('lists notes, projects, tickets, conversations and library documents, each as what it is', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const v = fake.vault
    await v.create('Work/GC/GC.md', '---\npm-project: true\n---\n# Génie civil\n\nLe projet.')
    await v.create(
      'Work/GC/_tasks/t1.md',
      '---\npm-task: true\nid: t1\ntitle: Plan de coffrage\nstatus: en cours\n---\nÀ relire.'
    )
    await v.create('Chats/2026 Radier.md', '---\npm-chat: true\ntitle: Radier\n---\n> [!question]\n> Quand ?')
    await v.create('Notes/CR.md', '---\nprojects: ["[[GC]]"]\ntags: [cr]\n---\n# CR\n\nRadier décalé.')
    await v.create('Archives/Vieux.md', 'Ancien.')
    await v.create('.trash/Jeté.md', 'Jeté.')
    const library = new DocLibrary(
      app,
      () => 'Library',
      () => ({ filesFolder: '_files', notesHeading: 'Notes' }),
      (p) => p
    )
    const texts = new DocTextIndex(app, new MemoryShelf(), {
      words: () => ({ from: '', to: '', date: '', attachments: '' }),
      kept: async () => null
    })
    await library.pour(
      [
        { kind: 'bytes', name: 'Planning.txt', bytes: bytes('Semaine 42 : coulage du radier.') },
        { kind: 'bytes', name: 'Scan.jpg', bytes: bytes('jpeg') },
        { kind: 'bytes', name: 'Note versée.md', bytes: bytes('# Versée\n\nContenu.') }
      ],
      {
        projects: ['Work/GC/GC.md'],
        move: false,
        today: '2026-09-29',
        classification: { category: 'Planning', issuer: 'Setec', tags: ['lot1'] }
      }
    )
    await texts.refresh(library.docs())

    const sources = vaultSources({ app, library, texts, excluded: excludedFolders(' /Archives/ \n\n'), words: WORDS })
    const byPath = Object.fromEntries(sources.map((each) => [each.path, each]))
    expect(Object.keys(byPath).sort()).toEqual([
      'Chats/2026 Radier.md',
      'Library/_files/Note versée.md',
      'Library/_files/Planning.txt',
      'Library/_files/Scan.jpg',
      'Notes/CR.md',
      'Work/GC/GC.md',
      'Work/GC/_tasks/t1.md'
    ])
    // A note poured into the library is looked through once, as a document.
    expect(sources.filter((each) => each.path === 'Library/_files/Note versée.md')).toHaveLength(1)
    // The documents first.
    expect(sources.slice(0, 3).every((each) => each.kind === 'document')).toBe(true)
    expect(byPath['Work/GC/GC.md'].kind).toBe('project')
    expect(byPath['Chats/2026 Radier.md']).toMatchObject({ kind: 'chat', title: 'Radier' })
    expect(byPath['Work/GC/_tasks/t1.md']).toMatchObject({ kind: 'ticket', title: 'Plan de coffrage' })
    expect(await byPath['Work/GC/_tasks/t1.md'].read()).toBe('title: Plan de coffrage\nstatus: en cours\n\nÀ relire.')
    expect(byPath['Notes/CR.md'].projects).toEqual(['Work/GC/GC.md'])
    expect(await byPath['Notes/CR.md'].read()).toBe('projects: GC\ntags: cr\n\n# CR\n\nRadier décalé.')
    expect(byPath['Library/_files/Planning.txt']).toMatchObject({
      kind: 'document',
      title: 'Planning',
      projects: ['Work/GC/GC.md']
    })
    expect(await byPath['Library/_files/Planning.txt'].read()).toBe(
      'Catégorie: Planning\nÉmetteur: Setec\nÉtiquettes: lot1\n\nSemaine 42 : coulage du radier.'
    )
    // A scan never read is known by how it is filed.
    expect(await byPath['Library/_files/Scan.jpg'].read()).toBe(
      'Catégorie: Planning\nÉmetteur: Setec\nÉtiquettes: lot1'
    )

    // Filed again, a document is read again; a note changed, too.
    const planning = library.docs().find((doc) => doc.file === 'Library/_files/Planning.txt')
    if (!planning) throw new Error('no document')
    const before = byPath['Library/_files/Planning.txt'].key
    await library.classify(planning, { lot: 'Lot 1' })
    const after = vaultSources({ app, library, texts, excluded: [], words: WORDS })
    expect(after.find((each) => each.path === 'Library/_files/Planning.txt')?.key).not.toBe(before)
    expect(after.some((each) => each.path === 'Archives/Vieux.md')).toBe(true)
  })

  it('reads the folders left out, and what belongs to a project', () => {
    expect(excludedFolders('Archives\n  /Modèles/ \n')).toEqual(['Archives', 'Modèles'])
    expect(leftOut('Archives/x.md', ['Archives'])).toBe(true)
    expect(leftOut('Archives bis/x.md', ['Archives'])).toBe(false)
    expect(leftOut('A/.cache/x.md', [])).toBe(true)
    expect(inProject({ path: 'Work/GC/_tasks/t.md', projects: [] }, 'Work/GC/GC.md')).toBe(true)
    expect(inProject({ path: 'Notes/x.md', projects: ['Work/GC/GC.md'] }, 'Work/GC/GC.md')).toBe(true)
    expect(inProject({ path: 'Work/GC2/x.md', projects: [] }, 'Work/GC/GC.md')).toBe(false)
    expect(inProject({ path: 'x.md', projects: [] }, 'GC.md')).toBe(false)
  })
})
