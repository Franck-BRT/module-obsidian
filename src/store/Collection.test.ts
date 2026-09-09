import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeCollection, makeDefaultFilter, makeTask, type Collection, type Task } from '../types'
import {
  addToCollection,
  collectionMemberIds,
  collectionProjectPaths,
  collectionRoots,
  removeFromCollection
} from './Collection'
import type { TaskRef } from './VaultIndex'

function ref(id: string, over: Partial<TaskRef> = {}): TaskRef {
  return {
    id,
    path: `Projects/A/_tasks/${id}.md`,
    projectId: 'a',
    projectPath: 'Projects/A/A.md',
    title: id,
    status: 'todo',
    priority: 'medium',
    start: '',
    due: '',
    completed: '',
    dependencies: [],
    assignees: [],
    tags: [],
    archived: false,
    ...over
  }
}

function collection(over: Partial<Collection> = {}): Collection {
  return { ...makeCollection('Comité', 'Recueils/Comité.md'), ...over }
}

const STATUSES = DEFAULT_STATUSES

describe('collectionMemberIds without a rule', () => {
  it('holds exactly what was picked by hand', () => {
    const c = collection({ include: ['b', 'a'] })
    expect(collectionMemberIds(c, [ref('a'), ref('b'), ref('c')], STATUSES)).toEqual(['b', 'a'])
  })

  it('holds nothing when nothing was picked', () => {
    expect(collectionMemberIds(collection(), [ref('a')], STATUSES)).toEqual([])
  })

  it('drops an id whose task no longer exists only when the view resolves it', () => {
    // Membership is about ids; a dangling one is dropped later, by collectionRoots.
    const c = collection({ include: ['gone'] })
    expect(collectionMemberIds(c, [ref('a')], STATUSES)).toEqual(['gone'])
    expect(collectionRoots(['gone'], [{ tasks: [] }])).toEqual([])
  })
})

describe('collectionMemberIds with a rule', () => {
  const tagged = collection({ rule: { ...makeDefaultFilter(), tags: ['comite'] } })

  it('takes every task the rule matches', () => {
    const refs = [ref('a', { tags: ['comite'] }), ref('b'), ref('c', { tags: ['comite', 'x'] })]
    expect(collectionMemberIds(tagged, refs, STATUSES)).toEqual(['a', 'c'])
  })

  it('adds a hand-picked task the rule missed', () => {
    const refs = [ref('a', { tags: ['comite'] }), ref('b')]
    const c = { ...tagged, include: ['b'] }
    expect(collectionMemberIds(c, refs, STATUSES)).toEqual(['a', 'b'])
  })

  it('keeps a hand-picked task in the rule’s position when the rule also matches it', () => {
    const refs = [ref('a', { tags: ['comite'] }), ref('b', { tags: ['comite'] })]
    const c = { ...tagged, include: ['a'] }
    expect(collectionMemberIds(c, refs, STATUSES)).toEqual(['a', 'b'])
  })

  it('drops an excluded task even when the rule matches it', () => {
    const refs = [ref('a', { tags: ['comite'] }), ref('b', { tags: ['comite'] })]
    const c = { ...tagged, exclude: ['a'] }
    expect(collectionMemberIds(c, refs, STATUSES)).toEqual(['b'])
  })

  it('lets an exclusion override a hand-picked entry', () => {
    const c = collection({ include: ['a'], exclude: ['a'] })
    expect(collectionMemberIds(c, [ref('a')], STATUSES)).toEqual([])
  })

  it('leaves archived tasks out unless the rule asks for them', () => {
    const refs = [ref('a', { tags: ['comite'], archived: true })]
    expect(collectionMemberIds(tagged, refs, STATUSES)).toEqual([])
    const withArchived = { ...tagged, rule: { ...makeDefaultFilter(), tags: ['comite'], showArchived: true } }
    expect(collectionMemberIds(withArchived, refs, STATUSES)).toEqual(['a'])
  })
})

describe('collectionMemberIds sources', () => {
  const refs = [
    ref('a', { tags: ['comite'], projectPath: 'Projects/A/A.md' }),
    ref('b', { tags: ['comite'], projectPath: 'Projects/B/B.md' })
  ]
  const rule = { ...makeDefaultFilter(), tags: ['comite'] }

  it('searches every project when no source is named', () => {
    expect(collectionMemberIds(collection({ rule }), refs, STATUSES)).toEqual(['a', 'b'])
  })

  it('searches only the named projects', () => {
    const c = collection({ rule, sources: ['Projects/B/B.md'] })
    expect(collectionMemberIds(c, refs, STATUSES)).toEqual(['b'])
  })

  it('still takes a hand-picked task from outside those projects', () => {
    const c = collection({ rule, sources: ['Projects/B/B.md'], include: ['a'] })
    expect(collectionMemberIds(c, refs, STATUSES)).toEqual(['b', 'a'])
  })
})

describe('collectionRoots', () => {
  function tree(): Task[] {
    const child = makeTask({ id: 'child', title: 'Child' })
    const grandchild = makeTask({ id: 'grandchild', title: 'Grandchild' })
    child.subtasks = [grandchild]
    const parent = makeTask({ id: 'parent', title: 'Parent' })
    parent.subtasks = [child]
    const other = makeTask({ id: 'other', title: 'Other' })
    return [parent, other]
  }

  it('returns the member tasks in the order the ids give', () => {
    const roots = collectionRoots(['other', 'parent'], [{ tasks: tree() }])
    expect(roots.map((t) => t.id)).toEqual(['other', 'parent'])
  })

  it('lifts a subtask to a root when its parent is not a member', () => {
    const roots = collectionRoots(['child'], [{ tasks: tree() }])
    expect(roots.map((t) => t.id)).toEqual(['child'])
  })

  it('drops a member that sits under another member, which would show it twice', () => {
    const roots = collectionRoots(['parent', 'child'], [{ tasks: tree() }])
    expect(roots.map((t) => t.id)).toEqual(['parent'])
  })

  it('drops a member under a member further up than its own parent', () => {
    const roots = collectionRoots(['parent', 'grandchild'], [{ tasks: tree() }])
    expect(roots.map((t) => t.id)).toEqual(['parent'])
  })

  it('gathers members from several projects', () => {
    const other = [makeTask({ id: 'z', title: 'Z' })]
    const roots = collectionRoots(['z', 'other'], [{ tasks: tree() }, { tasks: other }])
    expect(roots.map((t) => t.id)).toEqual(['z', 'other'])
  })
})

describe('collectionProjectPaths', () => {
  it('names each owning project once, in member order', () => {
    const refs = [
      ref('a', { projectPath: 'Projects/A/A.md' }),
      ref('b', { projectPath: 'Projects/B/B.md' }),
      ref('c', { projectPath: 'Projects/A/A.md' })
    ]
    expect(collectionProjectPaths(['a', 'b', 'c'], refs)).toEqual(['Projects/A/A.md', 'Projects/B/B.md'])
  })

  it('ignores a task no project owns', () => {
    expect(collectionProjectPaths(['a'], [ref('a', { projectPath: null })])).toEqual([])
  })
})

describe('adding and removing by hand', () => {
  it('adds a task once', () => {
    const c = addToCollection(addToCollection(collection(), 'a'), 'a')
    expect(c.include).toEqual(['a'])
  })

  it('clears a standing exclusion, which would cancel the addition out', () => {
    const c = addToCollection(collection({ exclude: ['a'] }), 'a')
    expect(c.include).toEqual(['a'])
    expect(c.exclude).toEqual([])
  })

  it('drops a hand-picked task without recording an exclusion', () => {
    const c = removeFromCollection(collection({ include: ['a'] }), 'a', false)
    expect(c.include).toEqual([])
    expect(c.exclude).toEqual([])
  })

  it('records an exclusion when the rule would put the task straight back', () => {
    const c = removeFromCollection(collection({ include: ['a'] }), 'a', true)
    expect(c.include).toEqual([])
    expect(c.exclude).toEqual(['a'])
  })

  it('does not record the same exclusion twice', () => {
    const c = removeFromCollection(collection({ exclude: ['a'] }), 'a', true)
    expect(c.exclude).toEqual(['a'])
  })
})
