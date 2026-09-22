import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from './Requirement'
import { addAlias } from './reqAlias'
import { libraryDeck, requirementSlide, type PptxWords } from './reqPptx'

const words: PptxWords = {
  title: 'Revue des exigences',
  subtitle: (count) => `${count} exigences`,
  glyph: (requirement, field) => (field === 'verification' ? 'Essai' : String(requirement[field])),
  rating: (requirement) => `${requirement.rev}/5`,
  rationale: 'Justification',
  source: 'Origine',
  noWording: 'Pas encore rédigée',
  noCategory: 'Sans catégorie',
  section: 'Catégorie'
}

const req = (over: Parameters<typeof makeRequirement>[0] = {}) =>
  setText(
    makeRequirement({ id: 'REQ-THERM-0001', title: 'Soute', sourceLang: 'fr', ...over }),
    'fr',
    'La soute doit rester entre 5 et 30 °C.',
    'franck'
  )

describe('a requirement on a slide', () => {
  // What somebody says out loud to object, where the eye goes first in a room.
  it('puts the identifier above the title', () => {
    expect(requirementSlide(req(), 'fr', words).eyebrow).toBe('REQ-THERM-0001')
  })

  it('shows the other names it answers to, beside the identifier', () => {
    const slide = requirementSlide(addAlias(req(), 'OMLX-THERM-0001'), 'fr', words)
    expect(slide.eyebrow).toContain('OMLX-THERM-0001')
  })

  it('falls back to the identifier for a requirement nobody has titled', () => {
    expect(requirementSlide(req({ title: '' }), 'fr', words).title).toBe('REQ-THERM-0001')
  })

  it('shows the statement, and nothing above it but the title', () => {
    expect(requirementSlide(req(), 'fr', words).body[0].text).toBe('La soute doit rester entre 5 et 30 °C.')
  })

  // A review that cannot see why a requirement exists spends its time rediscovering it.
  it('carries the rationale under the statement, said quieter', () => {
    const slide = requirementSlide(req({ rationale: 'Les cartes décrochent au-delà.' }), 'fr', words)
    expect(slide.body[1]).toEqual({ text: 'Justification : Les cartes décrochent au-delà.', quiet: true })
  })

  it('stands the source language in where the language asked for was never written', () => {
    expect(requirementSlide(req(), 'en', words).body[0].text).toBe('La soute doit rester entre 5 et 30 °C.')
  })

  it('says so rather than leaving the slide blank', () => {
    expect(requirementSlide(makeRequirement({ id: 'REQ-A-0001' }), 'fr', words).body[0].text).toBe('Pas encore rédigée')
  })

  // A slide is not a spreadsheet, and a reviewer reading columns is not listening.
  it('puts everything else on one line at the bottom', () => {
    const slide = requirementSlide(req({ status: 'approved', type: 'performance' }), 'fr', words)
    expect(slide.footer).toBe('approved  ·  performance  ·  Essai  ·  1/5')
  })
})

describe('the deck', () => {
  const library = [
    req({ id: 'REQ-THERM-0001', category: 'THERM' }),
    req({ id: 'REQ-THERM-0002', category: 'THERM' }),
    req({ id: 'REQ-LOG-0001', category: 'LOG' })
  ]

  it('opens on what it is and how much of it there is', () => {
    const deck = libraryDeck(library, 'fr', words)
    expect(deck.slides[0].title).toBe('Revue des exigences')
    expect(deck.slides[0].body[0].text).toBe('3 exigences')
  })

  // A reviewer who has just been shown where they are reads the next six slides
  // differently from one who has not.
  it('announces each category before the requirements under it', () => {
    const titles = libraryDeck(library, 'fr', words).slides.map((slide) => slide.title)
    expect(titles).toEqual(['Revue des exigences', 'THERM', 'Soute', 'Soute', 'LOG', 'Soute'])
  })

  it('names the requirements nobody filed', () => {
    const deck = libraryDeck([req({ category: '' })], 'fr', words)
    expect(deck.slides[1].title).toBe('Sans catégorie')
  })
})
