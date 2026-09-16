import type { ProjectRef, TaskRef } from './VaultIndex'

/**
 * A row in the predecessor picker: a project, a lot, or a ticket that can be ticked.
 *
 * Projects and lots are containers and carry no `taskId` — they exist to be folded, not
 * chosen. A ticket that would close a loop is kept and marked `blocked` rather than
 * dropped: a candidate that silently is not there reads as a missing task, which is
 * exactly the confusion this picker exists to end.
 */
export interface DependencyNode {
  key: string
  kind: 'project' | 'lot' | 'task'
  label: string
  /** Set on a ticket, absent on a container. */
  taskId?: string
  /** Picking it would make the plan depend on itself. */
  blocked?: boolean
  children: DependencyNode[]
}

export interface DependencyTreeInput {
  /** Every ticket that could be a predecessor, the edited one included — it is dropped here. */
  tasks: TaskRef[]
  projectOf: (path: string) => ProjectRef | null | undefined
  /** The ticket being edited. */
  taskId: string
  /** Its project, listed first: the answer is usually next door. */
  homeProject: string | null
  /** Already-chosen predecessors, which are always listed even when archived. */
  selected: string[]
  /** Whether picking this one would close a loop. */
  blocks: (candidateId: string) => boolean
  /** Name for the tickets whose project is gone. */
  looseLabel: string
}

/** Containers first, then by name: the folders to open before the loose tickets. */
const compareNodes = (a: DependencyNode, b: DependencyNode): number => {
  const rank = (node: DependencyNode) => (node.kind === 'task' ? 1 : 0)
  return rank(a) - rank(b) || a.label.localeCompare(b.label)
}

/**
 * The whole vault as something you can actually look through: one foldable group per
 * project, the lots inside it, the tickets inside those.
 *
 * Nesting follows each ticket's real parent, so the picker reads like the table it was
 * chosen from. A ticket whose parent is missing from the list — filtered out, archived,
 * or in another project — is lifted to its project's top level rather than lost with it.
 */
export function buildDependencyTree(input: DependencyTreeInput): DependencyNode[] {
  const selected = new Set(input.selected)
  const usable = input.tasks.filter((ref) => ref.id !== input.taskId && (!ref.archived || selected.has(ref.id)))
  const byId = new Map(usable.map((ref) => [ref.id, ref]))

  const nodes = new Map<string, DependencyNode>()
  for (const ref of usable) {
    nodes.set(ref.id, {
      key: ref.id,
      kind: ref.type === 'phase' ? 'lot' : 'task',
      label: ref.title,
      taskId: ref.id,
      ...(input.blocks(ref.id) ? { blocked: true } : {}),
      children: []
    })
  }

  const groups = new Map<string, DependencyNode>()
  const groupFor = (path: string | null): DependencyNode => {
    const key = path ?? ''
    let group = groups.get(key)
    if (!group) {
      group = {
        key: `project:${key}`,
        kind: 'project',
        label: path ? (input.projectOf(path)?.title ?? path) : input.looseLabel,
        children: []
      }
      groups.set(key, group)
    }
    return group
  }

  for (const ref of usable) {
    const node = nodes.get(ref.id)
    if (!node) continue
    // Only a parent that is itself in the list can hold it; anything else and the ticket
    // would vanish along with a container nobody can see.
    const parent = ref.parentId ? byId.get(ref.parentId) : undefined
    const holder = parent && parent.projectPath === ref.projectPath ? nodes.get(parent.id) : undefined
    if (holder) holder.children.push(node)
    else groupFor(ref.projectPath).children.push(node)
  }

  // A container holding nothing that can be ticked is a row that cannot be used: an empty
  // lot, or a project whose only ticket is the one being edited. They are dropped rather
  // than left to be opened onto nothing.
  const prune = (list: DependencyNode[]): DependencyNode[] => {
    const kept: DependencyNode[] = []
    for (const node of list) {
      if (node.kind === 'task') {
        kept.push(node)
        continue
      }
      const children = prune(node.children)
      if (children.length) kept.push({ ...node, children })
    }
    return kept
  }

  const sortTree = (list: DependencyNode[]): void => {
    list.sort(compareNodes)
    for (const node of list) sortTree(node.children)
  }
  const result = prune([...groups.values()])
  sortTree(result)
  result.sort((a, b) => {
    const home = `project:${input.homeProject ?? ''}`
    if (a.key === home) return -1
    if (b.key === home) return 1
    return compareNodes(a, b)
  })
  return result
}

/**
 * The tree narrowed to what the query reaches.
 *
 * A container survives for what it still holds, so typing a ticket's name leaves the
 * project and the lot around it standing — which is the only way the answer stays
 * findable once it is the single row left.
 */
export function filterDependencyTree(nodes: DependencyNode[], query: string): DependencyNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return nodes
  const walk = (list: DependencyNode[]): DependencyNode[] => {
    const kept: DependencyNode[] = []
    for (const node of list) {
      const children = walk(node.children)
      const hit = node.label.toLowerCase().includes(needle)
      // A matching container brings everything it holds, so "lot 2" opens lot 2 whole.
      if (hit) kept.push({ ...node, children: node.children })
      else if (children.length) kept.push({ ...node, children })
    }
    return kept
  }
  return walk(nodes)
}

/** How many tickets a branch offers, containers excluded. Shown beside a folded group. */
export function countPickable(node: DependencyNode): number {
  const own = node.kind === 'task' ? 1 : 0
  return node.children.reduce((total, child) => total + countPickable(child), own)
}
