import { describe, expect, it } from 'vitest'
import { addLink, makeRequirement, setText, type Requirement } from '../requirements/Requirement'
import { currentRequirements, requirementsContext, requirementText, type RequirementWords } from './chatRequirements'

const WORDS: RequirementWords = {
  heading: (count) => `Exigences jointes (${count}) :`,
  field: {
    aliases: 'Autres noms',
    category: 'Catégorie',
    type: 'Type',
    status: 'Statut',
    criticality: 'Criticité',
    verification: 'Vérification',
    rationale: 'Justification',
    source: 'Origine',
    links: 'Liens',
    text: 'Énoncé'
  },
  value: (_field, value) =>
    ({ approved: 'Approuvée', performance: 'Performance', high: 'Haute', test: 'Essai' })[value] ?? value,
  source: 'source',
  stale: 'en retard',
  machine: 'traduction automatique non relue',
  linkKind: (kind) => (kind === 'derives-from' ? 'dérivée de' : kind),
  left: (count, list) => `(${count} non envoyées faute de place : ${list})`
}

const full = (): Requirement => {
  let one = makeRequirement({
    id: 'REQ-THERM-0002',
    title: 'Mesure',
    category: 'THERM',
    type: 'performance',
    status: 'approved',
    criticality: 'high',
    verification: 'test',
    rationale: 'Une consigne sans mesure ne se vérifie pas.',
    source: 'CDC §6.2',
    aliases: ['OMLX-THERM-0002'],
    sourceLang: 'fr'
  })
  one = setText(one, 'fr', 'Mesurer toutes les 10 s.', 'franck')
  one = setText(one, 'en', 'Measure every 10 s.', 'llm', 'machine')
  one = setText(one, 'fr', 'Mesurer toutes les 5 s.', 'franck')
  return addLink(one, 'derives-from', 'REQ-THERM-0001')
}

describe('requirementText', () => {
  // Everything a reviewer would want in front of them, the source wording first and each
  // translation saying what is known about it.
  it('writes out a requirement whole, in the reader’s words', () => {
    expect(requirementText(full(), WORDS)).toBe(
      [
        '### REQ-THERM-0002 — Mesure',
        'Autres noms : OMLX-THERM-0002',
        'Catégorie : THERM · Type : Performance · Statut : Approuvée · Criticité : Haute · Vérification : Essai',
        'Énoncé (FR, source) :',
        'Mesurer toutes les 5 s.',
        'Énoncé (EN, en retard, traduction automatique non relue) :',
        'Measure every 10 s.',
        'Justification : Une consigne sans mesure ne se vérifie pas.',
        'Origine : CDC §6.2',
        'Liens : dérivée de REQ-THERM-0001'
      ].join('\n')
    )
  })

  it('writes nothing for what a requirement does not have', () => {
    const bare = setText(makeRequirement({ id: 'REQ-A-0001', title: '', sourceLang: 'fr' }), 'fr', 'Texte.', 'a')
    expect(requirementText(bare, WORDS)).toBe('### REQ-A-0001\nÉnoncé (FR, source) :\nTexte.')
  })
})

describe('requirementsContext', () => {
  const small = (n: number): Requirement =>
    setText(makeRequirement({ id: `REQ-A-000${n}`, title: '', sourceLang: 'fr' }), 'fr', 'x'.repeat(40), 'a')

  it('is nothing when nothing is chosen', () => {
    expect(requirementsContext([], WORDS)).toBe('')
  })

  it('writes the chosen requirements in the order they were chosen', () => {
    const block = requirementsContext([small(2), small(1)], WORDS)
    expect(block.startsWith('Exigences jointes (2) :\n<requirements>\n### REQ-A-0002')).toBe(true)
    expect(block.indexOf('REQ-A-0002')).toBeLessThan(block.indexOf('REQ-A-0001'))
  })

  // Named rather than dropped: the model must not answer as if it had seen them.
  it('names the requirements that did not fit', () => {
    const block = requirementsContext([small(1), small(2), small(3)], WORDS, 170)
    expect(block).toContain('### REQ-A-0001')
    expect(block).toContain('### REQ-A-0002')
    expect(block).not.toContain('### REQ-A-0003')
    expect(block).toContain('(1 non envoyées faute de place : REQ-A-0003)')
  })

  it('always sends the first, however long', () => {
    const long = setText(makeRequirement({ id: 'REQ-L-0001', sourceLang: 'fr' }), 'fr', 'y'.repeat(500), 'a')
    const block = requirementsContext([long, small(1)], WORDS, 100)
    expect(block).toContain('### REQ-L-0001')
    expect(block).toContain('REQ-A-0001)')
  })
})

describe('currentRequirements', () => {
  it('is what the latest question was asked about', () => {
    const turns = [{ role: 'user', requirements: ['REQ-A-0001'] }, { role: 'assistant' }, { role: 'user' }]
    expect(currentRequirements(turns)).toEqual([])
    expect(currentRequirements(turns.slice(0, 2))).toEqual(['REQ-A-0001'])
  })
})
