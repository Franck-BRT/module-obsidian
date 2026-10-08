import { normalizePath, TFile, type App } from 'obsidian'
import { sanitizeFileName } from '../../utils'
import { freePath } from '../DocumentStore'
import { cleanTags } from '../library/libraryClass'
import { fold, linkPath, stringList } from '../library/libraryDoc'
import { refLink } from '../refs'
import { ensureFolder } from '../vaultFs'
import { AT_ROOT, inFolder } from '../folderFilter'
import { dissolveSubfolder, folderPath, makeSubfolder, renameSubfolder, subfolders } from '../libraryFolders'

/**
 * The notes library: a folder for whatever does not belong anywhere yet — a thought, a
 * call's notes, a reply of the chat kept — and the inbox new notes land in.
 *
 * A note is filed by saying which projects it belongs to, as a property its note keeps;
 * one that says none is still to sort. It can then be moved beside its project, or left
 * where it is: the library lists every note under its folder, however deep.
 */

export interface NoteEntry {
  path: string
  title: string
  /** Its first lines, as prose. */
  excerpt: string
  /** Last modified, in milliseconds. */
  mtime: number
  tags: string[]
  /** The projects it belongs to, by their notes' paths; none while it is to sort. */
  projects: string[]
  /** The folder it is in, under the library's; '' at its root. */
  subfolder: string
}

/** A note's text without its properties. */
export function noteBody(content: string): string {
  const text = content.replace(/\r\n?/g, '\n')
  const match = /^---\n[\s\S]*?\n---\n?/.exec(text)
  return (match ? text.slice(match[0].length) : text).trim()
}

/** A note's title: its first heading, or its file's name. */
export function noteTitle(basename: string, content: string): string {
  return /^#\s+(.+)$/m.exec(noteBody(content))?.[1].trim() || basename
}

/**
 * A note's first lines as a sentence or two: its heading, marks and links read as the
 * words they show, cut at a word.
 */
export function noteExcerpt(content: string, length = 180): string {
  const body = noteBody(content)
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((line) => !/^#{1,6}\s/.test(line))
    // A quote's mark, a list's bullet or number, a task's box: the words they carry stay.
    .map((line) => line.replace(/^\s*>\s?/, '').replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[.\]\s+)?/, ''))
    .join(' ')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, shown?: string) => shown ?? target)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (body.length <= length) return body
  const cut = body.lastIndexOf(' ', length)
  return `${body.slice(0, cut > length * 0.6 ? cut : length).trimEnd()}…`
}

/** Stands for the notes still to sort — belonging to no project — in a filter. */
export const TO_SORT = ':to-sort'

/** Stands for the notes at the library's root — the inbox itself — in a folder filter. */
export { AT_ROOT }

export interface NoteQuery {
  text: string
  /** '' for every note, `TO_SORT`, or a project's path. */
  project: string
  /** '' for any tag. */
  tag: string
  /** '' for every folder, `AT_ROOT`, or a folder under the library's — its own folders only when words are searched. */
  folder?: string
}

/** Whether a note answers a search: every word in its title, tags, projects or text. */
export function matchesNote(
  entry: NoteEntry,
  query: NoteQuery,
  projectTitle: (path: string) => string,
  text: (entry: NoteEntry) => string = () => ''
): boolean {
  if (query.project === TO_SORT) {
    if (entry.projects.length) return false
  } else if (query.project && !entry.projects.includes(query.project)) return false
  if (query.tag && !entry.tags.some((tag) => fold(tag) === fold(query.tag))) return false
  // A folder shows what is in it, not what its own folders hold — unless words are searched,
  // which look below it too.
  if (!inFolder(entry.subfolder, query.folder, !!query.text.trim())) return false
  const words = fold(query.text).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = fold([entry.title, entry.subfolder, ...entry.tags, ...entry.projects.map(projectTitle)].join('\n'))
  if (words.every((word) => haystack.includes(word))) return true
  const body = text(entry)
  return !!body && words.every((word) => haystack.includes(word) || body.includes(word))
}

export type NoteSort = 'modified' | 'title'

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' })

export function sortNotes(entries: NoteEntry[], by: NoteSort): NoteEntry[] {
  return [...entries].sort((a, b) =>
    by === 'title'
      ? collator.compare(a.title, b.title) || a.path.localeCompare(b.path)
      : b.mtime - a.mtime || collator.compare(a.title, b.title)
  )
}

/** Notes read at the same time. */
const READ_AT_ONCE = 50

export class NoteLibrary {
  /** What was read of each note, kept while it has not changed. */
  private read = new Map<string, { mtime: number; title: string; excerpt: string; body: string; folded: string }>()

  constructor(
    private app: App,
    private folder: () => string,
    private projectTitle: (path: string) => string
  ) {}

  get root(): string {
    return normalizePath(this.folder())
  }

  /**
   * The notes under the library's folder, however deep — the plugin's own notes aside:
   * a project, a ticket, a conversation, a skill is not a note to sort.
   */
  files(): TFile[] {
    const prefix = `${this.root}/`
    return this.app.vault.getMarkdownFiles().filter((file) => {
      if (!file.path.startsWith(prefix)) return false
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
      return !Object.keys(fm).some((key) => key.startsWith('pm-'))
    })
  }

  /**
   * Every note of the library, read once and again only when it changes — many at a time,
   * so a folder of thousands opens in a moment. A note that cannot be read is listed by
   * its name rather than keeping the others from being listed.
   */
  async entries(): Promise<NoteEntry[]> {
    const files = this.files()
    const entries: NoteEntry[] = []
    for (let at = 0; at < files.length; at += READ_AT_ONCE) {
      entries.push(...(await Promise.all(files.slice(at, at + READ_AT_ONCE).map((file) => this.entry(file)))))
    }
    return entries
  }

  private async entry(file: TFile): Promise<NoteEntry> {
    let seen = this.read.get(file.path)
    if (!seen || seen.mtime !== file.stat.mtime) {
      let content = ''
      try {
        content = await this.app.vault.cachedRead(file)
      } catch (error) {
        console.error(`[PM] Could not read the note "${file.path}":`, error)
      }
      seen = {
        mtime: file.stat.mtime,
        title: noteTitle(file.basename, content),
        excerpt: noteExcerpt(content),
        body: noteBody(content),
        folded: fold(noteBody(content))
      }
      this.read.set(file.path, seen)
    }
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    const projects = [...stringList(fm.projects), ...stringList(fm.project ?? fm.projet)]
      .map((raw) => this.resolve(raw, file.path))
      .filter((path): path is string => !!path)
    const slash = file.path.lastIndexOf('/')
    return {
      path: file.path,
      title: seen.title,
      excerpt: seen.excerpt,
      mtime: file.stat.mtime,
      tags: cleanTags(stringList(fm.tags)),
      projects: [...new Set(projects)],
      subfolder: file.path.slice(this.root.length + 1, Math.max(this.root.length + 1, slash))
    }
  }

  /** A note's text, without its properties, as last read. */
  body(entry: NoteEntry): string {
    return this.read.get(entry.path)?.body ?? ''
  }

  /** A note's text, folded for searching, as last read. */
  folded(entry: NoteEntry): string {
    return this.read.get(entry.path)?.folded ?? ''
  }

  private resolve(raw: string, from: string): string | null {
    const path = linkPath(raw)
    if (!path) return null
    const found = this.app.metadataCache.getFirstLinkpathDest(path, from)
    if (found) return found.path
    const direct = this.app.vault.getAbstractFileByPath(normalizePath(path.endsWith('.md') ? path : `${path}.md`))
    return direct instanceof TFile ? direct.path : null
  }

  /**
   * A new note, named or untitled, never over another: in the inbox — the library's root —
   * or in one of its folders.
   */
  async create(title: string, body = '', subfolder = ''): Promise<TFile> {
    const folder = this.pathOf(subfolder)
    await ensureFolder(this.app, folder)
    const path = await freePath(this.app, folder, sanitizeFileName(title).trim() || 'Note', 'md')
    return this.app.vault.create(path, body)
  }

  /** A folder of the library, by its path under the library's: '' is the library's root. */
  pathOf(subfolder: string): string {
    return folderPath(this.root, subfolder)
  }

  /** The library's folders, however deep, by their paths under its own, in order. */
  folders(): string[] {
    return subfolders(this.app, this.root)
  }

  /**
   * Makes a folder in the library — under another of its folders, or at its root —; returns
   * its path under the library's, or '' when the name holds nothing to make.
   */
  createFolder(name: string, under = ''): Promise<string> {
    return makeSubfolder(this.app, this.root, name, under)
  }

  /**
   * Renames one of the library's folders, where it is; returns its new path under the
   * library's, or null when the name holds nothing or another folder has it.
   */
  async renameFolder(subfolder: string, name: string): Promise<string | null> {
    return (await renameSubfolder(this.app, this.root, subfolder, name))?.folder ?? null
  }

  /** Takes a folder out: its notes and folders go up into the one it is in; returns how many files moved. */
  async deleteFolder(subfolder: string): Promise<number> {
    return (await dissolveSubfolder(this.app, this.root, subfolder)).size
  }

  /** Says which projects a note belongs to, replacing what it said; the single `project` of a kept reply included. */
  async setProjects(file: TFile, projects: string[]): Promise<void> {
    const links = [...new Set(projects)].map((path) => refLink(this.app, path, this.projectTitle(path), file.path))
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      delete fm.project
      delete fm.projet
      if (links.length) fm.projects = links
      else delete fm.projects
    })
  }

  /** Moves a note into a folder, never over another note; links to it follow, as Obsidian moves them. */
  async moveTo(file: TFile, folder: string): Promise<TFile> {
    const target = normalizePath(folder)
    if (file.parent?.path === target) return file
    await ensureFolder(this.app, target)
    await this.app.fileManager.renameFile(file, await freePath(this.app, target, file.basename, 'md'))
    return file
  }
}
