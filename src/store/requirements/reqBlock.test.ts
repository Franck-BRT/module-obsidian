import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from './Requirement'
import {
  DEFAULT_REQ_BLOCK_FIELDS,
  isEmptySpec,
  parseReqBlock,
  quotedWording,
  selectRequirements,
  type ReqBlockSpec
} from './reqBlock'

const req = (over: Parameters<typeof makeRequirement>[0] = {}) => makeRequirement({ sourceLang: 'fr', ...over })

describe('parseReqBlock', () => {
  it('reads a bare identifier, which is the common case', () => {
    expect(parseReqBlock('REQ-SYS-0001').ids).toEqual(['REQ-SYS-0001'])
  })

  it('reads several, however they were separated', () => {
    expect(parseReqBlock('ids: REQ-SYS-0001, REQ-SYS-0002; REQ-SYS-0003').ids).toEqual([
      'REQ-SYS-0001',
      'REQ-SYS-0002',
      'REQ-SYS-0003'
    ])
  })

  it('reads them across lines, with blanks and comments in between', () => {
    const spec = parseReqBlock('# les deux premières\nREQ-SYS-0001\n\nREQ-SYS-0002\n')
    expect(spec.ids).toEqual(['REQ-SYS-0001', 'REQ-SYS-0002'])
  })

  it('reads a selection', () => {
    const spec = parseReqBlock('category: SYS\ntype: functional\nstatus: approved\nlang: EN\nsort: title')
    expect(spec).toMatchObject({ category: 'SYS', type: 'functional', status: 'approved', lang: 'en', sort: 'title' })
  })

  it('keeps only the columns it knows how to draw', () => {
    expect(parseReqBlock('fields: id, text, couleur, status').fields).toEqual(['id', 'text', 'status'])
  })

  it('knows the rating is a column a document can ask for', () => {
    expect(parseReqBlock('fields: id, text, rating').fields).toEqual(['id', 'text', 'rating'])
  })

  // The stars are worth seeing without being asked for, so a block that named no columns
  // draws them.
  it('shows the rating in a block that named no columns', () => {
    expect(DEFAULT_REQ_BLOCK_FIELDS).toContain('rating')
  })

  // And a document that must not carry it — a specification going out to a supplier —
  // drops it by naming its columns.
  it('drops the rating from a block that named its columns without it', () => {
    expect(parseReqBlock('fields: id, text, status').fields).toEqual(['id', 'text', 'status'])
  })

  it('reports a key it does not know rather than ignoring it', () => {
    // A silently dropped `statut:` is an author convinced they filtered something.
    expect(parseReqBlock('statut: approuvée').unknown).toEqual(['statut'])
  })

  it('falls back to a sort it can actually do', () => {
    expect(parseReqBlock('sort: criticité').sort).toBe('id')
  })
})

describe('isEmptySpec', () => {
  it('knows an empty block asked for nothing', () => {
    expect(isEmptySpec(parseReqBlock(''))).toBe(true)
    expect(isEmptySpec(parseReqBlock('lang: en\nfields: id'))).toBe(true)
  })

  it('knows a block that asked for something', () => {
    expect(isEmptySpec(parseReqBlock('category: SYS'))).toBe(false)
    expect(isEmptySpec(parseReqBlock('REQ-SYS-0001'))).toBe(false)
  })
})

describe('selectRequirements', () => {
  const library = [
    req({ id: 'REQ-SYS-0001', title: 'Trappe', category: 'SYS', type: 'functional', status: 'approved' }),
    req({ id: 'REQ-SYS-0002', title: 'Alimentation', category: 'SYS', type: 'safety', status: 'draft' }),
    req({ id: 'REQ-ELEC-0001', title: 'Bus', category: 'ELEC', type: 'interface', status: 'approved' })
  ]

  it('quotes identifiers in the order the document wrote them', () => {
    const spec = parseReqBlock('ids: REQ-ELEC-0001, REQ-SYS-0001')
    expect(selectRequirements(spec, library).rows.map((r) => r.requirement.id)).toEqual([
      'REQ-ELEC-0001',
      'REQ-SYS-0001'
    ])
  })

  it('does not care how the identifier was cased', () => {
    expect(selectRequirements(parseReqBlock('req-sys-0001'), library).rows).toHaveLength(1)
  })

  // A requirement deleted under a document must show as a hole in the document, not as a
  // document that quietly got shorter.
  it('names an identifier the library does not hold', () => {
    const result = selectRequirements(parseReqBlock('REQ-SYS-0001, REQ-SYS-0404'), library)
    expect(result.rows.map((r) => r.requirement.id)).toEqual(['REQ-SYS-0001'])
    expect(result.missing).toEqual(['REQ-SYS-0404'])
  })

  it('narrows on a field', () => {
    expect(selectRequirements(parseReqBlock('category: SYS'), library).rows).toHaveLength(2)
  })

  it('applies two narrowings together rather than either of them', () => {
    const rows = selectRequirements(parseReqBlock('category: SYS\nstatus: approved'), library).rows
    expect(rows.map((r) => r.requirement.id)).toEqual(['REQ-SYS-0001'])
  })

  it('wants every tag asked for, not any of them', () => {
    const tagged = [req({ id: 'REQ-A-0001', tags: ['sécurité', 'vol'] }), req({ id: 'REQ-A-0002', tags: ['sécurité'] })]
    const rows = selectRequirements(parseReqBlock('tags: sécurité, vol'), tagged).rows
    expect(rows.map((r) => r.requirement.id)).toEqual(['REQ-A-0001'])
  })

  it('sorts a selection so a document regenerated twice reads the same', () => {
    const spec = parseReqBlock('category: SYS\nsort: title')
    expect(selectRequirements(spec, library).rows.map((r) => r.requirement.title)).toEqual(['Alimentation', 'Trappe'])
  })

  // The whole point of an alias: a specification written in a project's own numbering
  // resolves without the library being renumbered for it.
  it('quotes a requirement by the name the project calls it', () => {
    const aliased = [req({ id: 'REQ-SYS-0001', aliases: ['OMLX-SYS-0001'] })]
    const result = selectRequirements(parseReqBlock('OMLX-SYS-0001'), aliased)
    expect(result.rows.map((r) => r.requirement.id)).toEqual(['REQ-SYS-0001'])
  })

  it('says which name the document used, so the document can be drawn in its own words', () => {
    const aliased = [req({ id: 'REQ-SYS-0001', aliases: ['OMLX-SYS-0001'] })]
    expect(selectRequirements(parseReqBlock('omlx-sys-0001'), aliased).rows[0].citedAs).toBe('OMLX-SYS-0001')
    expect(selectRequirements(parseReqBlock('REQ-SYS-0001'), aliased).rows[0].citedAs).toBe('REQ-SYS-0001')
  })

  // A selection named nothing, so there is no alias to honour.
  it('gives a selection the library’s own numbering', () => {
    const aliased = [req({ id: 'REQ-SYS-0001', category: 'SYS', aliases: ['OMLX-SYS-0001'] })]
    expect(selectRequirements(parseReqBlock('category: SYS'), aliased).rows[0].citedAs).toBe('REQ-SYS-0001')
  })

  it('finds a requirement by its alias when searching', () => {
    const aliased = [req({ id: 'REQ-SYS-0001', aliases: ['OMLX-SYS-0001'] }), req({ id: 'REQ-ELEC-0001' })]
    expect(selectRequirements(parseReqBlock('search: OMLX'), aliased).rows.map((r) => r.requirement.id)).toEqual([
      'REQ-SYS-0001'
    ])
  })

  it('ignores a selection entirely when identifiers were named', () => {
    // Naming one and filtering at the same time is a contradiction; the names win,
    // because they are the more specific thing to have written.
    const spec: ReqBlockSpec = { ...parseReqBlock('REQ-SYS-0002'), status: 'approved' }
    expect(selectRequirements(spec, library).rows.map((r) => r.requirement.id)).toEqual(['REQ-SYS-0002'])
  })
})

describe('quotedWording', () => {
  it('quotes the language asked for', () => {
    const requirement = setText(setText(req(), 'fr', 'Source.', 'a'), 'en', 'English.', 'a')
    expect(quotedWording(requirement, 'en')).toMatchObject({ lang: 'en', body: 'English.', fallback: false })
  })

  it('quotes the source language when the block named none', () => {
    const requirement = setText(req(), 'fr', 'Source.', 'a')
    expect(quotedWording(requirement, '')).toMatchObject({ lang: 'fr', body: 'Source.' })
  })

  // Standing in silently would leave a reader thinking the translation exists.
  it('says when it is standing in for a translation that was never written', () => {
    const requirement = setText(req(), 'fr', 'Source.', 'a')
    expect(quotedWording(requirement, 'en')).toMatchObject({ lang: 'fr', fallback: true })
  })

  it('says when the wording it is quoting has fallen behind its source', () => {
    let requirement = setText(req(), 'fr', 'Version un.', 'a')
    requirement = setText(requirement, 'en', 'Version one.', 'a')
    requirement = setText(requirement, 'fr', 'Version deux.', 'a')
    expect(quotedWording(requirement, 'en')?.stale).toBe(true)
  })

  it('says when it is quoting a machine wording nobody has read', () => {
    let requirement = setText(req(), 'fr', 'Source.', 'a')
    requirement = setText(requirement, 'en', 'Machine.', 'llm', 'machine')
    expect(quotedWording(requirement, 'en')?.unreviewed).toBe(true)
  })

  it('has nothing to quote from a requirement nobody has written yet', () => {
    expect(quotedWording(req(), 'en')).toBeNull()
  })
})
