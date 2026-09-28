import { normalizePath, TFile, type App } from 'obsidian'
import { sanitizeFileName } from '../../utils'
import { DOCS_FOLDER_NAME, freePath } from '../DocumentStore'
import { refLink } from '../refs'
import { ensureFolder } from '../vaultFs'
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
export type PourItem = { kind: 'vault'; file: TFile } | { kind: 'bytes'; name: string; bytes: Uint8Array }

export interface PourOptions {
  /** The projects every poured document belongs to, by their notes' paths. */
  projects: string[]
  /** Move vault files into the library's folder rather than leave them where they are. */
  move: boolean
  /** The day, YYYY-MM-DD, the documents are recorded as having come in. */
  today: string
}

export interface PourReport {
  /** Records written, one a new document. */
  added: string[]
  /** Documents that were already there, by their records; the projects were added to them. */
  known: string[]
  failed: { name: string; reason: string }[]
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
    return normalizePath(`${this.root}/${this.words().filesFolder}`)
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
    return {
      record: record.path,
      title: typeof fm.title === 'string' && fm.title.trim() ? fm.title.trim() : record.basename,
      file: file?.path ?? '',
      projects: [...new Set(projects)],
      added: typeof fm.added === 'string' ? fm.added : '',
      size: typeof fm.size === 'number' ? fm.size : 0,
      hash: typeof fm.sha256 === 'string' ? fm.sha256 : '',
      tags: stringList(fm.tags)
    }
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
    const report: PourReport = { added: [], known: [], failed: [] }
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
          const projects = await this.addProjects(known, options.projects)
          const updated = { ...known, projects }
          byHash.set(hash, updated)
          if (known.file) byFile.set(known.file, updated)
          if (!report.known.includes(known.record)) report.known.push(known.record)
        } else {
          const doc = await this.addNew(item, bytes, hash, options)
          byHash.set(hash, doc)
          if (doc.file) byFile.set(doc.file, doc)
          report.added.push(doc.record)
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

    let file: TFile
    if (item.kind === 'bytes') {
      await ensureFolder(this.app, this.filesFolder)
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      file = await this.app.vault.createBinary(await freePath(this.app, this.filesFolder, clean, ext), data)
    } else {
      file = item.file
      if (options.move && this.movable(file)) {
        await ensureFolder(this.app, this.filesFolder)
        await this.app.fileManager.renameFile(file, await freePath(this.app, this.filesFolder, clean, ext))
      }
    }

    await ensureFolder(this.app, this.root)
    const recordPath = await freePath(this.app, this.root, clean, 'md')
    const title = titleFromName(name)
    const projects = [...new Set(options.projects)]
    const record = await this.app.vault.create(
      recordPath,
      recordContent(
        {
          title,
          fileLink: `[[${file.path}]]`,
          projectLinks: projects.map((path) => this.projectLink(path, recordPath)),
          added: options.today,
          size: bytes.byteLength,
          hash
        },
        this.words().notesHeading
      )
    )
    return {
      record: record.path,
      title,
      file: file.path,
      projects,
      added: options.today,
      size: bytes.byteLength,
      hash,
      tags: []
    }
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
    if (file instanceof TFile && file.path.startsWith(`${this.filesFolder}/`)) {
      await this.app.fileManager.trashFile(file)
    }
  }
}
