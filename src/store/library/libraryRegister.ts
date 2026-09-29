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

/** Every register entry of these projects, by the file it stands for — its path in NFC form. */
export function registerEntries(projects: Project[]): Map<string, RegisterEntry[]> {
  const entries = new Map<string, RegisterEntry[]>()
  // By the path as one form of it: a Mac may have written its accents the other way.
  const add = (path: string, entry: RegisterEntry): void => {
    const key = path.normalize('NFC')
    const list = entries.get(key)
    if (list) list.push(entry)
    else entries.set(key, [entry])
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

/**
 * Words too common in a document's name to say which one it is: an issue, a version, the
 * little words of a title.
 */
const COMMON = new Set([
  'les',
  'des',
  'pour',
  'avec',
  'sur',
  'dans',
  'une',
  'aux',
  'par',
  'the',
  'and',
  'for',
  'with',
  'indice',
  'ind',
  'version',
  'rev',
  'revision',
  'issue',
  'copie',
  'copy',
  'final',
  'pdf',
  'doc',
  'docx'
])

/** A reference as its letters and digits alone: « PL-002 », « pl_002 » and « PL 002 » are one. */
function squeezed(text: string): string {
  return fold(text).replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * How surely a file is the awaited document a ticket stands for, 0 when it is not one.
 *
 * The ticket's reference written in the file's name is all but proof — a drawing is sent
 * under its number. Otherwise the words they share must be most of the ticket's title:
 * « Planning génie civil » is « Planning_GC_genie_civil_indC.pdf », but « Planning » alone,
 * shared by every planning of the project, is not enough.
 */
export function matchScore(ticket: Task, title: string, fileName: string): number {
  const meta = documentOf(ticket)
  const name = `${title} ${fileName.replace(/\.[^.]+$/, '')}`
  const reference = squeezed(meta.reference)
  // Four characters at least, so « A » or « 02 » is not found in every name.
  const byReference = reference.length >= 4 && squeezed(name).includes(reference) ? 10 : 0
  const wanted = titleWords(name)
  const own = [...titleWords(ticket.title)].filter((word) => !COMMON.has(word))
  const shared = own.filter((word) => wanted.has(word)).length
  // Three words in four at least: « Note de calcul des pieux » is not « Note de calcul du radier ».
  const byWords = own.length && shared >= 2 && shared / own.length >= 0.75 ? shared : 0
  return byReference + byWords
}

export interface MatchCandidate {
  project: Project
  task: Task
  score: number
}

export interface MatchSubject {
  /** What tells one document from another in the answer: its record's path. */
  key: string
  title: string
  file: string
  projects: string[]
}

export interface MatchProposal {
  subject: MatchSubject
  /** The awaited tickets it may be, the likeliest first. */
  candidates: MatchCandidate[]
  /** The one proposed: the likeliest no other document was given first. */
  chosen: MatchCandidate | null
}

/**
 * The awaited documents new files may be, each file offered the tickets of its own
 * projects that it looks like — or, when it belongs to none, only those whose reference its
 * name carries. Each ticket is proposed once: to the file it looks most like, the others
 * offered their next likeliest. Files that look like nothing are left out.
 */
export function proposeMatches(subjects: MatchSubject[], projects: Project[]): MatchProposal[] {
  const proposals: MatchProposal[] = []
  for (const subject of subjects) {
    const name = subject.file.slice(subject.file.lastIndexOf('/') + 1)
    const scope = subject.projects.length
      ? projects.filter((project) => subject.projects.includes(project.filePath))
      : projects
    const candidates: MatchCandidate[] = []
    for (const project of scope) {
      for (const { task } of flattenTasks(project.tasks)) {
        if (!isDocument(task) || documentOf(task).state !== 'expected') continue
        const score = matchScore(task, subject.title, name)
        // Outside its own projects, only a reference is sure enough.
        if (score > 0 && (subject.projects.length || score >= 10)) candidates.push({ project, task, score })
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.task.title.localeCompare(b.task.title))
    if (candidates.length) proposals.push({ subject, candidates, chosen: null })
  }
  // The surest pairs first: a ticket goes to the file it looks most like.
  const pairs = proposals
    .flatMap((proposal) => proposal.candidates.map((candidate) => ({ proposal, candidate })))
    .sort((a, b) => b.candidate.score - a.candidate.score)
  const taken = new Set<string>()
  for (const { proposal, candidate } of pairs) {
    if (proposal.chosen || taken.has(candidate.task.id)) continue
    proposal.chosen = candidate
    taken.add(candidate.task.id)
  }
  return proposals
}

/** A file a register holds that the library does not have yet. */
export interface RegisterFile {
  file: string
  /** The register document's title — with its version when it is an earlier one. */
  title: string
  issuer: string
  /** Every project whose register holds it. */
  projects: string[]
  /** The register document's current file, rather than an earlier version. */
  current: boolean
}

/**
 * The files the projects' registers hold and the library does not: their current files,
 * and their earlier versions when asked. `inLibrary` holds the library's paths in NFC form. A file two registers hold is one, belonging to
 * both; one the library already has is left out.
 */
export function registerFilesOutside(
  projects: Project[],
  inLibrary: Set<string>,
  withVersions: boolean
): RegisterFile[] {
  const found = new Map<string, RegisterFile>()
  const add = (entry: RegisterFile): void => {
    if (inLibrary.has(entry.file) || inLibrary.has(entry.file.normalize('NFC'))) return
    const known = found.get(entry.file)
    if (!known) found.set(entry.file, entry)
    else {
      for (const path of entry.projects) if (!known.projects.includes(path)) known.projects.push(path)
      // Current somewhere is current: its own title rather than a version's.
      if (entry.current && !known.current) {
        Object.assign(known, { title: entry.title, issuer: entry.issuer, current: true })
      }
    }
  }
  for (const project of projects) {
    for (const { task } of flattenTasks(project.tasks)) {
      if (!isDocument(task)) continue
      const meta = documentOf(task)
      if (meta.file) {
        add({ file: meta.file, title: task.title, issuer: meta.issuer, projects: [project.filePath], current: true })
      }
      if (!withVersions) continue
      for (const version of meta.versions) {
        if (!version.file || version.file === meta.file) continue
        add({
          file: version.file,
          title: `${task.title} (v${version.version})`,
          issuer: meta.issuer,
          projects: [project.filePath],
          current: false
        })
      }
    }
  }
  return [...found.values()]
}

/** A register document whose file is not where the register says it is. */
export interface MissingRegisterFile {
  project: Project
  task: Task
  file: string
}

/**
 * The register documents whose current file cannot be found: moved, renamed or deleted
 * behind the register's back. `exists` says whether a path holds a file.
 */
export function missingRegisterFiles(projects: Project[], exists: (path: string) => boolean): MissingRegisterFile[] {
  const missing: MissingRegisterFile[] = []
  for (const project of projects) {
    for (const { task } of flattenTasks(project.tasks)) {
      if (!isDocument(task)) continue
      const file = documentOf(task).file
      if (file && !exists(file)) missing.push({ project, task, file })
    }
  }
  return missing
}
