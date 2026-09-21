import { describe, expect, it } from 'vitest'
import { addLink, makeRequirement } from './Requirement'
import { branchIds, buildReqForest, flattenForest, forestDepth, pruneForest, type ReqTreeNode } from './reqTree'

const req = (id: string) => makeRequirement({ id, sourceLang: 'fr' })
const under = (id: string, parent: string) => addLink(req(id), 'derives-from', parent)

function ids(nodes: ReqTreeNode[]): string[] {
  return nodes.map((node) => node.requirement.id)
}

describe('buildReqForest', () => {
  it('hangs a requirement under the one it derives from', () => {
    const forest = buildReqForest([req('REQ-A-0001'), under('REQ-A-0002', 'REQ-A-0001')])
    expect(ids(forest.roots)).toEqual(['REQ-A-0001'])
    expect(ids(forest.roots[0].children)).toEqual(['REQ-A-0002'])
  })

  it('counts a refinement as standing beneath, like a derivation', () => {
    const forest = buildReqForest([req('REQ-A-0001'), addLink(req('REQ-A-0002'), 'refines', 'REQ-A-0001')])
    expect(ids(forest.roots[0].children)).toEqual(['REQ-A-0002'])
  })

  it('does not hang a requirement under one it merely contradicts', () => {
    const forest = buildReqForest([req('REQ-A-0001'), addLink(req('REQ-A-0002'), 'conflicts-with', 'REQ-A-0001')])
    expect(ids(forest.roots)).toEqual([])
    expect(forest.isolated.map((r) => r.id)).toEqual(['REQ-A-0001', 'REQ-A-0002'])
  })

  it('builds three levels', () => {
    const forest = buildReqForest([
      req('REQ-A-0001'),
      under('REQ-A-0002', 'REQ-A-0001'),
      under('REQ-A-0003', 'REQ-A-0002')
    ])
    expect(forestDepth(forest.roots)).toBe(3)
    expect(forest.roots[0].children[0].children[0].requirement.id).toBe('REQ-A-0003')
  })

  it('sorts the children, so the tree reads the same twice', () => {
    const forest = buildReqForest([
      req('REQ-A-0001'),
      under('REQ-A-0010', 'REQ-A-0001'),
      under('REQ-A-0009', 'REQ-A-0001')
    ])
    expect(ids(forest.roots[0].children)).toEqual(['REQ-A-0009', 'REQ-A-0010'])
  })

  // The same requirement in two places, which is what the link says — not a copy.
  it('hangs a requirement with two parents under both, and marks it', () => {
    const child = addLink(under('REQ-A-0003', 'REQ-A-0001'), 'derives-from', 'REQ-A-0002')
    const forest = buildReqForest([req('REQ-A-0001'), req('REQ-A-0002'), child])
    expect(ids(forest.roots)).toEqual(['REQ-A-0001', 'REQ-A-0002'])
    expect(ids(forest.roots[0].children)).toEqual(['REQ-A-0003'])
    expect(ids(forest.roots[1].children)).toEqual(['REQ-A-0003'])
    expect(forest.roots[0].children[0].repeated).toBe(true)
  })

  it('does not mark a requirement with one parent as repeated', () => {
    const forest = buildReqForest([req('REQ-A-0001'), under('REQ-A-0002', 'REQ-A-0001')])
    expect(forest.roots[0].children[0].repeated).toBe(false)
  })

  it('cuts a loop rather than walking it forever', () => {
    const a = addLink(req('REQ-A-0001'), 'derives-from', 'REQ-A-0002')
    const b = addLink(req('REQ-A-0002'), 'derives-from', 'REQ-A-0001')
    const forest = buildReqForest([a, b])
    expect(forest.cycles).toEqual(['REQ-A-0001'])
    expect(forestDepth(forest.roots)).toBeLessThan(5)
  })

  // A requirement that exists, is linked, and appears nowhere at all is the one outcome
  // a tree must never produce.
  it('shows every requirement of a loop somewhere', () => {
    const a = addLink(req('REQ-A-0001'), 'derives-from', 'REQ-A-0002')
    const b = addLink(req('REQ-A-0002'), 'derives-from', 'REQ-A-0001')
    const shown = new Set(flattenForest(buildReqForest([a, b]).roots).map((row) => row.node.requirement.id))
    expect([...shown].sort()).toEqual(['REQ-A-0001', 'REQ-A-0002'])
  })

  it('marks the row where the walk stopped, rather than stopping silently', () => {
    const a = addLink(req('REQ-A-0001'), 'derives-from', 'REQ-A-0002')
    const b = addLink(req('REQ-A-0002'), 'derives-from', 'REQ-A-0001')
    const rows = flattenForest(buildReqForest([a, b]).roots)
    expect(rows.some((row) => row.node.cyclic)).toBe(true)
  })

  // A branch that vanishes because its parent was deleted looks exactly like a branch
  // that was never written.
  it('names a parent the library does not hold, and keeps the child as a root', () => {
    const forest = buildReqForest([under('REQ-A-0002', 'REQ-B-0001')])
    expect(forest.dangling).toEqual([{ id: 'REQ-A-0002', parent: 'REQ-B-0001' }])
    expect(forest.isolated.map((r) => r.id)).toEqual(['REQ-A-0002'])
  })

  it('keeps a requirement with no links out of the trees', () => {
    const forest = buildReqForest([req('REQ-A-0001'), req('REQ-A-0002'), under('REQ-A-0003', 'REQ-A-0001')])
    expect(ids(forest.roots)).toEqual(['REQ-A-0001'])
    expect(forest.isolated.map((r) => r.id)).toEqual(['REQ-A-0002'])
  })

  it('matches a parent written in another case', () => {
    const forest = buildReqForest([req('REQ-A-0001'), addLink(req('REQ-A-0002'), 'derives-from', 'req-a-0001')])
    expect(ids(forest.roots[0].children)).toEqual(['REQ-A-0002'])
  })
})

describe('flattenForest', () => {
  const forest = buildReqForest([
    req('REQ-A-0001'),
    under('REQ-A-0002', 'REQ-A-0001'),
    under('REQ-A-0003', 'REQ-A-0002'),
    under('REQ-A-0004', 'REQ-A-0001')
  ])

  it('lays the tree out in reading order', () => {
    expect(flattenForest(forest.roots).map((row) => row.node.requirement.id)).toEqual([
      'REQ-A-0001',
      'REQ-A-0002',
      'REQ-A-0003',
      'REQ-A-0004'
    ])
  })

  it('leaves out what a collapsed branch holds, and keeps the branch itself', () => {
    const rows = flattenForest(forest.roots, new Set(['REQ-A-0002']))
    expect(rows.map((row) => row.node.requirement.id)).toEqual(['REQ-A-0001', 'REQ-A-0002', 'REQ-A-0004'])
    expect(rows[1].hasChildren).toBe(true)
  })

  it('says which row is the last of its siblings, for the elbow', () => {
    const rows = flattenForest(forest.roots)
    expect(rows.map((row) => row.lastChild)).toEqual([true, false, true, true])
  })

  it('deepens the guides with the branch', () => {
    const rows = flattenForest(forest.roots)
    expect(rows[0].guides).toEqual([])
    expect(rows[1].guides).toEqual([false])
    expect(rows[2].guides).toEqual([true, false])
  })
})

describe('branchIds', () => {
  it('names every branch, and nothing that is a leaf', () => {
    const forest = buildReqForest([
      req('REQ-A-0001'),
      under('REQ-A-0002', 'REQ-A-0001'),
      under('REQ-A-0003', 'REQ-A-0002')
    ])
    expect(branchIds(forest.roots)).toEqual(['REQ-A-0001', 'REQ-A-0002'])
  })

  // Folding it folds both, so counting it twice would report a number larger than the
  // tree has.
  it('names a requirement hanging under two parents once', () => {
    const shared = addLink(under('REQ-A-0003', 'REQ-A-0001'), 'derives-from', 'REQ-A-0002')
    const forest = buildReqForest([req('REQ-A-0001'), req('REQ-A-0002'), shared, under('REQ-A-0004', 'REQ-A-0003')])
    expect(branchIds(forest.roots).filter((id) => id === 'REQ-A-0003')).toHaveLength(1)
  })

  it('names nothing in a forest with no branches', () => {
    expect(branchIds(buildReqForest([req('REQ-A-0001')]).roots)).toEqual([])
  })

  it('names each requirement of a loop once, however many times the walk met it', () => {
    const a = addLink(req('REQ-A-0001'), 'derives-from', 'REQ-A-0002')
    const b = addLink(req('REQ-A-0002'), 'derives-from', 'REQ-A-0001')
    expect(branchIds(buildReqForest([a, b]).roots)).toEqual(['REQ-A-0001', 'REQ-A-0002'])
  })
})

describe('pruneForest', () => {
  const forest = buildReqForest([
    req('REQ-A-0001'),
    under('REQ-A-0002', 'REQ-A-0001'),
    under('REQ-A-0003', 'REQ-A-0002'),
    req('REQ-B-0001'),
    under('REQ-B-0002', 'REQ-B-0001')
  ])

  // Being shown only the matches is being shown a list; what makes a tree worth searching
  // is seeing where the match sits.
  it('keeps the ancestors of a match, for the context that is the point', () => {
    const kept = pruneForest(forest.roots, new Set(['REQ-A-0003']))
    expect(ids(kept)).toEqual(['REQ-A-0001'])
    expect(kept[0].children[0].children[0].requirement.id).toBe('REQ-A-0003')
  })

  it('drops a branch holding nothing that matched', () => {
    expect(ids(pruneForest(forest.roots, new Set(['REQ-B-0002'])))).toEqual(['REQ-B-0001'])
  })

  it('keeps a matching root even where nothing beneath it matched', () => {
    const kept = pruneForest(forest.roots, new Set(['REQ-A-0001']))
    expect(ids(kept)).toEqual(['REQ-A-0001'])
    expect(kept[0].children).toEqual([])
  })

  it('keeps nothing when nothing matched', () => {
    expect(pruneForest(forest.roots, new Set())).toEqual([])
  })

  it('leaves the forest it was given alone', () => {
    pruneForest(forest.roots, new Set(['REQ-A-0001']))
    expect(forest.roots[0].children).toHaveLength(1)
  })
})
