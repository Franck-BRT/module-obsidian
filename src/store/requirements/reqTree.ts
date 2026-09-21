import type { Requirement } from './Requirement'

/**
 * The library as a tree of derivations.
 *
 * A requirements library has a shape, and it is the shape nobody can see one requirement
 * at a time: a customer requirement breaking into system requirements, those breaking
 * into subsystem ones, and somewhere near the bottom a leaf nothing derives from that
 * ought to have had three children. Laying it out is how that gets noticed.
 *
 * Three things go wrong here, and all three go wrong quietly. A requirement can derive
 * from two parents, so it belongs in two places at once. Links can close a loop, so a
 * naive walk never returns. And a parent can point at a requirement that is not in the
 * library, so a whole branch would vanish with nothing said. Each is handled and each is
 * reported — a tree that silently drops a requirement is worse than no tree.
 */

/** The relations that mean "this requirement stands beneath that one". */
const PARENT_KINDS = new Set(['derives-from', 'refines'])

export interface ReqTreeNode {
  requirement: Requirement
  children: ReqTreeNode[]
  depth: number
  /** This requirement also hangs under another parent: the same one, not a copy. */
  repeated: boolean
  /** Expanding here would lead back to an ancestor, so the walk stopped. */
  cyclic: boolean
}

export interface ReqForest {
  roots: ReqTreeNode[]
  /** No parent and nothing derived from it — nothing a tree can say about it. */
  isolated: Requirement[]
  /** A parent link pointing at something the library does not hold. */
  dangling: { id: string; parent: string }[]
  /** Requirements only reachable through a loop, promoted so they are not lost. */
  cycles: string[]
}

function parentsOf(requirement: Requirement): string[] {
  return requirement.links.filter((link) => PARENT_KINDS.has(link.kind)).map((link) => link.to.toUpperCase())
}

/**
 * The forest, with everything that can go wrong named rather than swallowed.
 *
 * A requirement with two parents is built under both. It is not copied — it is the same
 * requirement in two places, which is what the link says — and it is marked so the reader
 * can tell that from a library holding it twice.
 */
export function buildReqForest(library: Requirement[]): ReqForest {
  const byId = new Map(library.map((requirement) => [requirement.id.toUpperCase(), requirement]))
  const childrenOf = new Map<string, string[]>()
  const parentCount = new Map<string, number>()
  const dangling: { id: string; parent: string }[] = []

  for (const requirement of library) {
    const key = requirement.id.toUpperCase()
    for (const parent of parentsOf(requirement)) {
      if (!byId.has(parent)) {
        // Named rather than dropped: a branch that disappears because its parent was
        // deleted looks exactly like a branch that was never written.
        dangling.push({ id: requirement.id, parent })
        continue
      }
      const siblings = childrenOf.get(parent)
      if (siblings) siblings.push(key)
      else childrenOf.set(parent, [key])
      parentCount.set(key, (parentCount.get(key) ?? 0) + 1)
    }
  }

  const sortKey = (key: string): string => byId.get(key)?.id ?? key
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true }))
  }

  const rootKeys = library
    .map((requirement) => requirement.id.toUpperCase())
    .filter((key) => (parentCount.get(key) ?? 0) === 0)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true }))

  const build = (key: string, depth: number, path: Set<string>): ReqTreeNode => {
    const requirement = byId.get(key) as Requirement
    const node: ReqTreeNode = {
      requirement,
      children: [],
      depth,
      repeated: (parentCount.get(key) ?? 0) > 1,
      cyclic: false
    }
    if (path.has(key)) {
      node.cyclic = true
      return node
    }
    const next = new Set(path).add(key)
    node.children = (childrenOf.get(key) ?? []).map((child) => build(child, depth + 1, next))
    return node
  }

  const placed = new Set<string>()
  const mark = (node: ReqTreeNode): void => {
    placed.add(node.requirement.id.toUpperCase())
    for (const child of node.children) mark(child)
  }

  const roots: ReqTreeNode[] = []
  for (const key of rootKeys) {
    const node = build(key, 0, new Set())
    mark(node)
    roots.push(node)
  }

  // Anything left is only reachable through a loop, so it has no root of its own. The
  // lowest identifier of each such knot is promoted: the alternative is a requirement
  // that exists, is linked, and appears nowhere at all.
  const cycles: string[] = []
  for (const requirement of library) {
    const key = requirement.id.toUpperCase()
    if (placed.has(key)) continue
    const node = build(key, 0, new Set())
    mark(node)
    roots.push(node)
    cycles.push(requirement.id)
  }

  const isolated = library.filter((requirement) => {
    const key = requirement.id.toUpperCase()
    return (parentCount.get(key) ?? 0) === 0 && (childrenOf.get(key) ?? []).length === 0
  })
  const isolatedKeys = new Set(isolated.map((requirement) => requirement.id.toUpperCase()))

  return {
    // A requirement with no links at all is not a tree of one; it goes in its own list,
    // or a library that has barely been linked draws a thousand stumps.
    roots: roots.filter((node) => !isolatedKeys.has(node.requirement.id.toUpperCase())),
    isolated,
    dangling,
    cycles
  }
}

export interface FlatReqRow {
  node: ReqTreeNode
  /** One entry per indent column; true carries an ancestor's line past this row. */
  guides: boolean[]
  lastChild: boolean
  /** Whether this row has children at all, drawn or not. */
  hasChildren: boolean
}

/**
 * The forest as rows, with the collapsed branches left out.
 *
 * Flattened here rather than in the view because "which rows are on screen" is the part
 * that can be wrong in a way nobody notices: a branch that vanishes when its parent is
 * collapsed and does not come back is a requirement lost behind a triangle.
 */
export function flattenForest(roots: ReqTreeNode[], collapsed: ReadonlySet<string> = new Set()): FlatReqRow[] {
  const rows: FlatReqRow[] = []
  const walk = (node: ReqTreeNode, guides: boolean[], lastChild: boolean): void => {
    const hasChildren = node.children.length > 0
    rows.push({ node, guides, lastChild, hasChildren })
    if (!hasChildren || collapsed.has(node.requirement.id)) return
    const childGuides = guides.length ? [...guides.slice(0, -1), !lastChild, false] : [false]
    node.children.forEach((child, index) => {
      walk(child, childGuides, index === node.children.length - 1)
    })
  }
  roots.forEach((root, index) => {
    walk(root, [], index === roots.length - 1)
  })
  return rows
}

/**
 * The branches holding something that matched, with their ancestors kept for context.
 *
 * Searching a tree and being shown only the matches is being shown a list; what makes a
 * tree worth searching is seeing where the match sits. So a node survives if it matched
 * or if anything beneath it did, and the ones that actually matched are named so the view
 * can say which is which.
 */
export function pruneForest(roots: ReqTreeNode[], matched: ReadonlySet<string>): ReqTreeNode[] {
  const keep = (node: ReqTreeNode): ReqTreeNode | null => {
    const children = node.children.map((child) => keep(child)).filter((child): child is ReqTreeNode => child !== null)
    if (children.length === 0 && !matched.has(node.requirement.id)) return null
    return { ...node, children }
  }
  return roots.map((root) => keep(root)).filter((root): root is ReqTreeNode => root !== null)
}

/** How deep the forest runs, which is the one number that says whether it has a shape. */
export function forestDepth(roots: ReqTreeNode[]): number {
  let deepest = 0
  const walk = (node: ReqTreeNode): void => {
    deepest = Math.max(deepest, node.depth + 1)
    for (const child of node.children) walk(child)
  }
  for (const root of roots) walk(root)
  return deepest
}
