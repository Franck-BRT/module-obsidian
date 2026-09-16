import type { Task } from '../types'
import { makeId } from '../types'
import { dedupePeople } from '../utils'

export interface FlatTask {
  task: Task
  depth: number
  parentId: string | null
  visible: boolean
}

export function flattenTasks(
  tasks: Task[],
  depth = 0,
  parentId: string | null = null,
  ancestorCollapsed = false
): FlatTask[] {
  const result: FlatTask[] = []
  for (const task of tasks) {
    const visible = !ancestorCollapsed
    result.push({ task, depth, parentId, visible })
    if (task.subtasks.length > 0) {
      result.push(...flattenTasks(task.subtasks, depth + 1, task.id, ancestorCollapsed || task.collapsed))
    }
  }
  return result
}

export function findTask(tasks: Task[], id: string): Task | null {
  for (const t of tasks) {
    if (t.id === id) return t
    const found = findTask(t.subtasks, id)
    if (found) return found
  }
  return null
}

export function updateTaskInTree(tasks: Task[], id: string, patch: Partial<Task>): boolean {
  for (const t of tasks) {
    if (t.id === id) {
      Object.assign(t, patch, { updatedAt: new Date().toISOString() })
      return true
    }
    if (updateTaskInTree(t.subtasks, id, patch)) return true
  }
  return false
}

export function deleteTaskFromTree(tasks: Task[], id: string): boolean {
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].id === id) {
      tasks.splice(i, 1)
      return true
    }
    if (deleteTaskFromTree(tasks[i].subtasks, id)) return true
  }
  return false
}

export function addTaskToTree(tasks: Task[], newTask: Task, parentId: string | null): void {
  if (!parentId) {
    tasks.push(newTask)
    return
  }
  const parent = findTask(tasks, parentId)
  if (parent) parent.subtasks.push(newTask)
  else tasks.push(newTask)
}

/**
 * Deep-clone a subtree with fresh ids, timestamps, and no file paths. Dependencies
 * within the cloned subtree are remapped to the new ids; ones pointing outside it
 * (and all of them when includeSubtasks is false) still target the originals.
 */
export function cloneTaskSubtree(source: Task, includeSubtasks: boolean): Task {
  const idMap = new Map<string, string>()
  const clone = cloneNode(source, includeSubtasks, idMap)
  if (includeSubtasks) remapDeps(clone, idMap)
  return clone
}

/**
 * Deep-clone a whole task forest with fresh ids, sharing one id map so a dependency
 * between any two tasks in it is remapped, whichever roots they sit under. Dependencies
 * pointing outside the forest still target the originals.
 */
export function cloneTaskForest(roots: Task[]): Task[] {
  const idMap = new Map<string, string>()
  const clones = roots.map((root) => cloneNode(root, true, idMap))
  for (const clone of clones) remapDeps(clone, idMap)
  return clones
}

function cloneNode(source: Task, includeSubtasks: boolean, idMap: Map<string, string>): Task {
  const now = new Date().toISOString()
  const newId = makeId()
  idMap.set(source.id, newId)
  return {
    ...source,
    id: newId,
    filePath: undefined,
    createdAt: now,
    updatedAt: now,
    collapsed: false,
    subtasks: includeSubtasks ? source.subtasks.map((s) => cloneNode(s, true, idMap)) : [],
    dependencies: [...source.dependencies],
    dependencyOptions: source.dependencyOptions ? { ...source.dependencyOptions } : undefined,
    assignees: [...source.assignees],
    tags: [...source.tags],
    customFields: { ...source.customFields },
    timeLogs: source.timeLogs ? source.timeLogs.map((l) => ({ ...l })) : undefined,
    recurrence: source.recurrence ? { ...source.recurrence } : undefined
  }
}

function remapDeps(task: Task, idMap: Map<string, string>): void {
  task.dependencies = task.dependencies.map((id) => idMap.get(id) ?? id)
  if (task.dependencyOptions) {
    // Keyed by predecessor id, so the keys move with the ids they name.
    const remapped: NonNullable<Task['dependencyOptions']> = {}
    for (const [id, option] of Object.entries(task.dependencyOptions)) {
      remapped[idMap.get(id) ?? id] = option
    }
    task.dependencyOptions = remapped
  }
  for (const sub of task.subtasks) remapDeps(sub, idMap)
}

/** Reorders among siblings only; the two tasks must share a parent. */
/**
 * The task holding this one, read from the tree itself.
 *
 * `findParentId` answers from the task index, which is right everywhere the index is up
 * to date — and wrong immediately after a move, which only touches the tree. A move has
 * to compare where a ticket was with where it landed, so it asks the tree.
 */
export function parentIdOf(tasks: Task[], id: string, parentId: string | null = null): string | null {
  for (const task of tasks) {
    if (task.id === id) return parentId
    const found = parentIdOf(task.subtasks, id, task.id)
    if (found !== null) return found
  }
  return null
}

/** The list a task actually sits in, so a move can put another one beside it. */
function listHolding(tasks: Task[], id: string): Task[] | null {
  if (tasks.some((t) => t.id === id)) return tasks
  for (const t of tasks) {
    const found = listHolding(t.subtasks, id)
    if (found) return found
  }
  return null
}

/**
 * Drops a task beside another one, or inside it.
 *
 * The target is found wherever it lives, not only among the dragged task's own siblings:
 * moving a ticket from one lot to another is the ordinary case, and requiring a shared
 * parent made every such drop a silent no-op. `inside` puts it at the end of what the
 * target holds, which is the only way into a lot that is folded shut — its tickets are
 * not on screen to be dropped beside.
 *
 * Refused when it would take a branch out of the tree with it: onto itself, or into
 * something it holds.
 */
export function moveTaskInTree(
  tasks: Task[],
  taskId: string,
  targetId: string,
  position: 'before' | 'after' | 'inside'
): boolean {
  if (taskId === targetId) return false
  const moved = findTask(tasks, taskId)
  const target = findTask(tasks, targetId)
  if (!moved || !target) return false
  if (findTask(moved.subtasks, targetId)) return false

  deleteTaskFromTree(tasks, taskId)
  if (position === 'inside') {
    target.subtasks.push(moved)
    return true
  }
  // Read after the removal: taking the task out shifts the target when they shared a list.
  const list = listHolding(tasks, targetId)
  if (!list) return false
  const at = list.findIndex((t) => t.id === targetId)
  list.splice(position === 'before' ? at : at + 1, 0, moved)
  return true
}

export function filterArchived(tasks: Task[]): Task[] {
  return tasks
    .filter((t) => !t.archived)
    .map((t) => (t.subtasks.length ? { ...t, subtasks: filterArchived(t.subtasks) } : t))
}

export function collectAllAssignees(tasks: Task[], extra?: string[], keyOf?: (raw: string) => string): string[] {
  const values: string[] = extra ? [...extra] : []
  const walk = (list: Task[]) => {
    for (const t of list) {
      for (const a of t.assignees) values.push(a)
      walk(t.subtasks)
    }
  }
  walk(tasks)
  return dedupePeople(values, keyOf)
}

export function collectAllTags(tasks: Task[]): string[] {
  const set = new Set<string>()
  const walk = (list: Task[]) => {
    for (const t of list) {
      for (const tag of t.tags) set.add(tag)
      walk(t.subtasks)
    }
  }
  walk(tasks)
  return [...set].filter(Boolean).sort()
}

export function totalLoggedHours(task: Task): number {
  if (!task.timeLogs?.length) return 0
  return task.timeLogs.reduce((sum, log) => sum + log.hours, 0)
}
