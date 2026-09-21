import { describe, expect, it } from 'vitest'
import {
  acceptText,
  displayText,
  isStale,
  isUnreviewedMachine,
  makeRequirement,
  missingLanguages,
  setText,
  staleLanguages,
  textOf
} from './Requirement'

const base = () => makeRequirement({ id: 'REQ-SYS-0042', sourceLang: 'fr' })

const written = (body = 'Le système doit démarrer en moins de 5 s.') => setText(base(), 'fr', body, 'Franck')

describe('writing a requirement', () => {
  it('records the wording, who wrote it and that a person did', () => {
    const req = written()
    expect(textOf(req, 'fr')).toMatchObject({
      body: 'Le système doit démarrer en moins de 5 s.',
      by: 'Franck',
      origin: 'human',
      reviewed: true
    })
  })

  it('does not manufacture a revision out of writing the same words again', () => {
    const once = written()
    expect(setText(once, 'fr', once.text.fr.body, 'Franck')).toBe(once)
    expect(once.history).toHaveLength(0)
  })

  it('bumps the revision when the source wording changes, and keeps what it said', () => {
    const changed = setText(written(), 'fr', 'Le système doit démarrer en moins de 3 s.', 'Franck')
    expect(changed.rev).toBe(2)
    expect(changed.history).toHaveLength(1)
    expect(changed.history[0]).toMatchObject({ rev: 2, lang: 'fr', was: 'Le système doit démarrer en moins de 5 s.' })
  })
})

describe('translations and the source they were made from', () => {
  const translated = () => setText(written(), 'en', 'The system shall start in under 5 s.', 'Franck')

  it('is not behind the moment it is written', () => {
    expect(isStale(translated(), 'en')).toBe(false)
  })

  /** The whole point: nobody has to remember to mark anything. */
  it('falls behind on its own when the source moves', () => {
    const moved = setText(translated(), 'fr', 'Le système doit démarrer en moins de 3 s.', 'Franck')
    expect(isStale(moved, 'en')).toBe(true)
    expect(staleLanguages(moved, ['fr', 'en', 'de'])).toEqual(['en'])
  })

  it('catches up when the translation is rewritten', () => {
    const moved = setText(translated(), 'fr', 'Le système doit démarrer en moins de 3 s.', 'Franck')
    const caught = setText(moved, 'en', 'The system shall start in under 3 s.', 'Franck')
    expect(isStale(caught, 'en')).toBe(false)
  })

  /** Translating is not a change to the requirement; it is a translation catching up. */
  it('does not bump the revision when only a translation changes', () => {
    const moved = setText(translated(), 'en', 'The system shall boot in under 5 s.', 'Franck')
    expect(moved.rev).toBe(1)
  })

  it('never calls the source language behind itself', () => {
    const moved = setText(translated(), 'fr', 'Autre chose.', 'Franck')
    expect(isStale(moved, 'fr')).toBe(false)
  })

  it('says nothing about a language that was never written', () => {
    expect(isStale(translated(), 'de')).toBe(false)
    expect(missingLanguages(translated(), ['fr', 'en', 'de'])).toEqual(['de'])
  })

  it('falls back to the source wording when the language asked for has none', () => {
    expect(displayText(translated(), 'de')?.body).toBe('Le système doit démarrer en moins de 5 s.')
    expect(displayText(translated(), 'en')?.body).toBe('The system shall start in under 5 s.')
  })
})

describe('a wording a machine produced', () => {
  const machine = () => setText(written(), 'en', 'The system shall start in under 5 s.', 'sidonie', 'machine')

  /** Requirements engineering lives on knowing who wrote what. */
  it('arrives unreviewed, and says who produced it', () => {
    expect(textOf(machine(), 'en')).toMatchObject({ origin: 'machine', reviewed: false, by: 'sidonie' })
    expect(isUnreviewedMachine(machine(), 'en')).toBe(true)
  })

  it('becomes reviewed only when a person says so', () => {
    const accepted = acceptText(machine(), 'en', 'Franck')
    expect(textOf(accepted, 'en')).toMatchObject({ origin: 'machine', reviewed: true, by: 'Franck' })
    expect(isUnreviewedMachine(accepted, 'en')).toBe(false)
  })

  it('leaves a human wording alone, having nothing to accept', () => {
    const human = setText(written(), 'en', 'The system shall start in under 5 s.', 'Franck')
    expect(acceptText(human, 'en', 'Someone')).toBe(human)
  })
})

describe('what a changed source does to the links it holds', () => {
  it('puts them all in doubt rather than pretending they still hold', () => {
    const linked = { ...written(), links: [{ kind: 'derives-from' as const, to: 'REQ-SYS-0007' }] }
    const moved = setText(linked, 'fr', 'Autre chose.', 'Franck')
    expect(moved.links[0].suspect).toBe(true)
  })

  it('leaves them alone when only a translation moves', () => {
    const linked = { ...written(), links: [{ kind: 'derives-from' as const, to: 'REQ-SYS-0007' }] }
    const moved = setText(linked, 'en', 'Something else.', 'Franck')
    expect(moved.links[0].suspect).toBeUndefined()
  })
})
