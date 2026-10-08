import { describe, expect, it } from 'vitest'
import {
  groupPersonas,
  matchesPersona,
  personaCategories,
  personaContext,
  personaNoteContent,
  readPersonaNote,
  type PersonaNote
} from './personaLibrary'

const persona = (over: Partial<PersonaNote>): PersonaNote => ({
  path: 'P/x.md',
  name: 'x',
  instructions: 'Tu es…',
  category: '',
  description: '',
  favorite: false,
  ...over
})

describe('a persona note', () => {
  it('is read from its property and body, its name the note’s unless it says another', () => {
    const content =
      '---\npm-persona: true\ncatégorie: Juridique\nfavori: true\n---\n\n%% aide %%\nTu es juriste en marchés publics.\n'
    expect(
      readPersonaNote('P/Juriste.md', 'Juriste', { 'pm-persona': true, catégorie: 'Juridique', favori: true }, content)
    ).toEqual({
      path: 'P/Juriste.md',
      name: 'Juriste',
      instructions: 'Tu es juriste en marchés publics.',
      category: 'Juridique',
      description: '',
      favorite: true
    })
  })

  it('is not one without its property, nor when it says nothing', () => {
    expect(readPersonaNote('a.md', 'a', { 'pm-prompt': true }, 'Tu es…')).toBeNull()
    expect(readPersonaNote('a.md', 'a', { 'pm-persona': true }, '---\npm-persona: true\n---\n\n')).toBeNull()
  })

  it('is written with its properties, and read back the same', () => {
    const content = personaNoteContent({
      category: 'Chantier',
      description: 'Pour préparer une réunion de chantier',
      favorite: true,
      instructions: 'Tu es conducteur de travaux.'
    })
    expect(content).toContain('pm-persona: true')
    const read = readPersonaNote('P/CT.md', 'CT', { 'pm-persona': true, category: 'Chantier', favorite: true }, content)
    expect(read?.instructions).toBe('Tu es conducteur de travaux.')
  })
})

describe('the persona library', () => {
  const lawyer = persona({ name: 'Juriste', category: 'Juridique', description: 'marchés publics' })
  const site = persona({ name: 'Conducteur', category: 'Chantier', favorite: true })
  const other = persona({ name: 'Assistant' })
  const control = persona({ name: 'Contrôleur', category: 'chantier' })

  it('finds a persona by any of its words, accents aside', () => {
    expect(matchesPersona(lawyer, 'marches juriste')).toBe(true)
    expect(matchesPersona(lawyer, 'chantier')).toBe(false)
  })

  it('groups by category whatever the case, favourites first, those of none last', () => {
    expect(personaCategories([lawyer, site, control])).toEqual(['Chantier', 'Juridique'])
    expect(
      groupPersonas([other, site, lawyer, control]).map((group) => [group.category, group.personas.map((p) => p.name)])
    ).toEqual([
      ['Chantier', ['Conducteur', 'Contrôleur']],
      ['Juridique', ['Juriste']],
      ['', ['Assistant']]
    ])
  })

  it('tells the model who it answers as', () => {
    expect(personaContext(lawyer, (name) => `Tu réponds en tant que « ${name} ».`)).toBe(
      'Tu réponds en tant que « Juriste ».\n\nTu es…'
    )
  })
})
