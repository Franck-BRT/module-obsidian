import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from './Requirement'
import { hydrateRequirement, requirementFrontmatter } from './reqYaml'

const roundTrip = (requirement: ReturnType<typeof makeRequirement>) =>
  hydrateRequirement(requirementFrontmatter(requirement), 'Requirements/REQ-SYS-0042.md')

const sample = () => {
  let req = makeRequirement({
    id: 'REQ-SYS-0042',
    title: 'Temps de démarrage',
    category: 'SYS',
    type: 'performance',
    status: 'approuvée',
    criticality: 'haute',
    verification: 'test',
    source: 'NF EN 12345 §4.2',
    rationale: "L'opérateur ne peut pas attendre.",
    owner: '[[Marie Lefèvre]]',
    tags: ['sécurité'],
    sourceLang: 'fr',
    links: [{ kind: 'derives-from', to: 'REQ-SYS-0007' }]
  })
  req = setText(req, 'fr', 'Le système doit démarrer en moins de 5 s.', 'Franck')
  req = setText(req, 'en', 'The system shall start in under 5 s.', 'sidonie', 'machine')
  return req
}

describe('a requirement on disk', () => {
  it('comes back with everything it went in with', () => {
    const original = sample()
    const back = roundTrip(original)
    expect(back).toMatchObject({
      id: 'REQ-SYS-0042',
      title: 'Temps de démarrage',
      category: 'SYS',
      type: 'performance',
      status: 'approuvée',
      criticality: 'haute',
      verification: 'test',
      source: 'NF EN 12345 §4.2',
      owner: '[[Marie Lefèvre]]',
      tags: ['sécurité'],
      sourceLang: 'fr',
      rev: original.rev
    })
    expect(back.links).toEqual([{ kind: 'derives-from', to: 'REQ-SYS-0007' }])
  })

  /** Who wrote a wording and whether anyone read it is the point of the whole library. */
  it('keeps where each wording came from and whether it was reviewed', () => {
    const back = roundTrip(sample())
    expect(back.text.fr).toMatchObject({ origin: 'human', reviewed: true, by: 'Franck' })
    expect(back.text.en).toMatchObject({ origin: 'machine', reviewed: false, by: 'sidonie' })
  })

  it('keeps the revision each translation was made from, so staleness survives a reload', () => {
    const moved = setText(sample(), 'fr', 'Le système doit démarrer en moins de 3 s.', 'Franck')
    const back = roundTrip(moved)
    expect(back.rev).toBe(2)
    expect(back.text.en.fromRev).toBe(1)
  })

  it('keeps what a wording used to say', () => {
    const moved = setText(sample(), 'fr', 'Autre chose.', 'Franck')
    expect(roundTrip(moved).history[0]).toMatchObject({ lang: 'fr', was: 'Le système doit démarrer en moins de 5 s.' })
  })

  it('writes no line for a field nobody filled in', () => {
    const fm = requirementFrontmatter(makeRequirement({ id: 'REQ-SYS-0001' }))
    expect(fm.rationale).toBeUndefined()
    expect(fm.verification).toBeUndefined()
    expect(fm.tags).toBeUndefined()
    expect(fm.links).toBeUndefined()
  })
})

describe('reading a note a person edited by hand', () => {
  /** `en: "The system shall…"` is what anyone would type. Losing it would be unforgivable. */
  it('accepts a wording written as a plain string', () => {
    const back = hydrateRequirement(
      { id: 'REQ-SYS-0042', rev: 3, text: { fr: 'Le système doit…', en: 'The system shall…' } },
      'x.md'
    )
    expect(back.text.fr.body).toBe('Le système doit…')
    expect(back.text.en).toMatchObject({ body: 'The system shall…', fromRev: 3, origin: 'human', reviewed: true })
  })

  it('ignores an empty wording rather than holding a blank translation', () => {
    const back = hydrateRequirement({ id: 'R', text: { fr: 'Texte', en: '   ', de: {} } }, 'x.md')
    expect(Object.keys(back.text)).toEqual(['fr'])
  })

  /** A note written before the field existed must not light up as unreviewed. */
  it('treats an unstated review as reviewed', () => {
    const back = hydrateRequirement({ id: 'R', text: { fr: { body: 'Texte' } } }, 'x.md')
    expect(back.text.fr.reviewed).toBe(true)
  })

  it('drops a link with no target or an unknown kind', () => {
    const back = hydrateRequirement(
      {
        id: 'R',
        links: [
          { kind: 'derives-from', to: '' },
          { kind: 'invented', to: 'X' },
          { kind: 'refines', to: 'Y' }
        ]
      },
      'x.md'
    )
    expect(back.links).toEqual([{ kind: 'refines', to: 'Y' }])
  })

  it('falls back to something sane on a note that says almost nothing', () => {
    const back = hydrateRequirement({}, 'Requirements/orphan.md')
    expect(back.id).toBe('Requirements/orphan.md')
    expect(back.sourceLang).toBe('fr')
    expect(back.rev).toBe(1)
    expect(back.verification).toBe('none')
  })
})
