import type { Collection, StatusConfig, Task } from '../types'

import { matchesFilter } from './TaskFilter'
import { flattenTasks } from './TaskTreeOps'
import type { TaskRef } from './VaultIndex'

/**
 * What decides membership, and nothing else. Both the stored collection and the
 * index's lighter entry satisfy it, so working out members never forces a note read.
 */
export type CollectionMembership = Pick<Collection, 'sources' | 'rule' | 'include' | 'exclude'>

/**
 * The task ids a collection holds, in a stable order: whatever the rule matched first,
 * then the hand-picked entries the rule missed, with the excluded ones removed
 * throughout.
 *
 * Manual entries win over the rule's sources: a task added by hand belongs even when it
 * lives in a project the rule never looks at. That is the point of being able to
 * correct a rule rather than abandon it.
 */
export function collectionMemberIds(
  collection: CollectionMembership,
  refs: TaskRef[],
  statuses: StatusConfig[] = []
): string[] {
  const excluded = new Set(collection.exclude)
  const ordered: string[] = []
  const seen = new Set<string>()
  const take = (id: string): void => {
    if (excluded.has(id) || seen.has(id)) return
    seen.add(id)
    ordered.push(id)
  }

  if (collection.rule) {
    const sources = new Set(collection.sources)
    for (const ref of refs) {
      if (sources.size && (!ref.projectPath || !sources.has(ref.projectPath))) continue
      if (matchesFilter(ref, collection.rule, statuses)) take(ref.id)
    }
  }
  // After the rule, so a hand-picked task keeps its place if the rule already found it.
  for (const id of collection.include) take(id)
  return ordered
}

/**
 * The member tasks as roots for a view, drawn from the projects that own them.
 *
 * A member that sits under another member is dropped: the views render subtasks
 * beneath their parent, so keeping both would show it twice. Order follows the ids.
 */
export function collectionRoots(memberIds: string[], projects: { tasks: Task[] }[]): Task[] {
  const byId = new Map<string, Task>()
  const parentOf = new Map<string, string | null>()
  for (const project of projects) {
    for (const { task, parentId } of flattenTasks(project.tasks)) {
      byId.set(task.id, task)
      parentOf.set(task.id, parentId)
    }
  }

  const members = new Set(memberIds)
  const hasMemberAncestor = (id: string): boolean => {
    for (let at = parentOf.get(id) ?? null; at; at = parentOf.get(at) ?? null) {
      if (members.has(at)) return true
    }
    return false
  }

  const roots: Task[] = []
  for (const id of memberIds) {
    const task = byId.get(id)
    if (!task) continue
    if (hasMemberAncestor(id)) continue
    roots.push(task)
  }
  return roots
}

/** The projects a collection's members live in, so a view knows what to load. */
export function collectionProjectPaths(memberIds: string[], refs: TaskRef[]): string[] {
  const wanted = new Set(memberIds)
  const paths: string[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (!wanted.has(ref.id) || !ref.projectPath || seen.has(ref.projectPath)) continue
    seen.add(ref.projectPath)
    paths.push(ref.projectPath)
  }
  return paths
}

/** Adding a task by hand also clears any standing exclusion, which would cancel it out. */
export function addToCollection(collection: Collection, taskId: string): Collection {
  return {
    ...collection,
    include: collection.include.includes(taskId) ? collection.include : [...collection.include, taskId],
    exclude: collection.exclude.filter((id) => id !== taskId)
  }
}

/**
 * Removing drops the manual entry and, when a rule would put the task straight back,
 * records an exclusion. Without that, removing a rule-matched task would do nothing
 * visible.
 */
export function removeFromCollection(collection: Collection, taskId: string, matchedByRule: boolean): Collection {
  return {
    ...collection,
    include: collection.include.filter((id) => id !== taskId),
    exclude:
      matchedByRule && !collection.exclude.includes(taskId) ? [...collection.exclude, taskId] : collection.exclude
  }
}

/** A project heading in a collection view, with the member tasks that sit under it. */
export interface CollectionGroup<T> {
  projectPath: string
  rows: T[]
}

/**
 * Splits a collection's rows into one block per owning project, in the order the
 * projects first appear. Rows whose project cannot be resolved come last under an
 * empty path, so a task never silently vanishes because its project moved.
 */
export function groupRowsByProject<T>(rows: T[], projectPathOf: (row: T) => string | null): CollectionGroup<T>[] {
  const byPath = new Map<string, T[]>()
  for (const row of rows) {
    const path = projectPathOf(row) ?? ''
    const bucket = byPath.get(path)
    if (bucket) bucket.push(row)
    else byPath.set(path, [row])
  }
  const groups = [...byPath].map(([projectPath, groupRows]) => ({ projectPath, rows: groupRows }))
  // Unowned rows are an anomaly worth seeing, but not worth leading with.
  return groups.sort((a, b) => (a.projectPath === '' ? 1 : b.projectPath === '' ? -1 : 0))
}
