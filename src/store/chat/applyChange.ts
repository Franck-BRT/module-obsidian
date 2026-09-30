import { makeDocument, makeTask, TASK_TYPES, type Project, type Task } from '../../types'
import { getDefaultPriorityId, getDefaultStatusId } from '../../utils'
import { flattenTasks } from '../TaskTreeOps'
import { fold } from '../library/libraryDoc'
import type { TaskSource } from '../TaskSource'
import type { RequirementStore } from '../requirements/RequirementStore'
import { findTaskById } from '../TaskIndex'
import type { VaultIndex } from '../VaultIndex'
import {
  changeBlocks,
  createAsTicket,
  createChange,
  findProject,
  findTicket,
  type CreateContext,
  type ProjectCandidate,
  type TicketCandidate,
  requirementChange,
  ticketChange,
  type ChangeSpec,
  type Option,
  type ReqOptions,
  type ValueProblem,
  parseChange,
  replaceBlock,
  ticketSource
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
  /** What its fields are checked against: the project's lists, and every ticket it could follow. */
  lists: { statuses: Option[]; priorities: Option[]; candidates: TicketCandidate[] }
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
  return {
    project,
    task,
    lists: { statuses: listed(config.statuses), priorities: listed(config.priorities), candidates }
  }
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
/** Where a new ticket goes: a project; or, a programme named, the projects it could go into. */
export type CreatePlace = { project: ProjectCandidate; via?: string } | { choices: ProjectCandidate[]; via: string }

/**
 * The project a new ticket goes into: the one named. A programme holds no tickets, so one
 * named — the model often names the programme the conversation is about — stands for its
 * projects: the one holding the lot or ticket the new one goes under, or its only project.
 * Several could: they are offered, rather than one guessed. Null when nothing is named
 * that the vault has.
 */
export async function createPlace(index: VaultIndex, store: TaskSource, spec: CreateSpec): Promise<CreatePlace | null> {
  const refs = index.projectRefs().filter((ref) => !ref.template)
  const candidate = (ref: { path: string; title: string }): ProjectCandidate => ({ path: ref.path, title: ref.title })
  const named = findProject(refs.filter((ref) => !ref.program).map(candidate), spec.project)
  if (named) return { project: named }
  const program = findProject(refs.filter((ref) => ref.program).map(candidate), spec.project)
  if (!program) return null
  const inside = index
    .descendantRefs(program.path)
    .filter((ref) => !ref.program && !ref.template)
    .map(candidate)
  if (!inside.length) return null
  const loaded = await store.loadProjects(inside.map((each) => each.path))
  const titled = (title: string) => (project: Project) =>
    flattenTasks(project.tasks).some(({ task }) => !task.archived && fold(task.title) === fold(title))
  const among = (projects: Project[]): ProjectCandidate[] =>
    projects.map(
      (project) =>
        inside.find((each) => each.path === project.filePath) ??
        candidate({ path: project.filePath, title: project.title })
    )
  // The lot or ticket it goes under says which project, when only one holds it.
  const holding = spec.parent?.trim() ? loaded.filter(titled(spec.parent)) : loaded
  const possible = holding.length ? holding : loaded
  if (possible.length === 1) return { project: among(possible)[0], via: program.title }
  // Made already, in one of them — chosen by the reader before —: that one.
  const made = possible.filter(titled(spec.title))
  if (made.length === 1) return { project: among(made)[0], via: program.title }
  return possible.length ? { choices: among(possible), via: program.title } : null
}

export async function createTarget(
  index: VaultIndex,
  store: TaskSource,
  spec: CreateSpec,
  typeLabel: (type: string) => string
): Promise<{ project: Project; context: CreateContext; via?: string } | null> {
  const place = await createPlace(index, store, spec)
  if (!place || 'choices' in place) return null
  const named = place.project
  const project = await store.loadProjectByPath(named.path)
  if (!project) return null
  const config = store.configFor(project)
  const listed = (list: { id: string; label: string }[]): Option[] =>
    list.map((entry) => ({ id: entry.id, label: entry.label }))
  return {
    project,
    ...(place.via ? { via: place.via } : {}),
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

/**
 * A lot made at the top of a project, for a new ticket to go under — unless one of that
 * title is there already, whatever its case and accents. True when one was made.
 */
export async function createLot(store: TaskSource, projectPath: string, title: string): Promise<boolean> {
  const name = title.trim()
  const project = name ? await store.loadProjectByPath(projectPath) : null
  if (!project) return false
  if (flattenTasks(project.tasks).some(({ task }) => !task.archived && fold(task.title) === fold(name))) return false
  await store.insertTask(project, makeTask({ title: name, type: 'phase', start: '' }))
  return true
}

/**
 * The projects a new ticket could go into, those whose title looks like the name given
 * first: the same, then one holding the other, then the rest in order.
 */
export function projectsLike(index: VaultIndex, name: string): ProjectCandidate[] {
  const wanted = fold(name.trim())
  const rank = (title: string): number => {
    const own = fold(title)
    if (!wanted) return 2
    if (own === wanted) return 0
    return own.includes(wanted) || wanted.includes(own) ? 1 : 2
  }
  return index
    .projectRefs()
    .filter((ref) => !ref.program && !ref.template)
    .map((ref) => ({ path: ref.path, title: ref.title }))
    .sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title))
}

/**
 * The projects the conversation is about where tickets can be made — a programme stands
 * for its projects — each with its lots, for the model to name them exactly.
 */
export async function ticketPlaces(
  index: VaultIndex,
  store: TaskSource,
  paths: string[]
): Promise<{ title: string; lots: string[] }[]> {
  const wanted: string[] = []
  for (const path of paths) {
    const ref = index.projectRef(path)
    if (!ref || ref.template) continue
    const own = ref.program ? index.descendantRefs(path).filter((each) => !each.program && !each.template) : [ref]
    for (const each of own) if (!wanted.includes(each.path)) wanted.push(each.path)
  }
  const projects = await store.loadProjects(wanted)
  return projects.map((project) => ({
    title: project.title,
    lots: project.tasks.filter((task) => !task.archived && task.type === 'phase').map((task) => task.title)
  }))
}

/**
 * The ticket a proposal to create one names, already there: of that title, in the project
 * it would go into — any of a programme's, or anywhere when the project named is unknown.
 * Null when there is none, or more than one to choose from.
 */
export async function existingTicket(
  index: VaultIndex,
  store: TaskSource,
  spec: CreateSpec
): Promise<TicketCandidate | null> {
  const same = ticketCandidates(index).filter((candidate) => fold(candidate.title.trim()) === fold(spec.title.trim()))
  if (!same.length) return null
  const place = await createPlace(index, store, spec)
  const paths = !place ? null : 'choices' in place ? place.choices.map((choice) => choice.path) : [place.project.path]
  const within = paths
    ? same.filter((candidate) => candidate.projectPath !== null && paths.includes(candidate.projectPath))
    : same
  return within.length === 1 ? within[0] : null
}

/**
 * A reply as it arrives, each ticket it proposes to create that is there already turned
 * into the change to that ticket the model meant. Nothing has been made from the reply
 * yet, so a ticket of that title is one that was there before — asked to be changed, and
 * which a creation would only have reported as made.
 */
export async function asModifications(index: VaultIndex, store: TaskSource, reply: string): Promise<string> {
  let text = reply
  for (const source of changeBlocks(reply)) {
    const read = parseChange(source)
    if (!('spec' in read) || read.spec.kind !== 'create') continue
    const existing = await existingTicket(index, store, read.spec)
    const change = existing ? createAsTicket(read.spec, existing) : null
    if (change) text = replaceBlock(text, source, ticketSource(change)) ?? text
  }
  return text
}
