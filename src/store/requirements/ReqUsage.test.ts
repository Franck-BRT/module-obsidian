import { describe, expect, it } from 'vitest'
import { makeRequirement } from './Requirement'
import { parseReqBlock } from './reqBlock'
import { resolveUsage } from './ReqUsage'

const req = (id: string, over: Parameters<typeof makeRequirement>[0] = {}) => makeRequirement({ id, ...over })

const library = [
  req('REQ-SYS-0001', { category: 'SYS', status: 'approved' }),
  req('REQ-SYS-0002', { category: 'SYS', status: 'draft' }),
  req('REQ-ELEC-0001', { category: 'ELEC', status: 'approved' })
]

describe('resolveUsage', () => {
  it('says which notes quote a requirement by name', () => {
    const usage = resolveUsage(
      [
        { path: 'Docs/Spec.md', specs: [parseReqBlock('REQ-SYS-0001')] },
        { path: 'Docs/Autre.md', specs: [parseReqBlock('REQ-SYS-0001\nREQ-SYS-0002')] }
      ],
      library
    )
    expect(usage.get('REQ-SYS-0001')).toEqual(['Docs/Autre.md', 'Docs/Spec.md'])
    expect(usage.get('REQ-SYS-0002')).toEqual(['Docs/Autre.md'])
  })

  // A block that selects by category quotes whatever is in that category now, so a
  // requirement written this morning is cited by a specification written last year.
  it('resolves a selection against the library as it stands', () => {
    const usage = resolveUsage([{ path: 'Docs/Spec.md', specs: [parseReqBlock('category: SYS')] }], library)
    expect(usage.get('REQ-SYS-0001')).toEqual(['Docs/Spec.md'])
    expect(usage.get('REQ-SYS-0002')).toEqual(['Docs/Spec.md'])
    expect(usage.has('REQ-ELEC-0001')).toBe(false)
  })

  it('counts a note once however many times it quotes the same requirement', () => {
    const usage = resolveUsage(
      [{ path: 'Docs/Spec.md', specs: [parseReqBlock('REQ-SYS-0001'), parseReqBlock('category: SYS')] }],
      library
    )
    expect(usage.get('REQ-SYS-0001')).toEqual(['Docs/Spec.md'])
  })

  it('says nothing about a requirement nobody quotes', () => {
    const usage = resolveUsage([{ path: 'Docs/Spec.md', specs: [parseReqBlock('REQ-SYS-0001')] }], library)
    expect(usage.has('REQ-ELEC-0001')).toBe(false)
  })

  it('ignores an identifier the library does not hold rather than inventing an entry', () => {
    const usage = resolveUsage([{ path: 'Docs/Spec.md', specs: [parseReqBlock('REQ-SYS-0404')] }], library)
    expect(usage.size).toBe(0)
  })

  it('reads the notes in a stable order, so the same vault reports the same list', () => {
    const notes = [
      { path: 'Z.md', specs: [parseReqBlock('REQ-SYS-0001')] },
      { path: 'A.md', specs: [parseReqBlock('REQ-SYS-0001')] }
    ]
    expect(resolveUsage(notes, library).get('REQ-SYS-0001')).toEqual(['A.md', 'Z.md'])
  })
})
