import { describe, expect, it } from 'vitest'
import type { ProjectRef, TaskRef } from './VaultIndex'
import { buildDependencyTree, countPickable, filterDependencyTree, type DependencyNode } from './DependencyTree'

const ref = (id: string, over: Partial<TaskRef> = {}): TaskRef => ({
  id,
  path: `Projects/A/_tasks/${id}.md`,
  projectId: 'a',
  projectPath: 'Projects/A/A.md',
  title: id,
  type: 'task',
  parentId: null,
  status: 'todo',
  priority: 'medium',
  start: '',
  due: '',
  completed: '',
  dependencies: [],
  assignees: [],
  tags: [],
  zones: [],
  archived: false,
  ...over
})

const titles: Record<string, string> = {
  'Projects/A/A.md': 'COSMA',
  'Projects/B/B.md': 'Autre'
}

const build = (tasks: TaskRef[], over: Partial<Parameters<typeof buildDependencyTree>[0]> = {}) =>
  buildDependencyTree({
    tasks,
    projectOf: (path) => ({ title: titles[path] }) as ProjectRef,
    taskId: 'me',
    homeProject: 'Projects/A/A.md',
    selected: [],
    blocks: () => false,
    looseLabel: 'Sans projet',
    ...over
  })

const shape = (nodes: DependencyNode[]): unknown =>
  nodes.map((node) => (node.children.length ? { [node.label]: shape(node.children) } : node.label))

describe('the tree a predecessor is chosen from', () => {
  it('puts every ticket under its project', () => {
    const tree = build([ref('a'), ref('b', { projectPath: 'Projects/B/B.md' })])
    expect(shape(tree)).toEqual([{ COSMA: ['a'] }, { Autre: ['b'] }])
  })

  it('nests a ticket inside the lot that holds it, lots before loose tickets', () => {
    const tree = build([ref('lot', { type: 'phase' }), ref('a', { parentId: 'lot' }), ref('b')])
    expect(shape(tree)).toEqual([{ COSMA: [{ lot: ['a'] }, 'b'] }])
  })

  it('leads with the project being edited, whatever the alphabet says', () => {
    const tree = build([ref('b', { projectPath: 'Projects/B/B.md' }), ref('a')], {
      homeProject: 'Projects/A/A.md'
    })
    expect(tree[0]?.label).toBe('COSMA')
  })

  it('never offers the ticket being edited as its own predecessor', () => {
    const tree = build([ref('me'), ref('a')])
    expect(shape(tree)).toEqual([{ COSMA: ['a'] }])
  })

  it('marks what would close a loop instead of hiding it', () => {
    // A candidate that is simply absent reads as a task that has gone missing.
    const tree = build([ref('a'), ref('b')], { blocks: (id) => id === 'b' })
    const tasks = tree[0]?.children ?? []
    expect(tasks.find((node) => node.label === 'b')?.blocked).toBe(true)
    expect(tasks.find((node) => node.label === 'a')?.blocked).toBeUndefined()
  })

  it('leaves archived tickets out, unless one is already chosen', () => {
    const tasks = [ref('a'), ref('old', { archived: true }), ref('kept', { archived: true })]
    expect(shape(build(tasks))).toEqual([{ COSMA: ['a'] }])
    expect(shape(build(tasks, { selected: ['kept'] }))).toEqual([{ COSMA: ['a', 'kept'] }])
  })

  it('lifts a ticket whose lot is not in the list rather than losing it with the lot', () => {
    const tree = build([ref('a', { parentId: 'lot-gone' })])
    expect(shape(tree)).toEqual([{ COSMA: ['a'] }])
  })

  it('does not put a ticket under a parent in another project', () => {
    const tree = build([
      ref('lot', { type: 'phase' }),
      ref('here', { parentId: 'lot' }),
      ref('a', { parentId: 'lot', projectPath: 'Projects/B/B.md' })
    ])
    // The lot keeps the ticket that is really in it, and the far one stays where it lives.
    expect(shape(tree)).toEqual([{ COSMA: [{ lot: ['here'] }] }, { Autre: ['a'] }])
  })

  it('gathers tickets whose project is gone under a name of their own', () => {
    const tree = build([ref('orphan', { projectPath: null })])
    expect(shape(tree)).toEqual([{ 'Sans projet': ['orphan'] }])
  })
})

describe('searching that tree', () => {
  const tasks = [ref('lot', { type: 'phase' }), ref('consignation', { parentId: 'lot' }), ref('recalcul')]

  it('keeps the project and the lot around a match, so it stays findable', () => {
    expect(shape(filterDependencyTree(build(tasks), 'consig'))).toEqual([{ COSMA: [{ lot: ['consignation'] }] }])
  })

  it('brings everything a matching lot holds', () => {
    expect(shape(filterDependencyTree(build(tasks), 'lot'))).toEqual([{ COSMA: [{ lot: ['consignation'] }] }])
  })

  it('returns nothing when nothing matches, rather than everything', () => {
    expect(filterDependencyTree(build(tasks), 'zzz')).toEqual([])
  })

  it('is left alone by an empty query', () => {
    expect(filterDependencyTree(build(tasks), '   ')).toHaveLength(1)
  })
})

describe('what a folded group says it holds', () => {
  it('counts tickets at any depth and never the containers', () => {
    const tree = build([ref('lot', { type: 'phase' }), ref('a', { parentId: 'lot' }), ref('b')])
    expect(countPickable(tree[0])).toBe(2)
  })
})

describe('containers with nothing to offer', () => {
  it('drops an empty lot rather than showing a row that opens onto nothing', () => {
    const tree = build([ref('lot', { type: 'phase' }), ref('a')])
    expect(shape(tree)).toEqual([{ COSMA: ['a'] }])
  })

  it('drops a project whose only ticket was the one being edited', () => {
    const tree = build([ref('a'), ref('me', { projectPath: 'Projects/B/B.md' })])
    expect(shape(tree)).toEqual([{ COSMA: ['a'] }])
  })

  it('keeps a lot that still holds something, at any depth', () => {
    const tree = build([
      ref('lot', { type: 'phase' }),
      ref('inner', { type: 'phase', parentId: 'lot' }),
      ref('deep', { parentId: 'inner' })
    ])
    expect(shape(tree)).toEqual([{ COSMA: [{ lot: [{ inner: ['deep'] }] }] }])
  })
})
