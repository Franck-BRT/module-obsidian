import { stringifyYaml } from 'obsidian'
import { AT_ROOT, inFolder } from '../folderFilter'

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
  /** What kind of document it is — plan, planning, report —, from the reader's list. */
  category: string
  /** The lot or package it belongs to. */
  lot: string
  /** Who issued it: a firm, a person. */
  issuer: string
  tags: string[]
  /** The collections it is gathered in — sets of documents a search can be held to —, by their names. */
  collections?: string[]
  /** The library's folder its record is in, by its path under the library's; '' at its root, or outside it. */
  folder: string
  /** The version it follows — the issue before it —, by its record's path; absent when none. */
  previous?: string
  /** The document it is a translation of, by its record's path; absent when none. */
  translationOf?: string
  /**
   * The documents it was made from — the Word document and the workbook a PDF was printed
   * from —, by their records' paths.
   */
  sources?: string[]
  /** Its reference, as its issuer numbers it: « DLA-NM-0000000-01-PSP ». */
  reference?: string
  /** Its edition and its revision within it: « 2 » and « 15 ». */
  edition?: string
  revision?: string
  /** Its reference, edition and revision were looked for in what it says, once: not again. */
  identityRead?: boolean
  /** The language it is in, as a code — set on a translation —; absent when not known. */
  language?: string
}

export type DocFamily = 'pdf' | 'word' | 'sheet' | 'slides' | 'image' | 'mail' | 'note' | 'other'

export const DOC_FAMILIES: DocFamily[] = ['pdf', 'word', 'sheet', 'slides', 'image', 'mail', 'note', 'other']

const FAMILY_OF: Record<string, DocFamily> = {
  pdf: 'pdf',
  doc: 'word',
  dot: 'word',
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
  result: 'note',
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
  category?: string
  lot?: string
  issuer?: string
  tags?: string[]
  collections?: string[]
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
    // Written even empty, so Obsidian's properties show where they are to be filled.
    category: fields.category ?? '',
    lot: fields.lot ?? '',
    issuer: fields.issuer ?? '',
    reference: '',
    edition: '',
    revision: '',
    tags: fields.tags ?? [],
    ...(fields.collections?.length ? { collections: fields.collections } : {})
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

/** Whether a document is gathered in a collection, the name's case and accents aside. */
export function inCollection(doc: Pick<LibraryDoc, 'collections'>, name: string): boolean {
  return (doc.collections ?? []).some((one) => fold(one) === fold(name))
}

/** The collections the library's documents are gathered in, by name, the fullest first. */
export function collectionNames(docs: Pick<LibraryDoc, 'collections'>[]): string[] {
  const counts = new Map<string, number>()
  for (const doc of docs) for (const name of doc.collections ?? []) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name)
}

/** The collections each document gets: those ticked added, those unticked taken off, the others left. */
export function nextCollections(
  doc: Pick<LibraryDoc, 'collections'>,
  ticked: Set<string>,
  unticked: Set<string>
): string[] {
  const kept = (doc.collections ?? []).filter((name) => ![...unticked].some((off) => fold(off) === fold(name)))
  for (const name of ticked) if (!kept.some((one) => fold(one) === fold(name))) kept.push(name)
  return kept
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
  /** '' for any; `NO_VALUE` for documents that have none. */
  category?: string
  lot?: string
  issuer?: string
  /** '' for any tag. */
  tag?: string
  /** '' for any collection; or a collection's name. */
  collection?: string
  /** '' for every folder, `AT_ROOT`, or a folder of the library — alone, its own folders with it when words are searched. */
  folder?: string
}

/** Stands for the documents a field was left empty on, in a filter. */
export const NO_VALUE = ':empty'

/** Whether a field's value answers its filter: any, none, or this one. */
function answers(value: string, wanted: string | undefined): boolean {
  if (!wanted) return true
  if (wanted === NO_VALUE) return !value
  return fold(value) === fold(wanted)
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
  if (!answers(doc.category, query.category) || !answers(doc.lot, query.lot) || !answers(doc.issuer, query.issuer)) {
    return false
  }
  if (query.tag && !doc.tags.some((tag) => fold(tag) === fold(query.tag ?? ''))) return false
  if (query.collection && !inCollection(doc, query.collection)) return false
  // A folder shows what is in it, not what its own folders hold — unless words are searched,
  // which look through them too.
  if (!inFolder(doc.folder, query.folder, !!query.text.trim())) return false
  const words = fold(query.text).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const name = doc.file.slice(doc.file.lastIndexOf('/') + 1)
  const haystack = fold(
    [
      doc.title,
      name,
      doc.reference ?? '',
      doc.category,
      doc.lot,
      doc.issuer,
      doc.folder,
      ...doc.projects.map(projectTitle),
      ...doc.tags
    ].join('\n')
  )
  if (words.every((word) => haystack.includes(word))) return true
  const text = content(doc)
  return !!text && words.every((word) => haystack.includes(word) || text.includes(word))
}

export type DocSort = 'added' | 'title' | 'category'

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' })

/** The latest in first, by title as a person would file them — « Lot 2 » before « Lot 10 » —, or by category. */
export function sortDocs(docs: LibraryDoc[], by: DocSort): LibraryDoc[] {
  const byTitle = (a: LibraryDoc, b: LibraryDoc): number =>
    collator.compare(a.title, b.title) || a.record.localeCompare(b.record)
  // By category, the uncategorised last, then by title within each.
  const byCategory = (a: LibraryDoc, b: LibraryDoc): number =>
    Number(!a.category) - Number(!b.category) || collator.compare(a.category, b.category) || byTitle(a, b)
  return [...docs].sort((a, b) =>
    by === 'title'
      ? byTitle(a, b)
      : by === 'category'
        ? byCategory(a, b)
        : b.added.localeCompare(a.added) || byTitle(a, b)
  )
}

/** The fingerprint of a file's bytes, in hexadecimal. */
export async function fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The search that shows these documents — just poured, or found already there —: the one
 * on screen when it shows them all; else one with nothing filtering them out, in their
 * folder when they share one, still narrowed to the project on screen when they are all in it.
 */
export function revealQuery(
  docs: LibraryDoc[],
  query: DocQuery,
  shows: (doc: LibraryDoc, query: DocQuery) => boolean
): DocQuery {
  if (!docs.length || docs.every((doc) => shows(doc, query))) return query
  const folders = new Set(docs.map((doc) => doc.folder))
  const [only] = folders
  const project = query.project && docs.every((doc) => doc.projects.includes(query.project)) ? query.project : ''
  return {
    text: '',
    project,
    family: '',
    category: '',
    lot: '',
    issuer: '',
    tag: '',
    collection: '',
    folder: folders.size === 1 ? only || AT_ROOT : ''
  }
}

/**
 * The same document in its other languages: the one translations are linked to, and every
 * one linked to it — this one left out. Links to a document no longer there lead nowhere.
 */
export function otherLanguages(doc: LibraryDoc, docs: LibraryDoc[]): LibraryDoc[] {
  const source = (doc.translationOf && docs.find((one) => one.record === doc.translationOf)) || doc
  return [source, ...docs.filter((one) => one.translationOf === source.record)].filter(
    (one, at, all) => one.record !== doc.record && all.findIndex((other) => other.record === one.record) === at
  )
}

/** The documents made from this one — the PDFs printed from a Word document. */
export function derivedFrom(doc: LibraryDoc, docs: LibraryDoc[]): LibraryDoc[] {
  return docs.filter((one) => (one.sources ?? []).includes(doc.record) && one.record !== doc.record)
}

/** A file's name without its folder nor its extension, folded: « Spec_v2.DOCX » and « spec_v2.pdf » agree. */
function bareName(doc: LibraryDoc): string {
  return fold(baseNameOf(doc.file || doc.title))
}

/** The kinds a document is edited in, whose PDF is what is sent. */
const EDITED: DocFamily[] = ['word', 'sheet', 'slides']

/**
 * The document this one was most likely made from, or made into, by their files' names:
 * a PDF and a Word, Excel or PowerPoint document of the same name. `source` is the one
 * edited, `derived` the PDF; null when there is no such pair, or it is linked already.
 */
export function likelyPair(doc: LibraryDoc, docs: LibraryDoc[]): { source: LibraryDoc; derived: LibraryDoc } | null {
  const name = bareName(doc)
  if (!name) return null
  const kind = familyOf(doc.file || doc.title)
  const twin = (wanted: (family: DocFamily) => boolean): LibraryDoc | undefined =>
    docs.find((one) => one.record !== doc.record && bareName(one) === name && wanted(familyOf(one.file || one.title)))
  if (kind === 'pdf') {
    const source = twin((family) => EDITED.includes(family))
    return source && !(doc.sources ?? []).includes(source.record) ? { source, derived: doc } : null
  }
  if (EDITED.includes(kind)) {
    const derived = twin((family) => family === 'pdf')
    return derived && !(derived.sources ?? []).includes(doc.record) ? { source: doc, derived } : null
  }
  return null
}

/**
 * The documents a source is picked among for this one: those of its name in another kind
 * first, then the rest — never itself, one of its sources already, nor one made from it,
 * which would make a loop.
 */
export function sourceCandidates(doc: LibraryDoc, docs: LibraryDoc[]): LibraryDoc[] {
  const name = bareName(doc)
  const kind = familyOf(doc.file || doc.title)
  const made = new Set([...derivedFrom(doc, docs).map((one) => one.record), ...(doc.sources ?? [])])
  const others = docs.filter((one) => one.record !== doc.record && !made.has(one.record))
  const alike = (one: LibraryDoc): boolean =>
    !!name && bareName(one) === name && familyOf(one.file || one.title) !== kind
  return [...others.filter(alike), ...others.filter((one) => !alike(one))]
}

/** The fields a record is filled in by hand, written even empty so Obsidian's properties show them. */
export const HAND_FIELDS = ['reference', 'edition', 'revision'] as const

/** Its version as people say it: « 2-15 » for edition 2, revision 15; the one given alone; '' for none. */
export function versionLabel(doc: Pick<LibraryDoc, 'edition' | 'revision'>): string {
  const edition = doc.edition?.trim() ?? ''
  const revision = doc.revision?.trim() ?? ''
  return edition && revision ? `${edition}-${revision}` : edition || revision
}

/** Whether a document's title holds every word searched, accents and case aside: the title alone. */
export function matchesTitle(doc: Pick<LibraryDoc, 'title'>, query: string): boolean {
  const title = fold(doc.title)
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => title.includes(word))
}

/** Whether a library folder is the reference one, or a folder inside it. */
export function inReference(folder: string, reference: string): boolean {
  return !!reference && (folder === reference || folder.startsWith(`${reference}/`))
}
