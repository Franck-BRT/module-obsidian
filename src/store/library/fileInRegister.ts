import type { TFile } from 'obsidian'
import { makeDocument, makeTask, type DocumentMeta, type Project, type Task } from '../../types'
import { documentOf, isDocument, statusForState } from '../Document'
import { flattenTasks } from '../TaskTreeOps'
import { repointedDocument, withRegisterFields, type RegisterFields } from './libraryRegister'
import type { DocumentStore } from '../DocumentStore'
import type { TaskSource } from '../TaskSource'

/**
 * A library file followed in a project's register, where it lives: referred to, never
 * moved or copied, so the library keeps it and the register tracks it.
 */

export interface RegisterDeps {
  store: TaskSource
  documents: DocumentStore
}

export interface Deposit {
  by: string
  note: string
}

/**
 * The file as the next version of a register document — the awaited one it answers, or an
 * earlier issue it replaces. The ticket's status follows its state, as a deposit made in
 * the register does.
 */
export async function fileAsVersion(
  deps: RegisterDeps,
  project: Project,
  task: Task,
  file: TFile,
  deposit: Deposit,
  /** The library document's reference, issue and issuer: what the ticket lacks, and its new issue. */
  fields?: RegisterFields
): Promise<DocumentMeta> {
  const before = documentOf(task).state
  const linked = await deps.documents.link(task, file, deposit)
  const meta = fields ? withRegisterFields(linked, fields, true) : linked
  const patch: Partial<Task> = { document: meta }
  if (meta.state !== before) {
    const status = statusForState(meta.state, deps.store.configFor(project).statuses)
    if (status) patch.status = status
  }
  Object.assign(task, patch)
  await deps.store.updateTask(project, task.id, patch)
  return meta
}

/** The file as a new document of the register, received, under the title it has in the library. */
export async function fileAsNew(
  deps: RegisterDeps,
  project: Project,
  title: string,
  file: TFile,
  deposit: Deposit,
  /** The library document's reference, issue and issuer, for the new ticket. */
  fields?: RegisterFields
): Promise<Task> {
  const draft = makeTask({ title, type: 'document', start: '', document: makeDocument(fields ?? {}) })
  const meta = await deps.documents.link(draft, file, deposit)
  const status = statusForState(meta.state, deps.store.configFor(project).statuses)
  const task: Task = { ...draft, document: meta, ...(status ? { status } : {}) }
  await deps.store.insertTask(project, task)
  return task
}

/**
 * The registers told where the library moved the files they follow, since a register
 * finds its files by their path. Returns how many tickets were told.
 */
export async function followMoves(
  store: Pick<TaskSource, 'updateTask'>,
  projects: Project[],
  moves: Map<string, string>
): Promise<number> {
  if (!moves.size) return 0
  let told = 0
  for (const project of projects) {
    for (const { task } of flattenTasks(project.tasks)) {
      if (!isDocument(task)) continue
      const meta = repointedDocument(documentOf(task), moves)
      if (!meta) continue
      await store.updateTask(project, task.id, { document: meta })
      told++
    }
  }
  return told
}
