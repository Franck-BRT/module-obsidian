import { describe, expect, it } from 'vitest'
import { addLink, makeRequirement, setText } from './Requirement'
import { escapeXml, reqifId, toReqif, toXhtml } from './reqif'

function req(id: string, fr: string, over: Parameters<typeof makeRequirement>[0] = {}) {
  return setText(makeRequirement({ id, sourceLang: 'fr', ...over }), 'fr', fr, 'franck')
}

const OPTIONS = { lang: 'fr', title: 'Bibliothèque', at: '2026-03-14T10:00:00.000Z' }

describe('escapeXml', () => {
  it('escapes what would otherwise close a tag', () => {
    expect(escapeXml('a < b & c > d "e" \'f\'')).toBe('a &lt; b &amp; c &gt; d &quot;e&quot; &apos;f&apos;')
  })
})

describe('toXhtml', () => {
  it('wraps a sentence in a paragraph', () => {
    expect(toXhtml('La trappe doit ouvrir.')).toBe('<xhtml:p>La trappe doit ouvrir.</xhtml:p>')
  })

  // A requirement written on three lines means something by being on three lines, and a
  // tool receiving it as one run-on sentence has been handed a different requirement.
  it('keeps a line break inside a paragraph', () => {
    expect(toXhtml('a\nb')).toBe('<xhtml:p>a<xhtml:br/>b</xhtml:p>')
  })

  it('makes two paragraphs of a blank line', () => {
    expect(toXhtml('a\n\nb')).toBe('<xhtml:p>a</xhtml:p><xhtml:p>b</xhtml:p>')
  })

  it('escapes inside the paragraph', () => {
    expect(toXhtml('a < b')).toBe('<xhtml:p>a &lt; b</xhtml:p>')
  })

  it('writes an empty paragraph rather than nothing at all', () => {
    expect(toXhtml('  ')).toBe('<xhtml:p/>')
  })
})

describe('reqifId', () => {
  it('makes an identifier XML will accept', () => {
    expect(reqifId('SO', 'REQ-SYS-0001')).toBe('SO-REQ-SYS-0001')
    expect(reqifId('SR', 'REQ A/0001')).toBe('SR-REQ_A_0001')
  })
})

describe('toReqif', () => {
  const library = [
    req('REQ-A-0001', 'La trappe doit ouvrir en 3 s.', { title: 'Trappe', status: 'approved', rev: 2 }),
    req('REQ-A-0002', 'Le bus doit tenir 3 h.', { title: 'Bus' })
  ]

  // This is the file that leaves the building, and the far end is often the very project
  // whose numbering the aliases are.
  it('carries the other names the requirement answers to', () => {
    const xml = toReqif([{ ...library[0], aliases: ['OMLX-SYS-0001', 'CLIENT-12'] }], OPTIONS)
    expect(xml).toContain('LONG-NAME="Aliases"')
    expect(xml).toContain('THE-VALUE="OMLX-SYS-0001; CLIENT-12"')
  })

  it('writes no alias value for a requirement that has none', () => {
    expect(toReqif(library, OPTIONS)).not.toContain('ATTRIBUTE-DEFINITION-STRING-REF>ATT-ALIASES')
  })

  it('writes a document with the sections a reader expects', () => {
    const xml = toReqif(library, OPTIONS)
    for (const section of [
      '<REQ-IF ',
      '<THE-HEADER>',
      '<DATATYPES>',
      '<SPEC-TYPES>',
      '<SPEC-OBJECTS>',
      '<SPECIFICATIONS>'
    ]) {
      expect(xml).toContain(section)
    }
  })

  it('opens and closes every element it opens', () => {
    const xml = toReqif(library, OPTIONS)
    const opened = [...xml.matchAll(/<([A-Za-z][\w:-]*)(?=[\s>])(?![^>]*\/>)/g)].map((m) => m[1])
    const closed = [...xml.matchAll(/<\/([A-Za-z][\w:-]*)>/g)].map((m) => m[1])
    expect(opened.filter((name) => name !== '?xml').sort()).toEqual(closed.sort())
  })

  it('writes one spec object per requirement, and one hierarchy entry for each', () => {
    const xml = toReqif(library, OPTIONS)
    expect([...xml.matchAll(/<SPEC-OBJECT /g)]).toHaveLength(2)
    expect([...xml.matchAll(/<SPEC-HIERARCHY /g)]).toHaveLength(2)
  })

  it('carries the requirement identifier as a foreign id, since ReqIF ids are its own', () => {
    expect(toReqif(library, OPTIONS)).toContain('THE-VALUE="REQ-A-0001"')
  })

  it('says which language the text is in, so the far end does not have to guess', () => {
    expect(toReqif(library, OPTIONS)).toContain('Language: fr')
  })

  it('falls back to the source wording when the language asked for was never written', () => {
    const xml = toReqif(library, { ...OPTIONS, lang: 'en' })
    expect(xml).toContain('La trappe doit ouvrir en 3 s.')
  })

  it('writes the relations between requirements it holds', () => {
    const linked = [addLink(library[0], 'derives-from', 'REQ-A-0002'), library[1]]
    const xml = toReqif(linked, OPTIONS)
    expect(xml).toContain('<SPEC-RELATION ')
    expect(xml).toContain('SRT-derives-from')
  })

  // A relation to something the far end has never heard of makes the document invalid
  // rather than informative.
  it('leaves out a relation to something the file does not hold', () => {
    const linked = [addLink(library[0], 'satisfied-by', 'task-42'), library[1]]
    expect(toReqif(linked, OPTIONS)).not.toContain('<SPEC-RELATION ')
  })

  it('escapes a wording that would otherwise break the document', () => {
    const tricky = [req('REQ-A-0003', 'La sortie doit être < 3 V & stable.')]
    const xml = toReqif(tricky, OPTIONS)
    expect(xml).toContain('&lt; 3 V &amp; stable')
    expect(xml).not.toContain('< 3 V &')
  })

  it('writes the requirements in identifier order, so two exports are the same file', () => {
    const one = toReqif(library, OPTIONS)
    const other = toReqif([...library].reverse(), OPTIONS)
    expect(one).toBe(other)
  })
})
