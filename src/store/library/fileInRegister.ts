import type { TFile } from 'obsidian'
import { makeDocument, makeTask, type DocumentMeta, type Project, type Task } from '../../types'
import { documentOf, statusForState } from '../Document'
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
  deposit: Deposit
): Promise<DocumentMeta> {
  const before = documentOf(task).state
  const meta = await deps.documents.link(task, file, deposit)
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
  deposit: Deposit
): Promise<Task> {
  const draft = makeTask({ title, type: 'document', start: '', document: makeDocument() })
  const meta = await deps.documents.link(draft, file, deposit)
  const status = statusForState(meta.state, deps.store.configFor(project).statuses)
  const task: Task = { ...draft, document: meta, ...(status ? { status } : {}) }
  await deps.store.insertTask(project, task)
  return task
}
