import { describe, expect, it } from 'vitest'
import { parseXml, child, children } from '../xmlParse'
import { addLink, makeRequirement, setText, type Requirement } from './Requirement'
import { addAlias } from './reqAlias'
import { readReqXml, REQ_XML_KEYS, REQ_XML_NAMESPACE, toReqXml } from './reqXml'
import { REQUIREMENT_FRONTMATTER_KEYS } from './reqYaml'

const OPTIONS = { exported: '2026-09-25T10:00:00.000Z' }

/** Every field a note can hold, filled, so a field the XML forgets cannot hide. */
function full(): Requirement {
  let requirement = makeRequirement({
    id: 'REQ-THERM-0001',
    title: 'Maintien <en> température & "soute"',
    category: 'THERM',
    type: 'performance',
    status: 'approved',
    criticality: 'critical',
    verification: 'test',
    source: 'CLI-2026-014 §6.1',
    rationale: "Les cartes décrochent au-delà ; c'est l'essai du 18/09.",
    owner: 'F. Dubourthoumieu',
    tags: ['soute', 'thermique'],
    sourceLang: 'fr',
    history: [
      { rev: 1, at: '2026-09-12T08:00:00.000Z', by: 'franck', lang: 'fr', was: 'Avant <35 °C>.', note: 'Revue.' }
    ],
    createdAt: '2026-09-12T08:00:00.000Z',
    updatedAt: '2026-09-19T14:25:00.000Z'
  })
  requirement = setText(requirement, 'fr', '  La soute doit rester entre 5 °C et 30 °C.\nToujours.  ', 'franck')
  requirement = setText(requirement, 'en', 'The hold shall stay between 5 and 30 °C.', 'sidonie', 'machine')
  requirement = setText(requirement, 'fr', 'La soute doit rester entre 5 °C et 28 °C.', 'franck')
  requirement = addLink(requirement, 'derives-from', 'REQ-SYS-0001')
  requirement = { ...requirement, links: requirement.links.map((link) => ({ ...link, suspect: true })) }
  return addAlias(requirement, 'OMLX-THERM-0001')
}

describe('keeping the XML in step with the note', () => {
  /**
   * The danger of a second shape is that it drifts from the first while the file still
   * looks well-formed. A field added to requirements and forgotten here fails this rather
   * than leaving the XML quietly short.
   */
  it('handles every key a note can hold, and nothing a note cannot', () => {
    const handled = [
      ...REQ_XML_KEYS.attributes,
      ...REQ_XML_KEYS.elements,
      ...REQ_XML_KEYS.structured,
      ...REQ_XML_KEYS.implied
    ]
    expect([...handled].sort()).toEqual([...REQUIREMENT_FRONTMATTER_KEYS].sort())
  })
})

describe('the file', () => {
  const root = () => parseXml(toReqXml([full()], OPTIONS))

  it('says what it is, in the namespace a reader can check', () => {
    expect(root().name).toBe('requirements')
    expect(root().attrs).toMatchObject({
      xmlns: REQ_XML_NAMESPACE,
      exported: OPTIONS.exported,
      count: '1',
      languages: 'en fr'
    })
  })

  it('writes an element named for what it holds', () => {
    const node = children(root(), 'requirement')[0]
    expect(node.attrs.id).toBe('REQ-THERM-0001')
    expect(child(node, 'status')?.text).toBe('approved')
    expect(children(child(node, 'aliases') ?? node, 'alias').map((alias) => alias.text)).toEqual(['OMLX-THERM-0001'])
  })

  it('writes every wording with what it knows about itself', () => {
    const en = children(children(root(), 'requirement')[0], 'text').find((node) => node.attrs.lang === 'en')
    expect(en?.attrs).toMatchObject({ origin: 'machine', reviewed: 'false', fromRev: '1' })
  })

  // A wording's leading space and its line breaks are part of it.
  it('never pretty-prints inside a wording', () => {
    const one = setText(makeRequirement({ id: 'REQ-A-0001', sourceLang: 'fr' }), 'fr', '  un\n  deux  ', 'a')
    expect(toReqXml([one], OPTIONS)).toContain('>  un\n  deux  </text>')
  })

  it('escapes what would otherwise be markup', () => {
    expect(toReqXml([full()], OPTIONS)).toContain(
      '<title>Maintien &lt;en&gt; température &amp; &quot;soute&quot;</title>'
    )
  })

  it('writes no element for a field the requirement never filled in', () => {
    const bare = toReqXml([setText(makeRequirement({ id: 'REQ-A-0001', sourceLang: 'fr' }), 'fr', 'x', 'a')], OPTIONS)
    expect(bare).not.toContain('<rationale>')
    expect(bare).not.toContain('<links>')
  })

  it('gives the same bytes for the same library, whatever order it arrived in', () => {
    const a = setText(makeRequirement({ id: 'REQ-A-0001', sourceLang: 'fr' }), 'fr', 'a', 'x')
    const b = setText(makeRequirement({ id: 'REQ-B-0001', sourceLang: 'fr' }), 'fr', 'b', 'x')
    expect(toReqXml([a, b], OPTIONS)).toBe(toReqXml([b, a], OPTIONS))
  })
})

describe('reading it back', () => {
  // The evidence that the export is lossless rather than the claim that it is.
  it('gives back the requirement that went in, every field of it', () => {
    const before = full()
    const read = readReqXml(toReqXml([before], OPTIONS))
    expect(read.problems).toEqual([])
    expect({ ...read.requirements[0], filePath: before.filePath }).toEqual(before)
  })

  // "No requirements" and "not this format" are different mornings.
  it('names a file it did not write rather than reading it as an empty library', () => {
    expect(readReqXml('<?xml version="1.0"?><REQ-IF></REQ-IF>').problems).toEqual(['root: <REQ-IF>'])
  })

  it('says where a broken file is broken', () => {
    const read = readReqXml('<requirements><requirement id="X"></requirements>')
    expect(read.requirements).toEqual([])
    expect(read.problems[0]).toMatch(/closes <requirement>/)
  })

  it('reads a requirement with no identifier as a problem, and the rest as requirements', () => {
    const read = readReqXml(
      `<requirements xmlns="${REQ_XML_NAMESPACE}"><requirement><title>?</title></requirement><requirement id="REQ-A-0001"><text lang="fr">x</text></requirement></requirements>`
    )
    expect(read.requirements.map((r) => r.id)).toEqual(['REQ-A-0001'])
    expect(read.problems).toEqual(['requirement[0]: no identifier'])
  })

  it('notices a namespace it was not expecting, and reads on', () => {
    const read = readReqXml('<requirements xmlns="urn:someone-else"><requirement id="REQ-A-0001"/></requirements>')
    expect(read.requirements).toHaveLength(1)
    expect(read.problems).toEqual(['xmlns: urn:someone-else'])
  })
})
