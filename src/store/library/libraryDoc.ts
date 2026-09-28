import { stringifyYaml } from 'obsidian'

/**
 * A document poured into the library, as the note that stands for it.
 *
 * The file is kept as it came — a PDF stays a PDF — and beside it a short note, its record,
 * says what the library knows of it: its title, the file it stands for, the projects it
 * belongs to (none, one, or several), when it came in and a fingerprint of its bytes. The
 * record is a note like any other: the file and the projects are links, so Obsidian keeps
 * them right when something is renamed, and the vault's own search finds it.
 */

export const LIBRARY_DOC_KEY = 'pm-library-doc'

export function isLibraryDoc(frontmatter: unknown): boolean {
  return (
    !!frontmatter &&
    typeof frontmatter === 'object' &&
    (frontmatter as Record<string, unknown>)[LIBRARY_DOC_KEY] === true
  )
}

export interface LibraryDoc {
  /** The record's own path. */
  record: string
  title: string
  /** The file it stands for, where it now is; '' when it cannot be found. */
  file: string
  /** The projects it belongs to, by their notes' paths. */
  projects: string[]
  /** The day it came in, YYYY-MM-DD. */
  added: string
  /** Its size in bytes when it came in. */
  size: number
  /** SHA-256 of its bytes: the same document poured twice is known by it. */
  hash: string
  tags: string[]
}

export type DocFamily = 'pdf' | 'word' | 'sheet' | 'slides' | 'image' | 'mail' | 'note' | 'other'

export const DOC_FAMILIES: DocFamily[] = ['pdf', 'word', 'sheet', 'slides', 'image', 'mail', 'note', 'other']

const FAMILY_OF: Record<string, DocFamily> = {
  pdf: 'pdf',
  doc: 'word',
  docx: 'word',
  odt: 'word',
  rtf: 'word',
  xls: 'sheet',
  xlsx: 'sheet',
  xlsm: 'sheet',
  ods: 'sheet',
  csv: 'sheet',
  ppt: 'slides',
  pptx: 'slides',
  odp: 'slides',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  msg: 'mail',
  eml: 'mail',
  md: 'note',
  txt: 'note',
  html: 'note',
  htm: 'note'
}

export const FAMILY_ICONS: Record<DocFamily, string> = {
  pdf: 'file-text',
  word: 'file-type',
  sheet: 'file-spreadsheet',
  slides: 'presentation',
  image: 'image',
  mail: 'mail',
  note: 'sticky-note',
  other: 'file'
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function baseNameOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}

export function familyOf(path: string): DocFamily {
  return FAMILY_OF[extensionOf(path)] ?? 'other'
}

/**
 * The title a file comes in with: its name, without the extension, with the underscores
 * and runs of spaces a scanner or a mail client leaves turned back into single spaces.
 */
export function titleFromName(name: string): string {
  const title = baseNameOf(name).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
  return title || name
}

export interface RecordFields {
  title: string
  /** A link to the file: `[[path]]`. */
  fileLink: string
  /** Links to the projects: `[[path|title]]`. */
  projectLinks: string[]
  added: string
  size: number
  hash: string
}

/** The record's text: its fields up top, and a place for the reader's own notes. */
export function recordContent(fields: RecordFields, notesHeading: string): string {
  const frontmatter = {
    [LIBRARY_DOC_KEY]: true,
    title: fields.title,
    file: fields.fileLink,
    projects: fields.projectLinks,
    added: fields.added,
    size: fields.size,
    sha256: fields.hash,
    tags: []
  }
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n## ${notesHeading}\n\n`
}

/** A string list from a frontmatter field that may hold one string, a list, or nothing. */
export function stringList(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.trim() ? [raw.trim()] : []
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()).map((s) => s.trim())
}

/** The path a `[[path|title]]` link names, or the text itself when it is not a link. */
export function linkPath(raw: string): string {
  const trimmed = raw.trim()
  const inner = trimmed.startsWith('[[') && trimmed.endsWith(']]') ? trimmed.slice(2, -2) : trimmed
  return inner.split('|')[0].split('#')[0].trim()
}

/** Lower case, accents off: « Échéancier » is found by typing « echeancier ». */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Stands for the documents that belong to no project, in a filter. */
export const NO_PROJECT = ':none'

export interface DocQuery {
  text: string
  /** '' for every project, `NO_PROJECT`, or a project's path. */
  project: string
  /** '' for every kind. */
  family: DocFamily | ''
}

/**
 * Whether a document answers a search: every word typed is found somewhere in its title,
 * its file's name, the names of its projects, its tags or what it says, whatever the case
 * and accents. `content` gives what it says, already folded.
 */
export function matchesDoc(
  doc: LibraryDoc,
  query: DocQuery,
  projectTitle: (path: string) => string,
  content: (doc: LibraryDoc) => string = () => ''
): boolean {
  if (query.family && familyOf(doc.file || doc.title) !== query.family) return false
  if (query.project === NO_PROJECT) {
    if (doc.projects.length) return false
  } else if (query.project && !doc.projects.includes(query.project)) return false
  const words = fold(query.text).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const name = doc.file.slice(doc.file.lastIndexOf('/') + 1)
  const haystack = fold([doc.title, name, ...doc.projects.map(projectTitle), ...doc.tags].join('\n'))
  if (words.every((word) => haystack.includes(word))) return true
  const text = content(doc)
  return !!text && words.every((word) => haystack.includes(word) || text.includes(word))
}

export type DocSort = 'added' | 'title'

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' })

/** The latest in first, or by title as a person would file them: « Lot 2 » before « Lot 10 ». */
export function sortDocs(docs: LibraryDoc[], by: DocSort): LibraryDoc[] {
  const byTitle = (a: LibraryDoc, b: LibraryDoc): number =>
    collator.compare(a.title, b.title) || a.record.localeCompare(b.record)
  return [...docs].sort((a, b) => (by === 'title' ? byTitle(a, b) : b.added.localeCompare(a.added) || byTitle(a, b)))
}

/** The fingerprint of a file's bytes, in hexadecimal. */
export async function fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
