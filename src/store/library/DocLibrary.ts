import { normalizePath, TFile, type App } from 'obsidian'
import { sanitizeFileName } from '../../utils'
import { DOCS_FOLDER_NAME, freePath } from '../DocumentStore'
import { refLink } from '../refs'
import { ensureFolder } from '../vaultFs'
import { previousVersion } from './docVersions'
import {
  dissolveSubfolder,
  folderPath,
  makeSubfolder,
  renameSubfolder,
  subfolders,
  type Moves
} from '../libraryFolders'
import { cleanTags, guessCategory, mergeClassification, type Category, type Classification } from './libraryClass'
import {
  baseNameOf,
  extensionOf,
  fingerprint,
  isLibraryDoc,
  linkPath,
  recordContent,
  stringList,
  titleFromName,
  type LibraryDoc
} from './libraryDoc'

/**
 * The document library: every file poured into it, whatever project it belongs to.
 *
 * A file brought from the computer is copied into the library's own files folder. A file
 * already in the vault stays where it is unless the reader asks for it to be moved in —
 * and one filed into a project's documents is never moved, since its register points at
 * it by path. Either way the library writes a record for it, which is where its projects
 * are said.
 *
 * The same bytes are poured once: a document already there is recognised by its
 * fingerprint, and pouring it again only adds the projects it did not have yet.
 */

export interface LibraryWords {
  /** The folder the files brought in are kept in, inside the library's. */
  filesFolder: string
  /** The heading over the reader's own notes in a record. */
  notesHeading: string
}

/** One thing to pour: a file already in the vault, or bytes brought from outside. */
export type PourItem = ({ kind: 'vault'; file: TFile } | { kind: 'bytes'; name: string; bytes: Uint8Array }) & {
  /** Its own title, rather than its file's name: a register document poured in keeps the register's. */
  title?: string
  /** Projects of its own, on top of those the whole pour is given. */
  projects?: string[]
  /** How it is filed, on top of what the whole pour is given. */
  classification?: Partial<Classification>
}

export interface PourOptions {
  /** The projects every poured document belongs to, by their notes' paths. */
  projects: string[]
  /** Move vault files into the library's folder rather than leave them where they are. */
  move: boolean
  /** The day, YYYY-MM-DD, the documents are recorded as having come in. */
  today: string
  /** How they are filed; an empty category is guessed from each one's name. */
  classification?: Partial<Classification>
  /** The categories a name is recognised against. */
  categories?: Category[]
  /** The library's folder the new documents go in, by its path under the library's; '' or none for its root. */
  folder?: string
}

export interface PourReport {
  /** Records written, one a new document. */
  added: string[]
  /** The new documents as the library reads them — before Obsidian has, a moment after. */
  docs: LibraryDoc[]
  /** Documents that were already there, by their records; the projects were added to them. */
  known: string[]
  failed: { name: string; reason: string }[]
  /**
   * New documents that look like another issue of one already there — the same name, other
   * bytes —, with that one: linked as its version once the reader says so.
   */
  versions: { doc: LibraryDoc; previous: LibraryDoc }[]
}

export class DocLibrary {
  constructor(
    private app: App,
    private folder: () => string,
    private words: () => LibraryWords,
    private projectTitle: (path: string) => string
  ) {}

  get root(): string {
    return normalizePath(this.folder())
  }

  get filesFolder(): string {
    return this.filesOf('')
  }

  /** A folder of the library, as a vault path: '' is the library's root. */
  pathOf(subfolder: string): string {
    return folderPath(this.root, subfolder)
  }

  /** Where the files a folder's documents were brought with are kept: beside their records. */
  filesOf(subfolder: string): string {
    return normalizePath(`${this.pathOf(subfolder)}/${this.words().filesFolder}`)
  }

  /** The library's folders, however deep, by their paths under its own — its files folders left out. */
  folders(): string[] {
    const files = this.words().filesFolder
    return subfolders(this.app, this.root, (name) => name.startsWith('.') || name === files)
  }

  /**
   * Makes a folder in the library — under another of its folders, or at its root —; returns
   * its path under the library's, or '' when the name holds nothing to make.
   */
  createFolder(name: string, under = ''): Promise<string> {
    return makeSubfolder(this.app, this.root, name, under)
  }

  /**
   * Whether the library keeps a document's file itself — brought in, or moved in, into one
   * of its files folders —, rather than only recording it where it lives.
   */
  holdsFile(doc: LibraryDoc): boolean {
    if (!doc.file.startsWith(`${this.root}/`)) return false
    return doc.file
      .slice(this.root.length + 1)
      .split('/')
      .slice(0, -1)
      .includes(this.words().filesFolder)
  }

  /** Every document in the library, wherever its record has been moved to. */
  docs(): LibraryDoc[] {
    const docs: LibraryDoc[] = []
    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter
      if (isLibraryDoc(frontmatter)) docs.push(this.readRecord(file, frontmatter as Record<string, unknown>))
    }
    return docs
  }

  isRecord(file: TFile): boolean {
    return file.extension === 'md' && isLibraryDoc(this.app.metadataCache.getFileCache(file)?.frontmatter)
  }

  /**
   * Whether a vault file is a document to pour: not hidden, and not one of the plugin's
   * own notes — a project, a ticket, a conversation, a record — which a folder poured
   * whole would otherwise bring in by the hundred.
   */
  pourable(file: TFile): boolean {
    if (file.name.startsWith('.')) return false
    if (file.extension !== 'md') return true
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}
    return !Object.keys(frontmatter).some((key) => key.startsWith('pm-'))
  }

  private readRecord(record: TFile, fm: Record<string, unknown>): LibraryDoc {
    const file = typeof fm.file === 'string' ? this.resolve(fm.file, record.path) : null
    const projects = stringList(fm.projects)
      .map((raw) => this.resolve(raw, record.path)?.path)
      .filter((path): path is string => !!path)
    const dir = record.path.slice(0, Math.max(0, record.path.lastIndexOf('/')))
    return {
      record: record.path,
      folder: dir.startsWith(`${this.root}/`) ? dir.slice(this.root.length + 1) : '',
      title: typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : record.basename,
      file: file?.path ?? '',
      projects: [...new Set(projects)],
      added: typeof fm.added === 'string' ? fm.added : '',
      size: typeof fm.size === 'number' ? fm.size : 0,
      hash: typeof fm.sha256 === 'string' ? fm.sha256 : '',
      category: text(fm.category),
      lot: text(fm.lot),
      issuer: text(fm.issuer),
      tags: cleanTags(stringList(fm.tags)),
      collections: [...new Set(stringList(fm.collections))],
      ...(typeof fm.previous === 'string' && this.resolve(fm.previous, record.path)
        ? { previous: this.resolve(fm.previous, record.path)?.path }
        : {}),
      ...(typeof fm.translationOf === 'string' && this.resolve(fm.translationOf, record.path)
        ? { translationOf: this.resolve(fm.translationOf, record.path)?.path }
        : {}),
      ...(typeof fm.language === 'string' && fm.language.trim() ? { language: fm.language.trim() } : {})
    }
  }

  /** Says which document this one is the translation of, and in which language: in its record. */
  async setTranslationOf(doc: LibraryDoc, source: LibraryDoc, language: string): Promise<void> {
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!(record instanceof TFile)) return
    await this.app.fileManager.processFrontMatter(record, (fm: Record<string, unknown>) => {
      fm.translationOf = `[[${source.record.replace(/\.md$/, '')}]]`
      fm.language = language
    })
  }

  /**
   * Says which version a document follows — the issue before it —, or that it follows
   * none: written in its record, as a link to the other's.
   */
  async setPrevious(doc: LibraryDoc, previous: LibraryDoc | null): Promise<void> {
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!(record instanceof TFile)) return
    await this.app.fileManager.processFrontMatter(record, (fm: Record<string, unknown>) => {
      if (previous) fm.previous = `[[${previous.record.replace(/\.md$/, '')}]]`
      else delete fm.previous
    })
  }

  /** The file a link names: as Obsidian finds it, or by its full path. */
  private resolve(raw: string, from: string): TFile | null {
    const path = linkPath(raw)
    if (!path) return null
    const found = this.app.metadataCache.getFirstLinkpathDest(path, from)
    if (found) return found
    const direct = this.app.vault.getAbstractFileByPath(normalizePath(path))
    return direct instanceof TFile ? direct : null
  }

  /**
   * Pours files into the library, the given projects on each. `onProgress` is told after
   * each one, so a long pour can say how far it has got.
   */
  async pour(
    items: PourItem[],
    options: PourOptions,
    onProgress?: (done: number, total: number) => void
  ): Promise<PourReport> {
    const report: PourReport = { added: [], docs: [], known: [], failed: [], versions: [] }
    const existing = this.docs()
    const byHash = new Map(existing.filter((doc) => doc.hash).map((doc) => [doc.hash, doc]))
    const byFile = new Map(existing.filter((doc) => doc.file).map((doc) => [doc.file, doc]))

    for (const [at, item] of items.entries()) {
      const name = item.kind === 'vault' ? item.file.name : item.name
      try {
        let known = item.kind === 'vault' ? byFile.get(item.file.path) : undefined
        const bytes = item.kind === 'vault' ? new Uint8Array(await this.app.vault.readBinary(item.file)) : item.bytes
        const hash = await fingerprint(bytes)
        known ??= byHash.get(hash)
        if (known) {
          const projects = await this.addProjects(known, [...options.projects, ...(item.projects ?? [])])
          // Poured again, it keeps how it was filed; only what it lacked is given.
          const filed = await this.fillClassification(known, this.classificationFor(item, name, options))
          const updated = { ...known, ...filed, projects }
          byHash.set(hash, updated)
          if (known.file) byFile.set(known.file, updated)
          if (!report.known.includes(known.record)) report.known.push(known.record)
        } else {
          const doc = await this.addNew(item, bytes, hash, options)
          // Another issue of a document already there — « ind B » after « ind A » —: said, to be asked.
          const before = previousVersion(doc, [...existing, ...report.docs])
          const previous = before
            ? [...existing, ...report.docs].find((one) => one.record === before.record)
            : undefined
          if (previous) report.versions.push({ doc, previous })
          byHash.set(hash, doc)
          if (doc.file) byFile.set(doc.file, doc)
          report.added.push(doc.record)
          report.docs.push(doc)
        }
      } catch (error) {
        report.failed.push({ name, reason: error instanceof Error ? error.message : String(error) })
      }
      onProgress?.(at + 1, items.length)
    }
    return report
  }

  private async addNew(item: PourItem, bytes: Uint8Array, hash: string, options: PourOptions): Promise<LibraryDoc> {
    const name = item.kind === 'vault' ? item.file.name : item.name
    const clean = sanitizeFileName(baseNameOf(name)).trim() || 'document'
    const ext = extensionOf(name)

    const folder = options.folder ?? ''
    const filesFolder = this.filesOf(folder)
    let file: TFile
    if (item.kind === 'bytes') {
      await ensureFolder(this.app, filesFolder)
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      file = await this.app.vault.createBinary(await freePath(this.app, filesFolder, clean, ext), data)
    } else {
      file = item.file
      if (options.move && this.movable(file)) {
        await ensureFolder(this.app, filesFolder)
        await this.app.fileManager.renameFile(file, await freePath(this.app, filesFolder, clean, ext))
      }
    }

    const recordFolder = this.pathOf(folder)
    await ensureFolder(this.app, recordFolder)
    const recordPath = await freePath(this.app, recordFolder, clean, 'md')
    const title = item.title?.trim() || titleFromName(name)
    const projects = [...new Set([...options.projects, ...(item.projects ?? [])])]
    const filed = mergeClassification(
      { category: '', lot: '', issuer: '', tags: [] },
      this.classificationFor(item, name, options)
    )
    const record = await this.app.vault.create(
      recordPath,
      recordContent(
        {
          title,
          fileLink: `[[${file.path}]]`,
          projectLinks: projects.map((path) => this.projectLink(path, recordPath)),
          added: options.today,
          size: bytes.byteLength,
          hash,
          ...filed
        },
        this.words().notesHeading
      )
    )
    return {
      record: record.path,
      folder: recordFolder === this.root ? '' : recordFolder.slice(this.root.length + 1),
      title,
      file: file.path,
      projects,
      added: options.today,
      size: bytes.byteLength,
      hash,
      ...filed
    }
  }

  /** What a poured file is filed as: what was given, its category guessed from its name when none was. */
  private classificationFor(item: PourItem, name: string, options: PourOptions): Partial<Classification> {
    const given = options.classification ?? {}
    const own = item.classification ?? {}
    // Its title says what it is as well as its file's name does, often better.
    const category =
      given.category?.trim() ||
      own.category?.trim() ||
      guessCategory(`${item.title ?? ''} ${name}`, options.categories ?? [])
    return {
      category,
      lot: given.lot?.trim() || own.lot,
      issuer: given.issuer?.trim() || own.issuer,
      tags: [...(given.tags ?? []), ...(own.tags ?? [])]
    }
  }

  /** Gives a document the fields it had left empty, and the tags it lacked; returns how it is filed. */
  private async fillClassification(doc: LibraryDoc, given: Partial<Classification>): Promise<Classification> {
    const current = { category: doc.category, lot: doc.lot, issuer: doc.issuer, tags: doc.tags }
    const filled = mergeClassification(current, {
      category: current.category ? '' : given.category,
      lot: current.lot ? '' : given.lot,
      issuer: current.issuer ? '' : given.issuer,
      tags: given.tags
    })
    if (JSON.stringify(filled) !== JSON.stringify(current)) await this.writeClassification(doc, filled)
    return filled
  }

  /**
   * Files a document: the fields given replace what it had, the empty ones leave it, and
   * tags are added to — so a lot given to forty documents at once wipes none of their categories.
   */
  async classify(doc: LibraryDoc, given: Partial<Classification>): Promise<void> {
    await this.writeClassification(
      doc,
      mergeClassification({ category: doc.category, lot: doc.lot, issuer: doc.issuer, tags: doc.tags }, given)
    )
  }

  /** Files a document exactly so: every field, tags included, as given. */
  async setClassification(doc: LibraryDoc, filed: Classification): Promise<void> {
    await this.writeClassification(doc, { ...filed, tags: cleanTags(filed.tags) })
  }

  /** Takes tags off a document. */
  async untag(doc: LibraryDoc, tags: string[]): Promise<void> {
    const off = new Set(tags.map((tag) => tag.toLowerCase()))
    await this.writeClassification(doc, {
      category: doc.category,
      lot: doc.lot,
      issuer: doc.issuer,
      tags: doc.tags.filter((tag) => !off.has(tag.toLowerCase()))
    })
  }

  private async writeClassification(doc: LibraryDoc, filed: Classification): Promise<void> {
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!(record instanceof TFile)) return
    await this.app.fileManager.processFrontMatter(record, (fm: Record<string, unknown>) => {
      fm.category = filed.category
      fm.lot = filed.lot
      fm.issuer = filed.issuer
      fm.tags = filed.tags
    })
  }

  /**
   * Whether a vault file may be moved into the library: not already under it, and not one
   * a project's documents keep, whose register names it by path.
   */
  movable(file: TFile): boolean {
    if (file.path.startsWith(`${this.root}/`)) return false
    return !file.path.split('/').includes(DOCS_FOLDER_NAME)
  }

  private projectLink(path: string, from: string): string {
    return refLink(this.app, path, this.projectTitle(path), from)
  }

  /** Says which collections a document is gathered in, replacing what its record said; none, the property goes. */
  async setCollections(doc: LibraryDoc, collections: string[]): Promise<void> {
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!(record instanceof TFile)) return
    const names = [...new Set(collections.map((name) => name.trim()).filter(Boolean))]
    await this.app.fileManager.processFrontMatter(record, (fm: Record<string, unknown>) => {
      if (names.length) fm.collections = names
      else delete fm.collections
    })
  }

  /** Gives a document the projects it did not have yet; returns all of them. */
  async addProjects(doc: LibraryDoc, projects: string[]): Promise<string[]> {
    const missing = projects.filter((path) => !doc.projects.includes(path))
    if (!missing.length) return doc.projects
    const all = [...doc.projects, ...missing]
    await this.setProjects(doc, all)
    return all
  }

  /** Says which projects a document belongs to, replacing what its record said. */
  async setProjects(doc: LibraryDoc, projects: string[]): Promise<void> {
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!(record instanceof TFile)) return
    const links = [...new Set(projects)].map((path) => this.projectLink(path, record.path))
    await this.app.fileManager.processFrontMatter(record, (fm: Record<string, unknown>) => {
      fm.projects = links
    })
  }

  /**
   * Takes a document out of the library: its record goes to the trash, and its file with
   * it when the library brought the file in. A file that was only recorded where it lives
   * is left there.
   */
  async remove(doc: LibraryDoc): Promise<void> {
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (record instanceof TFile) await this.app.fileManager.trashFile(record)
    const file = doc.file ? this.app.vault.getAbstractFileByPath(doc.file) : null
    if (file instanceof TFile && this.holdsFile(doc)) await this.app.fileManager.trashFile(file)
  }

  /**
   * Moves a document into a folder of the library — '' for its root —: its record, never
   * over another, and the file with it when the library keeps it, into the folder's files.
   * A file only recorded where it lives stays there. Returns the files moved, by the path
   * they had, for the registers that follow them to be told.
   */
  async moveTo(doc: LibraryDoc, subfolder: string): Promise<Moves> {
    const moves: Moves = new Map()
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!(record instanceof TFile)) return moves
    const target = this.pathOf(subfolder)
    if (record.parent?.path !== target) {
      await ensureFolder(this.app, target)
      const from = record.path
      await this.app.fileManager.renameFile(record, await freePath(this.app, target, record.basename, 'md'))
      moves.set(from, record.path)
    }
    const file = doc.file ? this.app.vault.getAbstractFileByPath(doc.file) : null
    const files = this.filesOf(subfolder)
    if (file instanceof TFile && this.holdsFile(doc) && file.parent?.path !== files) {
      await ensureFolder(this.app, files)
      const from = file.path
      await this.app.fileManager.renameFile(file, await freePath(this.app, files, file.basename, file.extension))
      moves.set(from, file.path)
      await this.pointAt(record, file.path)
    }
    return moves
  }

  /**
   * Renames one of the library's folders, where it is. Returns its new path under the
   * library's and the files moved with it — or null when the name holds nothing, or
   * another folder has it.
   */
  async renameFolder(subfolder: string, name: string): Promise<{ folder: string; moves: Moves } | null> {
    const before = this.docs()
    const renamed = await renameSubfolder(this.app, this.root, subfolder, name)
    if (renamed) await this.relink(before, renamed.moves)
    return renamed
  }

  /**
   * Takes a folder out of the library: its documents and folders go up into the one it is
   * in, the files it keeps into that folder's files. Returns the files moved.
   */
  async deleteFolder(subfolder: string): Promise<Moves> {
    const before = this.docs()
    const files = this.words().filesFolder
    const moves = await dissolveSubfolder(this.app, this.root, subfolder, (name) => name === files)
    await this.relink(before, moves)
    return moves
  }

  /**
   * The records whose files were moved made to name them where they now are — whatever
   * Obsidian's own setting on links: a record must find its file.
   */
  private async relink(docs: LibraryDoc[], moves: Moves): Promise<void> {
    for (const doc of docs) {
      const file = doc.file ? moves.get(doc.file) : undefined
      if (!file) continue
      const record = this.app.vault.getAbstractFileByPath(moves.get(doc.record) ?? doc.record)
      if (record instanceof TFile) await this.pointAt(record, file)
    }
  }

  private async pointAt(record: TFile, file: string): Promise<void> {
    const link = `[[${file}]]`
    await this.app.fileManager.processFrontMatter(record, (fm: Record<string, unknown>) => {
      if (fm.file !== link) fm.file = link
    })
  }
}

/** A frontmatter field as text: a number written bare in YAML — a lot « 2 » — read as one too. */
function text(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'number') return String(raw)
  return ''
}

/**
 * A file of the vault by its path, however its accented letters were written: a Mac writes
 * « é » as « e » and an accent where the path was written with one letter, and the other
 * way round — two paths that read the same and differ.
 */
export function findVaultFile(app: App, path: string): TFile | null {
  for (const candidate of new Set([path, path.normalize('NFC'), path.normalize('NFD')])) {
    const found = app.vault.getAbstractFileByPath(normalizePath(candidate))
    if (found instanceof TFile) return found
  }
  return null
}
