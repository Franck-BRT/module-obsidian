import { normalizePath, stringifyYaml, TFile, type App } from 'obsidian'
import { makeTask, type Task, type TaskChange } from '../types'
import { changeOf, emptyChange, nextChangeNumber } from './change'
import type { DocLibrary } from './library/DocLibrary'
import { LIBRARY_DOC_KEY, stringList, type LibraryDoc } from './library/libraryDoc'
import { readChange } from './YamlHydrator'
import { ensureFolder } from './vaultFs'
import { sanitizeFileName } from '../utils'

/**
 * The change requests and their proposals, kept in the document library.
 *
 * A change is a note of the library like a document's record — found by its
 * `pm-library-doc` property, filed in its folders and collections, belonging to one
 * project, several, or none —, which says too, by its `pm-change` property, that it is a
 * change: its number is the record's reference, who asks for it its issuer, and the rest
 * — class, group, request, proposal, impacts, what it touches, the board's decisions, the
 * tickets carrying it out — sits under `change`. Its file is the note itself until its
 * sheet is printed, then the sheet's PDF.
 *
 * Read, a change is handed round as a ticket of type `change` that no project holds: its
 * identifier and its path are its note's, so everything that reads a change's fields
 * reads this one the same.
 */

export const CHANGE_NOTE_KEY = 'pm-change'

export function isChangeNote(frontmatter: unknown): boolean {
  return (
    !!frontmatter &&
    typeof frontmatter === 'object' &&
    (frontmatter as Record<string, unknown>)[CHANGE_NOTE_KEY] === true
  )
}

/** A change of the library: as a ticket, and as the library's record. */
export interface ChangeRecord {
  task: Task
  doc: LibraryDoc
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
}

/** A change read from its note's properties, as a ticket keyed by the note's path. */
export function changeFromNote(path: string, basename: string, fm: Record<string, unknown>): Task {
  const raw = fm.change && typeof fm.change === 'object' ? (fm.change as Record<string, unknown>) : {}
  const change = readChange({ ...raw, number: fm.reference ?? raw.number, origin: fm.issuer ?? raw.origin })
  const due = text(fm.due)
  return makeTask({
    id: path,
    title: text(fm.title) || basename,
    type: 'change',
    start: '',
    due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '',
    assignees: stringList(fm.assignees),
    change: change ?? emptyChange(),
    filePath: path,
    createdAt: text(fm.added),
    updatedAt: text(fm.added)
  })
}

/** What a change's note keeps under `change`: all but its number and who asks, which are the record's own. */
export function changeProperties(change: TaskChange): Record<string, unknown> {
  const { number: _number, origin: _origin, ...rest } = change
  return rest
}

export interface NewChange {
  title: string
  change: TaskChange
  projects: string[]
  assignees?: string[]
  due?: string
  /** The day it is written, YYYY-MM-DD. */
  today: string
}

/** How long a change just written is believed over what Obsidian has not read of it yet. */
const FRESH_MS = 10_000

export class ChangeLibrary {
  /** Changes just written, as they now are: Obsidian reads a note's properties a moment after. */
  private fresh = new Map<string, { task: Task; at: number }>()
  /** The projects just given to changes, believed the same way. */
  private freshProjects = new Map<string, { projects: string[]; at: number }>()

  constructor(
    private app: App,
    private library: DocLibrary,
    /** The library's folder new changes are written in, by its name. */
    private folder: () => string,
    /** The library's category a change is filed under. */
    private category: () => string
  ) {}

  /** Every change in the library. */
  all(): ChangeRecord[] {
    const now = Date.now()
    const out: ChangeRecord[] = []
    for (const doc of this.library.docs()) {
      const file = this.app.vault.getAbstractFileByPath(doc.record)
      if (!(file instanceof TFile)) continue
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter
      if (!isChangeNote(fm)) continue
      const fresh = this.fresh.get(doc.record)
      const task =
        fresh && now - fresh.at < FRESH_MS
          ? fresh.task
          : changeFromNote(doc.record, file.basename, fm as Record<string, unknown>)
      const given = this.freshProjects.get(doc.record)
      out.push({ task, doc: given && now - given.at < FRESH_MS ? { ...doc, projects: given.projects } : doc })
    }
    return out
  }

  /** The changes belonging to any of these projects, by their notes' paths. */
  forProjects(paths: string[]): ChangeRecord[] {
    const wanted = new Set(paths)
    return this.all().filter((record) => record.doc.projects.some((path) => wanted.has(path)))
  }

  /** A change by its note's path. */
  at(path: string): ChangeRecord | undefined {
    return this.all().find((record) => record.doc.record === path)
  }

  /** Whether a library record is a change. */
  isChange(doc: Pick<LibraryDoc, 'record'>): boolean {
    const file = this.app.vault.getAbstractFileByPath(doc.record)
    return file instanceof TFile && isChangeNote(this.app.metadataCache.getFileCache(file)?.frontmatter)
  }

  /** The number the next change takes, past the highest in the library. */
  nextNumber(): string {
    return nextChangeNumber(this.all().map((record) => record.task))
  }

  /** A new change written in the library's changes folder; it comes back as the ticket it is read as. */
  async create(input: NewChange): Promise<Task> {
    const folder = normalizePath(`${this.library.root}/${this.folder()}`)
    await ensureFolder(this.app, folder)
    const base = sanitizeFileName([input.change.number, input.title].filter(Boolean).join(' ')) || 'DM'
    let path = normalizePath(`${folder}/${base}.md`)
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} (${n}).md`)
    const self = `[[${path.replace(/\.md$/, '')}]]`
    const properties: Record<string, unknown> = {
      [LIBRARY_DOC_KEY]: true,
      [CHANGE_NOTE_KEY]: true,
      title: input.title,
      file: self,
      projects: input.projects.map((project) => this.library.projectLink(project, path)),
      added: input.today,
      category: this.category(),
      lot: '',
      issuer: input.change.origin,
      reference: input.change.number,
      tags: [],
      assignees: input.assignees ?? [],
      due: input.due ?? '',
      change: changeProperties(input.change)
    }
    await this.app.vault.create(path, `---\n${stringifyYaml(properties).trimEnd()}\n---\n\n`)
    const task = makeTask({
      id: path,
      title: input.title,
      type: 'change',
      start: '',
      due: input.due ?? '',
      assignees: input.assignees ?? [],
      change: input.change,
      filePath: path
    })
    this.fresh.set(path, { task, at: Date.now() })
    return task
  }

  /** A change's fields written back into its note: its title, who carries it, by when, and the change itself. */
  async save(task: Task): Promise<void> {
    const file = task.filePath ? this.app.vault.getAbstractFileByPath(task.filePath) : null
    if (!(file instanceof TFile)) return
    const change = changeOf(task)
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm.title = task.title
      fm.reference = change.number
      fm.issuer = change.origin
      fm.assignees = task.assignees
      fm.due = task.due
      fm.change = changeProperties(change)
    })
    this.fresh.set(file.path, { task: structuredClone(task), at: Date.now() })
  }

  /** The projects a change belongs to, replacing those it had. */
  async setProjects(doc: LibraryDoc, projects: string[]): Promise<void> {
    await this.library.setProjects(doc, projects)
    this.freshProjects.set(doc.record, { projects: [...new Set(projects)], at: Date.now() })
  }

  /** The file the library shows for a change: its sheet's PDF, once printed. */
  async setFile(task: Task, filePath: string): Promise<void> {
    const file = task.filePath ? this.app.vault.getAbstractFileByPath(task.filePath) : null
    if (!(file instanceof TFile)) return
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm.file = `[[${filePath}]]`
    })
  }
}
