import { TFile, type App } from 'obsidian'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeFakeApp, type FakeVault } from '../../../test/fakeVault'
import {
  matchesNote,
  NoteLibrary,
  noteBody,
  noteExcerpt,
  noteTitle,
  sortNotes,
  TO_SORT,
  type NoteEntry
} from './NoteLibrary'

const GC = 'Work/Génie civil/Génie civil.md'
const TUNNEL = 'Work/Tunnel/Tunnel.md'
const TITLES: Record<string, string> = { [GC]: 'Génie civil', [TUNNEL]: 'Tunnel' }
const title = (path: string): string => TITLES[path] ?? path

const entry = (over: Partial<NoteEntry>): NoteEntry => ({
  path: 'Notes/x.md',
  title: 'x',
  excerpt: '',
  mtime: 0,
  tags: [],
  projects: [],
  subfolder: '',
  ...over
})

describe('reading a note', () => {
  it('takes its body without its properties, and its title from its first heading or its name', () => {
    const content = '---\ntags: [idee]\n---\n\n# Appel avec Setec\n\nTexte.'
    expect(noteBody(content)).toBe('# Appel avec Setec\n\nTexte.')
    expect(noteTitle('2026-09-29 appel', content)).toBe('Appel avec Setec')
    expect(noteTitle('Sans titre', 'Juste du texte.')).toBe('Sans titre')
  })

  it('makes an excerpt of its first lines, read as prose, cut at a word', () => {
    const content = [
      '---',
      'x: 1',
      '---',
      '# Titre',
      '',
      '> Citation **importante**',
      '- [ ] Appeler [[Work/Setec|Setec]]',
      '1. Voir [le plan](https://exemple.fr/plan)',
      '```',
      'code',
      '```',
      '## Suite',
      'Fin.'
    ].join('\n')
    expect(noteExcerpt(content)).toBe('Citation importante Appeler Setec Voir le plan Fin.')
    // Cut at the last word that fits, not in the middle of one.
    expect(noteExcerpt(`Un ${'mot '.repeat(60)}`, 32)).toBe(`Un${' mot'.repeat(7)}…`)
  })
})

describe('finding a note', () => {
  const call = entry({ title: 'Appel Setec', tags: ['appel'], projects: [GC], subfolder: 'Réunions' })

  it('filters by project, by those still to sort, and by tag', () => {
    const loose = entry({})
    const q = (over: object) => ({ text: '', project: '', tag: '', ...over })
    expect(matchesNote(call, q({ project: GC }), title)).toBe(true)
    expect(matchesNote(call, q({ project: TUNNEL }), title)).toBe(false)
    expect(matchesNote(loose, q({ project: TO_SORT }), title)).toBe(true)
    expect(matchesNote(call, q({ project: TO_SORT }), title)).toBe(false)
    expect(matchesNote(call, q({ tag: 'APPEL' }), title)).toBe(true)
    expect(matchesNote(loose, q({ tag: 'appel' }), title)).toBe(false)
  })

  it('finds every word in its title, folder, tags, projects or text, whatever the accents', () => {
    const q = (text: string) => ({ text, project: '', tag: '' })
    expect(matchesNote(call, q('setec genie'), title)).toBe(true)
    expect(matchesNote(call, q('reunions appel'), title)).toBe(true)
    expect(matchesNote(call, q('radier'), title)).toBe(false)
    expect(matchesNote(call, q('setec radier'), title, () => 'le radier est decale')).toBe(true)
  })

  it('sorts the latest changed first, or by title with numbers as numbers', () => {
    const notes = [
      entry({ path: 'a', title: 'Note 10', mtime: 1 }),
      entry({ path: 'b', title: 'note 2', mtime: 3 }),
      entry({ path: 'c', title: 'Achat', mtime: 2 })
    ]
    expect(sortNotes(notes, 'modified').map((n) => n.path)).toEqual(['b', 'c', 'a'])
    expect(sortNotes(notes, 'title').map((n) => n.path)).toEqual(['c', 'b', 'a'])
  })
})

describe('NoteLibrary', () => {
  let vault: FakeVault
  let library: NoteLibrary

  beforeEach(async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    vault = fake.vault
    await vault.create(GC, '---\npm-project: true\n---\n')
    await vault.create(TUNNEL, '---\npm-project: true\n---\n')
    library = new NoteLibrary(fake.app as unknown as App, () => 'Notes', title)
  })

  const fileAt = (path: string): TFile => {
    const file = vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) throw new Error(`no file at ${path}`)
    return file
  }

  it('lists the notes under its folder, however deep, the plugin’s own aside', async () => {
    await vault.create('Notes/Idée.md', '# Une idée\n\nFaire simple.')
    await vault.create(
      'Notes/Réunions/Appel.md',
      '---\nproject: "[[Génie civil]]"\ntags: ["#appel"]\n---\nAppel avec Setec.'
    )
    await vault.create('Notes/Chat.md', '---\npm-chat: true\n---\n')
    await vault.create('Ailleurs/Autre.md', 'Hors bibliothèque.')
    const entries = await library.entries()
    expect(sortNotes(entries, 'title').map((e) => [e.title, e.subfolder, e.projects, e.tags, e.excerpt])).toEqual([
      ['Appel', 'Réunions', [GC], ['appel'], 'Appel avec Setec.'],
      ['Une idée', '', [], [], 'Faire simple.']
    ])
    expect(library.folded(entries.find((e) => e.title === 'Une idée') ?? entry({}))).toBe('# une idee\n\nfaire simple.')
  })

  it('creates a note in its folder, never over another', async () => {
    await vault.create('Notes/Sans titre.md', 'déjà là')
    const file = await library.create('Sans titre', 'Nouveau.')
    expect(file.path).toBe('Notes/Sans titre-1.md')
    expect(vault.contentAt(file.path)).toBe('Nouveau.')
  })

  it('says which projects a note belongs to, the single project of a kept reply replaced', async () => {
    await vault.create('Notes/Réponse.md', '---\nproject: "[[Génie civil]]"\nmodel: x\n---\nTexte')
    await library.setProjects(fileAt('Notes/Réponse.md'), [GC, TUNNEL])
    let [note] = await library.entries()
    expect(note.projects).toEqual([GC, TUNNEL])
    expect(vault.contentAt('Notes/Réponse.md')).not.toContain('project:')
    await library.setProjects(fileAt('Notes/Réponse.md'), [])
    ;[note] = await library.entries()
    expect(note.projects).toEqual([])
    expect(vault.contentAt('Notes/Réponse.md')).not.toContain('projects')
  })

  it('moves a note beside its project, never over another, and leaves it when it is there', async () => {
    await vault.create('Notes/Appel.md', 'x')
    await vault.create('Work/Génie civil/Appel.md', 'autre')
    const moved = await library.moveTo(fileAt('Notes/Appel.md'), 'Work/Génie civil')
    expect(moved.path).toBe('Work/Génie civil/Appel-1.md')
    expect((await library.moveTo(moved, 'Work/Génie civil')).path).toBe('Work/Génie civil/Appel-1.md')
  })
})
