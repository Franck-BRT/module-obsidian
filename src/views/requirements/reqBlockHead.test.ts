import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type PMSettings } from '../../types'
import { makeRequirement, setText } from '../../store/requirements/Requirement'
import { reqHeadParts } from './reqBlockHead'

const settings: PMSettings = DEFAULT_SETTINGS

const req = (over: Parameters<typeof makeRequirement>[0] = {}) =>
  makeRequirement({ id: 'REQ-SYS-0001', title: 'Trappe', status: 'draft', ...over })

const kinds = (fields: Parameters<typeof reqHeadParts>[1], requirement = req()) =>
  reqHeadParts(requirement, fields, settings).map((part) => part.kind)

describe('reqHeadParts', () => {
  // The bug this file exists because of: the identifier and the title were drawn ahead
  // of the loop, so they came first whatever the settings said.
  it('draws them in the order asked for, identifier and title included', () => {
    expect(kinds(['rating', 'id', 'status', 'title'])).toEqual(['rating', 'id', 'chip', 'title'])
  })

  it('draws the same columns differently when they were asked for differently', () => {
    expect(kinds(['id', 'title', 'rating'])).toEqual(['id', 'title', 'rating'])
  })

  it('leaves the wording out: it is a paragraph under the head, not a column on it', () => {
    expect(kinds(['id', 'text', 'rating'])).toEqual(['id', 'rating'])
  })

  it('draws nothing at all for a block that asked for nothing', () => {
    expect(reqHeadParts(req(), [], settings)).toEqual([])
  })

  // A row of empty outlines reads as a requirement with something missing, rather than
  // as a document asking for a column this requirement has nothing to put in.
  it('skips a title that is not there', () => {
    expect(kinds(['id', 'title'], req({ title: '' }))).toEqual(['id'])
  })

  it('skips a status that is not there', () => {
    expect(kinds(['status'], req({ status: '' }))).toEqual([])
  })

  it('skips a verification nobody chose, and keeps one somebody did', () => {
    expect(kinds(['verification'], req({ verification: 'none' }))).toEqual([])
    expect(kinds(['verification'], req({ verification: 'test' }))).toEqual(['chip'])
  })

  it('carries the identifier and the title themselves, not just their place', () => {
    expect(reqHeadParts(req(), ['id', 'title'], settings)).toEqual([
      { kind: 'id', id: 'REQ-SYS-0001' },
      { kind: 'title', text: 'Trappe' }
    ])
  })

  it('rates the requirement it was given, as a percentage and as stars', () => {
    const good = setText(
      req({ type: 'functional', criticality: 'high', verification: 'test', source: 'Client', rationale: 'Parce que' }),
      'fr',
      "Le système doit ouvrir la trappe en 3 s au plus après réception de l'ordre.",
      'a'
    )
    const weak = setText(req(), 'fr', 'Ça devrait être rapide, si possible (TBD).', 'a')
    const [rated] = reqHeadParts(good, ['rating'], settings)
    const [poor] = reqHeadParts(weak, ['rating'], settings)
    expect(rated).toMatchObject({ kind: 'rating' })
    expect(poor).toMatchObject({ kind: 'rating' })
    if (rated.kind !== 'rating' || poor.kind !== 'rating') throw new Error('not a rating')
    expect(rated.score).toBeGreaterThan(poor.score)
    expect(rated.stars).toBeGreaterThan(poor.stars)
    // A percentage, so the tooltip reads "78 %" rather than "0.78".
    expect(Number.isInteger(rated.score)).toBe(true)
  })

  // A status deleted from the palette is still the status the note carries, and hiding
  // it would be the tool lying about the note.
  it('shows a status the palette no longer holds as itself', () => {
    const parts = reqHeadParts(req({ status: 'à-revoir' }), ['status'], settings)
    expect(parts).toEqual([{ kind: 'chip', glyph: { label: 'à-revoir', color: '#8b8c92', icon: 'circle-dashed' } }])
  })
})
