import type { Project, Task } from '../../types'
import { documentOf, isDocument } from '../Document'
import { flattenTasks } from '../TaskTreeOps'
import { fold } from './libraryDoc'

/**
 * The library's documents as the projects' registers know them.
 *
 * A document of the library is followed in a project's register by a document ticket that
 * refers to its file where it lives — never moved, never copied — so the register keeps its
 * references, issues, states and visas, and the library stays where the file is found.
 * A file is in a register as a ticket's current file, or as one of its earlier versions.
 */

export interface RegisterEntry {
  project: Project
  task: Task
  /** The ticket's current file, rather than an earlier version of it. */
  current: boolean
  /** The version number the file was deposited as. */
  version: number
}

/** Every register entry of these projects, by the file it stands for. */
export function registerEntries(projects: Project[]): Map<string, RegisterEntry[]> {
  const entries = new Map<string, RegisterEntry[]>()
  const add = (path: string, entry: RegisterEntry): void => {
    const list = entries.get(path)
    if (list) list.push(entry)
    else entries.set(path, [entry])
  }
  for (const project of projects) {
    for (const { task } of flattenTasks(project.tasks)) {
      if (!isDocument(task)) continue
      const meta = documentOf(task)
      const last = meta.versions[meta.versions.length - 1]
      if (meta.file) add(meta.file, { project, task, current: true, version: last?.version ?? 1 })
      for (const version of meta.versions) {
        if (version.file && version.file !== meta.file) {
          add(version.file, { project, task, current: false, version: version.version })
        }
      }
    }
  }
  return entries
}

/** The words a title is recognised by: three letters or more, folded, once each. */
function titleWords(text: string): Set<string> {
  return new Set(
    fold(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3)
  )
}

/**
 * How closely a register ticket answers a document: the words its title and reference
 * share with the document's title and file name. A planning received as « Planning GC
 * indice C.pdf » is the ticket « Planning génie civil » the register was waiting for.
 */
export function likeness(ticket: Task, title: string, fileName: string): number {
  const wanted = titleWords(`${title} ${fileName.replace(/\.[^.]+$/, '')}`)
  const meta = documentOf(ticket)
  let shared = 0
  for (const word of titleWords(`${ticket.title} ${meta.reference}`)) if (wanted.has(word)) shared++
  return shared
}

/**
 * The tickets a document can be filed as, in the order they are offered: those still
 * awaited first — a received file most often answers one — then by how much they look
 * like it, then by reference. A ticket the file is already the current file of is left out.
 */
export function registerCandidates(project: Project, title: string, file: string): Task[] {
  const name = file.slice(file.lastIndexOf('/') + 1)
  return flattenTasks(project.tasks)
    .map(({ task }) => task)
    .filter((task) => isDocument(task) && documentOf(task).file !== file)
    .map((task) => ({ task, awaited: documentOf(task).state === 'expected', like: likeness(task, title, name) }))
    .sort(
      (a, b) =>
        Number(b.awaited) - Number(a.awaited) ||
        b.like - a.like ||
        documentOf(a.task).reference.localeCompare(documentOf(b.task).reference, undefined, { numeric: true }) ||
        a.task.title.localeCompare(b.task.title)
    )
    .map((each) => each.task)
}
