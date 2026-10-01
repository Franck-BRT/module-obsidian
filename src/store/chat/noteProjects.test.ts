import { describe, expect, it } from 'vitest'
import { noteProjects } from './noteProjects'

describe('the projects a note belongs to', () => {
  const refs = [
    { path: 'Projets/Génie civil/Génie civil.md' },
    { path: 'Projets/Génie civil/Lot 2/Lot 2.md' },
    { path: 'Projets/Équipements.md' },
    { path: 'Projets/Clôture.md' },
    { path: 'Modèles/Projet type/Projet type.md', template: true }
  ]
  const byName = new Map(refs.map((ref) => [ref.path.replace(/^.*\//, '').replace(/\.md$/, ''), ref.path]))
  const resolve = (link: string): string | null => byName.get(link) ?? (refs.some((r) => r.path === link) ? link : null)

  it('are those its properties name, whatever the word, a template never', () => {
    expect(
      noteProjects(
        'CR/CR 07.md',
        { projects: ['[[Équipements]]', '[[Inconnu]]'], projet: '[[Clôture|la clôture]]' },
        refs,
        resolve
      )
    ).toEqual(['Projets/Équipements.md', 'Projets/Clôture.md'])
    expect(noteProjects('CR/CR 07.md', { project: '[[Projet type]]' }, refs, resolve)).toEqual([])
  })

  it('is, failing that, the one whose own folder holds it, the deepest', () => {
    expect(noteProjects('Projets/Génie civil/CR/CR 07.md', {}, refs, resolve)).toEqual([
      'Projets/Génie civil/Génie civil.md'
    ])
    expect(noteProjects('Projets/Génie civil/Lot 2/CR 3.md', undefined, refs, resolve)).toEqual([
      'Projets/Génie civil/Lot 2/Lot 2.md'
    ])
  })

  it('is none when the folder holds several projects side by side, or none at all', () => {
    expect(noteProjects('Projets/CR 07.md', {}, refs, resolve)).toEqual([])
    expect(noteProjects('Ailleurs/CR 07.md', {}, refs, resolve)).toEqual([])
  })
})
