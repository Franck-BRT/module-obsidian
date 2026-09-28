import { makeDocument, makeTask, TASK_TYPES, type Project, type Task } from '../../types'
import { getDefaultPriorityId, getDefaultStatusId } from '../../utils'
import { flattenTasks } from '../TaskTreeOps'
import type { TaskSource } from '../TaskSource'
import type { RequirementStore } from '../requirements/RequirementStore'
import { findTaskById } from '../TaskIndex'
import type { VaultIndex } from '../VaultIndex'
import {
  createChange,
  findProject,
  findTicket,
  type CreateContext,
  type TicketCandidate,
  requirementChange,
  ticketChange,
  type ChangeSpec,
  type Option,
  type ReqOptions,
  type ValueProblem
} from './chatChange'

/**
 * A proposed change, written — through the same doors a change made by hand goes through.
 *
 * Checked again at the moment of the click against what the vault holds then: the card
 * may have been drawn an hour ago, and a proposal that no longer holds is not written
 * over whatever came since.
 */

export type Applied =
  | { ok: true; name: string; changed: boolean }
  | { ok: false; problem: 'none' | 'ambiguous'; count?: number }
  | { ok: false; problem: ValueProblem; allowed?: string[] }

type RequirementSpec = Extract<ChangeSpec, { kind: 'requirement' }>
type TicketSpec = Extract<ChangeSpec, { kind: 'ticket' }>

/**
 * A change to a requirement, saved the way the editor saves: a wording that moved bumps
 * the revision, marks the translations behind and the requirements relying on it suspect,
 * and renames the note if its title changed.
 */
export async function applyToRequirement(
  store: RequirementStore,
  path: string,
  spec: RequirementSpec,
  options: ReqOptions,
  by: string
): Promise<Applied> {
  let refused: { problem: ValueProblem; allowed?: string[] } | null = null
  let changed = false
  const saved = await store.save(path, (current) => {
    const resolved = requirementChange(spec, current, options)
    if (!resolved.ok) {
      refused = { problem: resolved.problem, allowed: resolved.allowed }
      return current
    }
    if (resolved.applied) return current
    changed = true
    return resolved.change.apply(current, by)
  })
  if (refused) return { ok: false, ...(refused as { problem: ValueProblem; allowed?: string[] }) }
  if (!saved) return { ok: false, problem: 'none' }
  return { ok: true, name: saved.requirement.id, changed }
}

/** Where a ticket named by the model lives, found again from the plan as it is now. */
export interface TicketTarget {
  project: Project
  task: Task
  lists: { statuses: Option[]; priorities: Option[] }
}

/** The ticket the model named, by its title, loaded from its project as it is now. */
/** Every ticket in the vault, archived ones left out, as a title can be looked up among. */
function ticketCandidates(index: VaultIndex): TicketCandidate[] {
  return index
    .allTaskRefs()
    .filter((ref) => !ref.archived)
    .map((ref) => ({
      id: ref.id,
      title: ref.title,
      projectPath: ref.projectPath,
      projectTitle: ref.projectPath ? (index.projectRef(ref.projectPath)?.title ?? '') : ''
    }))
}

export async function ticketTarget(
  index: VaultIndex,
  store: TaskSource,
  spec: TicketSpec
): Promise<TicketTarget | { problem: 'none' | 'ambiguous'; count: number }> {
  const candidates = ticketCandidates(index)
  const found = findTicket(candidates, spec.target, spec.project)
  if (!('found' in found)) return found
  const project = found.found.projectPath ? await store.loadProjectByPath(found.found.projectPath) : null
  const task = project ? findTaskById(project, found.found.id) : null
  if (!project || !task) return { problem: 'none', count: 0 }
  const config = store.configFor(project)
  const listed = (list: { id: string; label: string }[]): Option[] =>
    list.map((entry) => ({ id: entry.id, label: entry.label }))
  return { project, task, lists: { statuses: listed(config.statuses), priorities: listed(config.priorities) } }
}

/**
 * A change to a ticket, saved the way the table saves one: a status that finishes it
 * stamps its completion, and a date that moved moves what waits on it, as a drag in the
 * Gantt would.
 */
export async function applyToTicket(index: VaultIndex, store: TaskSource, spec: TicketSpec): Promise<Applied> {
  const target = await ticketTarget(index, store, spec)
  if ('problem' in target) return { ok: false, ...target }
  const resolved = ticketChange(spec, target.task, target.lists)
  if (!resolved.ok) return { ok: false, problem: resolved.problem, allowed: resolved.allowed }
  if (resolved.applied) return { ok: true, name: target.task.title, changed: false }
  const name = target.task.title
  await store.updateTask(target.project, target.task.id, resolved.change.patch)
  if (resolved.change.reschedule) await store.scheduleAfterChange(target.project, target.task.id)
  return { ok: true, name, changed: true }
}

type CreateSpec = Extract<ChangeSpec, { kind: 'create' }>

/**
 * The project a new ticket would go into, loaded as it is now, with what it is checked
 * against. A programme is never one: it holds no tickets of its own, so the model has to
 * name the project underneath.
 *
 * `titles` names the ticket types in the reader's words.
 */
export async function createTarget(
  index: VaultIndex,
  store: TaskSource,
  spec: CreateSpec,
  typeLabel: (type: string) => string
): Promise<{ project: Project; context: CreateContext } | null> {
  const refs = index.projectRefs().filter((ref) => !ref.program)
  const named = findProject(
    refs.map((ref) => ({ path: ref.path, title: ref.title })),
    spec.project
  )
  const project = named ? await store.loadProjectByPath(named.path) : null
  if (!named || !project) return null
  const config = store.configFor(project)
  const listed = (list: { id: string; label: string }[]): Option[] =>
    list.map((entry) => ({ id: entry.id, label: entry.label }))
  return {
    project,
    context: {
      project: named,
      tickets: flattenTasks(project.tasks)
        .map((flat) => flat.task)
        .filter((task) => !task.archived)
        .map((task) => ({ id: task.id, title: task.title, type: task.type })),
      statuses: listed(config.statuses),
      priorities: listed(config.priorities),
      types: TASK_TYPES.filter((type) => type !== 'subtask').map((type) => ({ id: type, label: typeLabel(type) })),
      defaultStatus: getDefaultStatusId(config.statuses),
      defaultPriority: getDefaultPriorityId(config.priorities),
      candidates: ticketCandidates(index)
    }
  }
}

/**
 * A new ticket, written the way the editor writes one: inserted under its lot or parent,
 * a document given its register entry, and — when it waits on something — placed by the
 * project's own scheduling, as a link drawn in the Gantt would place it.
 */
export async function applyCreate(
  index: VaultIndex,
  store: TaskSource,
  spec: CreateSpec,
  typeLabel: (type: string) => string
): Promise<Applied> {
  const target = await createTarget(index, store, spec, typeLabel)
  if (!target) return { ok: false, problem: 'project', allowed: [spec.project] }
  const resolved = createChange(spec, target.context)
  if (!resolved.ok) return { ok: false, problem: resolved.problem, allowed: resolved.allowed }
  if (resolved.applied) return { ok: true, name: spec.title, changed: false }
  const { task: fields, parentId, reschedule } = resolved.change
  const task = makeTask({
    ...fields,
    ...(fields.type === 'document' ? { document: makeDocument({ reference: fields.title }) } : {})
  })
  await store.insertTask(target.project, task, parentId)
  if (reschedule) await store.scheduleAfterChange(target.project, task.id)
  return { ok: true, name: task.title, changed: true }
}
