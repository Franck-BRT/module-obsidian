import { normalizePath, TFile, type App } from 'obsidian'
import { sanitizeFileName } from '../../utils'
import { DOCS_FOLDER_NAME, freePath } from '../DocumentStore'
import { refLink } from '../refs'
import { ensureFolder } from '../vaultFs'
import { previousVersion } from './docVersions'
import { ghostContent, ghostTarget, isGhost, type LibraryGhost } from './libraryGhost'
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
  fold,
  isLibraryDoc,
  linkPath,
  nextCollections,
  HAND_FIELDS,
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
  /** A ghost's line, for whoever opens its note: where the document it stands for is. */
  ghostLine?: (link: string, folder: string) => string
}

/** A ghost of the library, with the document it stands for — none when that is gone. */
export interface GhostEntry {
  ghost: LibraryGhost
  doc: LibraryDoc | undefined
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
  /** The collections every poured document is gathered in; one already there is added to them. */
  collections?: string[]
  /**
   * A document already in the library, poured into another folder than its own, leaves a
   * ghost there — when that folder was chosen, not merely the library's root by default.
   */
  ghosts?: boolean
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
  /** Documents already there, poured into another folder, with the ghost left there for each. */
  ghosts?: { doc: LibraryDoc; ghost: string }[]
}

/** The collections a pour gathers its documents in: named once each, blanks left out. */
function collectionsOf(options: PourOptions): string[] {
  const out: string[] = []
  for (const name of options.collections ?? []) {
    const clean = name.trim()
    if (clean && !out.some((one) => fold(one) === fold(clean))) out.push(clean)
  }
  return out
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
      ...(typeof fm.language === 'string' && fm.language.trim() ? { language: fm.language.trim() } : {}),
      ...(text(fm.reference ?? fm['référence']) ? { reference: text(fm.reference ?? fm['référence']) } : {}),
      ...(text(fm.edition ?? fm['édition']) ? { edition: text(fm.edition ?? fm['édition']) } : {}),
      ...(text(fm.revision ?? fm['révision']) ? { revision: text(fm.revision ?? fm['révision']) } : {}),
      ...(typeof fm.source === 'string' && this.resolve(fm.source, record.path)
        ? { source: this.resolve(fm.source, record.path)?.path }
        : {})
    }
  }

  /**
   * The document a document was made from — the Word document of a PDF —, or none: written
   * in its record, as a link to the other's. The other's own link back, which would make a
   * loop, is taken off.
   */
  async setSource(doc: LibraryDoc, source: LibraryDoc | null): Promise<void> {
    if (source?.record === doc.record) return
    if (source?.source === doc.record) {
      const back = this.app.vault.getAbstractFileByPath(source.record)
      if (back instanceof TFile) {
        await this.app.fileManager.processFrontMatter(back, (fm: Record<string, unknown>) => {
          delete fm.source
        })
      }
    }
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!(record instanceof TFile)) return
    await this.app.fileManager.processFrontMatter(record, (fm: Record<string, unknown>) => {
      if (source) fm.source = `[[${source.record.replace(/\.md$/, '')}]]`
      else delete fm.source
    })
  }

  /**
   * The fields filled in by hand — reference, edition, revision — written into a record that
   * lacks them, empty, so Obsidian's properties show where they go: records made before
   * them have none.
   */
  async ensureHandFields(doc: LibraryDoc): Promise<void> {
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!(record instanceof TFile)) return
    const fm = this.app.metadataCache.getFileCache(record)?.frontmatter ?? {}
    const missing = HAND_FIELDS.filter((key) => !(key in fm))
    if (!missing.length) return
    await this.app.fileManager.processFrontMatter(record, (fields: Record<string, unknown>) => {
      for (const key of missing) if (!(key in fields)) fields[key] = ''
    })
  }

  /** The language a document is in, said in its record; '' to say it is not known. */
  async setLanguage(doc: LibraryDoc, language: string): Promise<void> {
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!(record instanceof TFile)) return
    await this.app.fileManager.processFrontMatter(record, (fm: Record<string, unknown>) => {
      if (language) fm.language = language
      else delete fm.language
    })
  }

  /**
   * Two documents said to be the same one in two languages: each with its language, the
   * other linked to the first — or to the one the first is itself a translation of, so that
   * all the languages of a document hang together on one.
   */
  async linkLanguages(doc: LibraryDoc, other: LibraryDoc, language: string, otherLanguage: string): Promise<void> {
    if (doc.record === other.record) return
    const source = doc.translationOf && doc.translationOf !== other.record ? doc.translationOf : doc.record
    await this.setLanguage(doc, language)
    // The other was the one the rest hung on: they hang on the new one now, with it.
    for (const one of this.docs().filter((each) => each.translationOf === other.record)) {
      await this.setTranslationOfRecord(one, source)
    }
    if (doc.translationOf === other.record) await this.setTranslationOfRecord(doc, null)
    const target = this.app.vault.getAbstractFileByPath(other.record)
    if (!(target instanceof TFile)) return
    await this.app.fileManager.processFrontMatter(target, (fm: Record<string, unknown>) => {
      fm.translationOf = `[[${source.replace(/\.md$/, '')}]]`
      if (otherLanguage) fm.language = otherLanguage
    })
  }

  /** A document taken out of its languages: no longer linked, nor anything linked to it. */
  async unlinkLanguages(doc: LibraryDoc): Promise<void> {
    if (doc.translationOf) {
      await this.setTranslationOfRecord(doc, null)
      return
    }
    // The one the others hung on: the first of them takes its place.
    const others = this.docs().filter((one) => one.translationOf === doc.record)
    const [first, ...rest] = others
    if (!first) return
    await this.setTranslationOfRecord(first, null)
    for (const one of rest) await this.setTranslationOfRecord(one, first.record)
  }

  private async setTranslationOfRecord(doc: LibraryDoc, source: string | null): Promise<void> {
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!(record instanceof TFile)) return
    await this.app.fileManager.processFrontMatter(record, (fm: Record<string, unknown>) => {
      if (source) fm.translationOf = `[[${source.replace(/\.md$/, '')}]]`
      else delete fm.translationOf
    })
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
          const collections = options.collections?.length
            ? nextCollections(known, new Set(options.collections), new Set())
            : (known.collections ?? [])
          if (collections.length !== (known.collections ?? []).length) await this.setCollections(known, collections)
          const updated = { ...known, ...filed, projects, collections }
          byHash.set(hash, updated)
          if (known.file) byFile.set(known.file, updated)
          if (!report.known.includes(known.record)) report.known.push(known.record)
          // Wanted in another folder than its own: a ghost of it there, not a copy.
          if (options.ghosts) {
            const ghost = await this.addGhost(updated, options.folder ?? '')
            if (ghost) (report.ghosts ??= []).push({ doc: updated, ghost })
          }
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
          ...filed,
          collections: collectionsOf(options)
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
      ...filed,
      collections: collectionsOf(options)
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
    // Its ghosts have nothing left to stand for.
    for (const { ghost } of this.ghostsOf(doc)) await this.removeGhost(ghost)
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
    // A ghost of it in the folder it has come to has nothing to say any more.
    for (const { ghost } of this.ghostsOf(doc)) if (ghost.folder === subfolder) await this.removeGhost(ghost)
    return moves
  }

  /**
   * A document given another title, and its record and file named after it, where they
   * are — the file whether the library keeps it or only records it, Obsidian taking the
   * links to it along —; its ghosts say the new title too. Returns the files moved, by the
   * path they had, for the registers that follow them; none when the title says nothing.
   */
  async rename(doc: LibraryDoc, title: string): Promise<Moves> {
    const moves: Moves = new Map()
    const clean = title.replace(/\s+/g, ' ').trim()
    const name = fileNameOf(clean)
    const record = this.app.vault.getAbstractFileByPath(doc.record)
    if (!clean || !name || !(record instanceof TFile)) return moves
    const ghosts = this.ghostsOf(doc)
    await this.app.fileManager.processFrontMatter(record, (fm: Record<string, unknown>) => {
      fm.title = clean
    })
    if (record.basename !== name) {
      const from = record.path
      await this.app.fileManager.renameFile(
        record,
        await freePath(this.app, record.parent?.path ?? this.root, name, 'md')
      )
      moves.set(from, record.path)
    }
    const file = doc.file ? this.app.vault.getAbstractFileByPath(doc.file) : null
    if (file instanceof TFile && file.basename !== name) {
      const from = file.path
      const folder = file.parent?.path ?? ''
      await this.app.fileManager.renameFile(file, await freePath(this.app, folder, name, file.extension))
      moves.set(from, file.path)
      await this.pointAt(record, file.path)
    }
    // Its ghosts written again: the new title, and the record where it now is.
    const line = this.ghostLine()
    for (const { ghost } of ghosts) {
      const note = this.app.vault.getAbstractFileByPath(ghost.record)
      if (!(note instanceof TFile)) continue
      await this.app.vault.modify(
        note,
        ghostContent({ record: record.path, title: clean, hash: doc.hash, folder: doc.folder }, { line })
      )
    }
    return moves
  }

  /** Every ghost of the library, with the document each stands for. */
  ghosts(docs: LibraryDoc[] = this.docs()): GhostEntry[] {
    const byRecord = new Map(docs.map((doc) => [doc.record, doc]))
    const out: GhostEntry[] = []
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter
      if (!isGhost(fm) || !fm || !file.path.startsWith(`${this.root}/`)) continue
      const link = typeof fm.of === 'string' ? fm.of : ''
      const linked = link ? this.resolve(link, file.path) : null
      const hash = typeof fm.sha256 === 'string' ? fm.sha256 : ''
      const dir = file.path.slice(0, Math.max(0, file.path.lastIndexOf('/')))
      out.push({
        ghost: {
          record: file.path,
          folder: dir.startsWith(`${this.root}/`) ? dir.slice(this.root.length + 1) : '',
          link,
          hash,
          title: typeof fm.title === 'string' ? fm.title : file.basename
        },
        doc: ghostTarget({ hash }, linked ? byRecord.get(linked.path) : undefined, docs)
      })
    }
    return out
  }

  /** The ghosts of one document, in the folders it is shown in without being there. */
  ghostsOf(doc: LibraryDoc): GhostEntry[] {
    // By its record, or — the record moved since — by its fingerprint, which one document alone has.
    return this.ghosts().filter(
      (entry) => entry.doc?.record === doc.record || (!!doc.hash && (entry.doc?.hash ?? entry.ghost.hash) === doc.hash)
    )
  }

  /**
   * A ghost of a document left in a folder of the library — '' for its root —; its note's
   * path, or null when the document is there already, or has a ghost there already.
   */
  async addGhost(doc: LibraryDoc, subfolder: string): Promise<string | null> {
    if (doc.folder === subfolder) return null
    if (this.ghostsOf(doc).some(({ ghost }) => ghost.folder === subfolder)) return null
    const target = this.pathOf(subfolder)
    await ensureFolder(this.app, target)
    const name = doc.record.slice(doc.record.lastIndexOf('/') + 1).replace(/\.md$/, '')
    const note = await this.app.vault.create(
      await freePath(this.app, target, name, 'md'),
      ghostContent(doc, { line: this.ghostLine() })
    )
    return note.path
  }

  private ghostLine(): (link: string, folder: string) => string {
    return this.words().ghostLine ?? ((link, folder) => `${link} — ${folder || '/'}`)
  }

  async removeGhost(ghost: LibraryGhost): Promise<void> {
    const note = this.app.vault.getAbstractFileByPath(ghost.record)
    if (note instanceof TFile) await this.app.fileManager.trashFile(note)
  }

  /**
   * A document many folders need, put in the folder of reference — '' for the root —: moved
   * there, the folder it was in keeping a ghost of it. Returns the files moved.
   */
  async toReference(doc: LibraryDoc, reference: string): Promise<Moves> {
    if (doc.folder === reference) return new Map()
    const from = doc.folder
    const moves = await this.moveTo(doc, reference)
    const moved: LibraryDoc = {
      ...doc,
      record: moves.get(doc.record) ?? doc.record,
      file: (doc.file && moves.get(doc.file)) || doc.file,
      folder: reference
    }
    await this.addGhost(moved, from)
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

/**
 * A title made a file's name: what a file name cannot hold, and what Obsidian's links would
 * read as something else (`#`, `^`, `[`, `]`, `|`), made spaces; no dot nor space at either end.
 */
export function fileNameOf(title: string): string {
  return title
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
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
