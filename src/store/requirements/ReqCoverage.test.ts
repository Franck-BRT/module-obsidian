import { describe, expect, it } from 'vitest'
import { addLink, makeRequirement, markLinksToward, setText } from './Requirement'
import { coverageOf, countGaps, type Coverage } from './ReqCoverage'

const LANGS = ['fr', 'en']

function written(id: string, over: Parameters<typeof makeRequirement>[0] = {}) {
  return setText(makeRequirement({ id, sourceLang: 'fr', ...over }), 'fr', `Énoncé de ${id}.`, 'a')
}

function rowFor(rows: Coverage[], id: string): Coverage {
  const found = rows.find((row) => row.requirement.id === id)
  if (!found) throw new Error(`no coverage row for ${id}`)
  return found
}

describe('coverageOf', () => {
  it('reports a requirement nothing at all is tied to', () => {
    const rows = coverageOf({ library: [written('REQ-A-0001')], usage: new Map(), languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0001').gaps).toEqual(['uncited', 'unsatisfied', 'unverified'])
  })

  it('stops calling it uncited once a document quotes it', () => {
    const usage = new Map([['REQ-A-0001', ['Docs/Spec.md']]])
    const rows = coverageOf({ library: [written('REQ-A-0001')], usage, languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0001').citedIn).toEqual(['Docs/Spec.md'])
    expect(rowFor(rows, 'REQ-A-0001').gaps).not.toContain('uncited')
  })

  it('stops calling it unsatisfied once something claims to implement it', () => {
    const library = [addLink(written('REQ-A-0001'), 'satisfied-by', 'task-42')]
    const rows = coverageOf({ library, usage: new Map(), languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0001').satisfiedBy).toEqual(['task-42'])
    expect(rowFor(rows, 'REQ-A-0001').gaps).not.toContain('unsatisfied')
  })

  // A high-level requirement is implemented by the ones beneath it. Calling every parent
  // in a tree uncovered would bury the leaves that genuinely are.
  it('does not call a requirement unsatisfied when others derive from it', () => {
    const parent = written('REQ-A-0001')
    const child = addLink(written('REQ-A-0002'), 'derives-from', 'REQ-A-0001')
    const rows = coverageOf({ library: [parent, child], usage: new Map(), languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0001').derivedBy).toEqual(['REQ-A-0002'])
    expect(rowFor(rows, 'REQ-A-0001').gaps).not.toContain('unsatisfied')
    expect(rowFor(rows, 'REQ-A-0002').gaps).toContain('unsatisfied')
  })

  it('counts a refinement as standing beneath, like a derivation', () => {
    const library = [written('REQ-A-0001'), addLink(written('REQ-A-0002'), 'refines', 'REQ-A-0001')]
    const rows = coverageOf({ library, usage: new Map(), languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0001').derivedBy).toEqual(['REQ-A-0002'])
  })

  it('does not count a contradiction as an implementation', () => {
    const library = [written('REQ-A-0001'), addLink(written('REQ-A-0002'), 'conflicts-with', 'REQ-A-0001')]
    const rows = coverageOf({ library, usage: new Map(), languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0001').derivedBy).toEqual([])
    expect(rowFor(rows, 'REQ-A-0001').gaps).toContain('unsatisfied')
  })

  it('reports a requirement with nothing written in it', () => {
    const rows = coverageOf({ library: [makeRequirement({ id: 'REQ-A-0001' })], usage: new Map(), languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0001').gaps).toContain('unwritten')
  })

  it('does not call it unwritten when it has its source wording', () => {
    const rows = coverageOf({ library: [written('REQ-A-0001')], usage: new Map(), languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0001').gaps).not.toContain('unwritten')
  })

  it('reports a link the far end moved under', () => {
    const library = [markLinksToward(addLink(written('REQ-A-0002'), 'derives-from', 'REQ-A-0001'), 'REQ-A-0001')]
    const rows = coverageOf({ library, usage: new Map(), languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0002').gaps).toContain('suspect')
  })

  it('stops calling it unverified once a method is set', () => {
    const library = [written('REQ-A-0001', { verification: 'test' })]
    const rows = coverageOf({ library, usage: new Map(), languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0001').gaps).not.toContain('unverified')
  })

  it('matches a link written in another case', () => {
    const library = [written('REQ-A-0001'), addLink(written('REQ-A-0002'), 'derives-from', 'req-a-0001')]
    const rows = coverageOf({ library, usage: new Map(), languages: LANGS })
    expect(rowFor(rows, 'REQ-A-0001').derivedBy).toEqual(['REQ-A-0002'])
  })
})

describe('countGaps', () => {
  it('counts each requirement at each of its gaps', () => {
    const rows = coverageOf({
      library: [written('REQ-A-0001'), written('REQ-A-0002', { verification: 'test' })],
      usage: new Map([['REQ-A-0002', ['Docs/Spec.md']]]),
      languages: LANGS
    })
    expect(countGaps(rows)).toEqual({ uncited: 1, unsatisfied: 2, unverified: 1, suspect: 0, unwritten: 0 })
  })
})
