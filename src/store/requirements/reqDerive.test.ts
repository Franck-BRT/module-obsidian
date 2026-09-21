import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from './Requirement'
import { addAlias } from './reqAlias'
import { DERIVE_KINDS, derivationsOf, derivedFrom } from './reqDerive'

const options = {
  category: 'ELEC',
  title: 'Bus de commande',
  kind: 'derives-from' as const,
  by: 'franck',
  status: 'draft',
  at: '2026-09-21T10:00:00.000Z'
}

const source = () => {
  let requirement = makeRequirement({
    id: 'REQ-SYS-0001',
    title: 'Ouverture de la trappe',
    category: 'SYS',
    type: 'functional',
    status: 'approved',
    criticality: 'critical',
    verification: 'test',
    source: 'CLI-2026-014 §4.2',
    rationale: "L'opérateur reprend la main au-delà de 3 s.",
    owner: 'F. Dubourthoumieu',
    tags: ['soute', 'sécurité'],
    sourceLang: 'fr',
    rev: 3,
    history: [{ rev: 1, at: '', by: '', lang: 'fr', was: 'Autrefois.', note: '' }]
  })
  requirement = setText(requirement, 'fr', 'La trappe doit ouvrir en 3 s.', 'franck')
  requirement = setText(requirement, 'en', 'The hatch shall open within 3 s.', 'sidonie', 'machine')
  return addAlias(requirement, 'OMLX-SYS-0001')
}

describe('derivedFrom', () => {
  it('carries over what the two requirements genuinely share', () => {
    expect(derivedFrom(source(), options)).toMatchObject({
      type: 'functional',
      criticality: 'critical',
      verification: 'test',
      source: 'CLI-2026-014 §4.2',
      rationale: "L'opérateur reprend la main au-delà de 3 s.",
      owner: 'F. Dubourthoumieu',
      tags: ['soute', 'sécurité'],
      sourceLang: 'fr'
    })
  })

  it('takes the category and the title it was given, not the original’s', () => {
    expect(derivedFrom(source(), options)).toMatchObject({ category: 'ELEC', title: 'Bus de commande' })
  })

  // A requirement derived from an approved one has been approved by nobody.
  it('never carries the original’s standing across', () => {
    expect(derivedFrom(source(), options).status).toBe('draft')
  })

  it('starts the words again, from revision one', () => {
    const made = derivedFrom(source(), options)
    expect(made.rev).toBe(1)
    expect(made.text?.fr).toEqual({
      body: 'La trappe doit ouvrir en 3 s.',
      fromRev: 1,
      at: '2026-09-21T10:00:00.000Z',
      by: 'franck',
      origin: 'human',
      reviewed: true
    })
  })

  // Copying it does not make anybody have read it.
  it('keeps a machine wording nobody has read exactly as unread as it was', () => {
    expect(derivedFrom(source(), options).text?.en).toMatchObject({ origin: 'machine', reviewed: false })
  })

  it('writes the one link, on the new requirement, pointing back', () => {
    expect(derivedFrom(source(), options).links).toEqual([{ kind: 'derives-from', to: 'REQ-SYS-0001' }])
  })

  it('writes whichever relation was asked for', () => {
    expect(derivedFrom(source(), { ...options, kind: 'refines' }).links?.[0].kind).toBe('refines')
  })

  // An alias is a name a document knows the original by: handing it to the copy would
  // point every citation of it at the wrong requirement.
  it('takes no alias and no history with it', () => {
    const made = derivedFrom(source(), options)
    expect(made.aliases).toEqual([])
    expect(made.history).toEqual([])
  })

  it('mints no identifier of its own', () => {
    expect(derivedFrom(source(), options).id).toBeUndefined()
  })

  // Two requirements sharing one array would edit each other.
  it('copies the tags rather than sharing them', () => {
    const original = source()
    const made = derivedFrom(original, options)
    made.tags?.push('ajouté')
    expect(original.tags).toEqual(['soute', 'sécurité'])
  })

  // A requirement satisfied by another requirement is not a thing: satisfied-by points
  // at a ticket in a plan.
  it('offers only the relations that can hold between two requirements', () => {
    expect(DERIVE_KINDS).not.toContain('satisfied-by')
    expect(DERIVE_KINDS[0]).toBe('derives-from')
  })
})

describe('derivationsOf', () => {
  const parent = makeRequirement({ id: 'REQ-SYS-0001', aliases: ['OMLX-SYS-0001'] })
  const child = (id: string, to: string, kind: 'derives-from' | 'refines' | 'duplicates' = 'derives-from') =>
    makeRequirement({ id, links: [{ kind, to }] })

  // The claim this exists to disprove: a parent derived three times shows three children.
  it('finds every requirement standing beneath it, not the last one written', () => {
    const library = [parent, child('REQ-SYS-0004', 'REQ-SYS-0001'), child('REQ-SYS-0002', 'REQ-SYS-0001')]
    expect(derivationsOf(library, parent).map((r) => r.id)).toEqual(['REQ-SYS-0002', 'REQ-SYS-0004'])
  })

  it('counts a refinement as standing beneath it too', () => {
    const library = [parent, child('REQ-SYS-0002', 'REQ-SYS-0001', 'refines')]
    expect(derivationsOf(library, parent).map((r) => r.id)).toEqual(['REQ-SYS-0002'])
  })

  // Saying the same thing twice is not standing beneath anything.
  it('leaves out a relation that is not a derivation', () => {
    const library = [parent, child('REQ-SYS-0002', 'REQ-SYS-0001', 'duplicates')]
    expect(derivationsOf(library, parent)).toEqual([])
  })

  // A child written in a project's numbering derives from the same requirement.
  it('follows a link written to one of its other names', () => {
    const library = [parent, child('REQ-SYS-0002', 'omlx-sys-0001')]
    expect(derivationsOf(library, parent).map((r) => r.id)).toEqual(['REQ-SYS-0002'])
  })

  it('has nothing to show for a requirement nothing derives from', () => {
    expect(derivationsOf([parent], parent)).toEqual([])
  })
})
