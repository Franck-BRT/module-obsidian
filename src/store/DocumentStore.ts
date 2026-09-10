import { normalizePath, TFile } from 'obsidian'
import type { App } from 'obsidian'
import type { DocumentMeta, Project, Task } from '../types'
import { sanitizeFileName } from '../utils'
import { documentOf, nextVersion, recordDeposit } from './Document'
import { ensureFolder, folderOf, projectFolderOf } from './vaultFs'

/** The document storage folder inside a project's own folder. */
export const DOCS_FOLDER_NAME = '_docs'
/** Superseded files, kept beside the current one rather than in the project's face. */
export const VERSIONS_FOLDER_NAME = '_versions'

/** Where a project keeps its documents, in either project layout. */
export function projectDocsFolder(app: App, projectPath: string): string {
  const own = projectFolderOf(app, projectPath)
  if (own) return normalizePath(`${own}/${DOCS_FOLDER_NAME}`)
  return normalizePath(projectPath.replace(/\.md$/, `_${DOCS_FOLDER_NAME.replace(/^_/, '')}`))
}

export function projectVersionsFolder(app: App, projectPath: string): string {
  return normalizePath(`${projectDocsFolder(app, projectPath)}/${VERSIONS_FOLDER_NAME}`)
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1)
}

function baseNameOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}

/** `name.pdf`, `name-2.pdf`, … so a deposit never lands on top of an unrelated file. */
async function freePath(app: App, folder: string, base: string, ext: string): Promise<string> {
  const suffix = ext ? `.${ext}` : ''
  for (let n = 0; n < 100; n++) {
    const candidate = normalizePath(`${folder}/${base}${n === 0 ? '' : `-${n}`}${suffix}`)
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate
  }
  return normalizePath(`${folder}/${base}-${Date.now()}${suffix}`)
}

/**
 * Reads and writes the files a project's documents stand for.
 *
 * The rule the whole thing hangs on: the current file keeps one path for the life of the
 * document, and superseded files move into `_docs/_versions/`. A link to a document
 * therefore never has to be updated to stay on the latest issue, and no version is ever
 * overwritten — the two things a document library exists to promise.
 */
export class DocumentStore {
  constructor(private app: App) {}

  docsFolder(project: Project): string {
    return projectDocsFolder(this.app, project.filePath)
  }

  versionsFolder(project: Project): string {
    return projectVersionsFolder(this.app, project.filePath)
  }

  fileOf(meta: DocumentMeta): TFile | null {
    if (!meta.file) return null
    const file = this.app.vault.getAbstractFileByPath(normalizePath(meta.file))
    return file instanceof TFile ? file : null
  }

  /**
   * Takes a file into the document, as its next version.
   *
   * The file that was current is moved into the versions folder first, under the number
   * it was deposited as, so the log keeps pointing at the bytes it described. A document
   * whose file is only referenced elsewhere archives nothing: that file is not ours to
   * move.
   */
  async deposit(
    project: Project,
    task: Task,
    source: TFile,
    opts: { move: boolean; by: string; note: string; at?: string }
  ): Promise<DocumentMeta> {
    const meta = documentOf(task)
    const folder = this.docsFolder(project)
    await ensureFolder(this.app, folder)

    const archived = await this.archiveCurrent(project, meta)

    // The name the document has always had, so its path outlives its contents; a first
    // deposit takes the incoming file's name, cleaned up.
    const base = meta.file && !meta.linked ? baseNameOf(meta.file) : sanitizeFileName(baseNameOf(source.path))
    const target = await freePath(this.app, folder, base || 'document', extensionOf(source.path))

    if (opts.move) await this.app.fileManager.renameFile(source, target)
    else await this.app.vault.copy(source, target)

    return recordDeposit(
      { ...meta, linked: false },
      {
        file: target,
        at: opts.at ?? new Date().toISOString(),
        by: opts.by,
        note: opts.note,
        ...(archived ? { archived } : {})
      }
    )
  }

  /**
   * Points the document at a file where it already lives, without moving it. The version
   * log still records the deposit: what arrived and when is worth knowing even for a file
   * this project does not own.
   */
  async link(task: Task, source: TFile, opts: { by: string; note: string; at?: string }): Promise<DocumentMeta> {
    const meta = documentOf(task)
    return recordDeposit(
      { ...meta, linked: true },
      { file: source.path, at: opts.at ?? new Date().toISOString(), by: opts.by, note: opts.note }
    )
  }

  /**
   * Brings an archived version back as the current file — as a new deposit, not by
   * rewinding: going back to v1 is something that happened, and the log says so.
   */
  async restore(project: Project, task: Task, version: number): Promise<DocumentMeta | null> {
    const meta = documentOf(task)
    const entry = meta.versions.find((candidate) => candidate.version === version)
    if (!entry) return null
    const file = this.app.vault.getAbstractFileByPath(normalizePath(entry.file))
    if (!(file instanceof TFile)) return null
    return this.deposit(project, task, file, {
      move: false,
      by: entry.by,
      note: `restore v${version}`
    })
  }

  /** Moves the current file into the versions folder, under the number it was given. */
  private async archiveCurrent(
    project: Project,
    meta: DocumentMeta
  ): Promise<{ version: number; file: string } | undefined> {
    if (!meta.file || meta.linked) return undefined
    const current = this.fileOf(meta)
    if (!current) return undefined
    const version = meta.versions[meta.versions.length - 1]?.version ?? nextVersion(meta) - 1
    const folder = this.versionsFolder(project)
    await ensureFolder(this.app, folder)
    const target = await freePath(
      this.app,
      folder,
      `${baseNameOf(current.path)}-v${version}`,
      extensionOf(current.path)
    )
    await this.app.fileManager.renameFile(current, target)
    return { version, file: target }
  }

  /**
   * Obsidian renders some formats and not others. A PDF or an image opens in a tab; a
   * Word file or a drawing goes to whatever the system opens it with, which on mobile is
   * nothing — so the caller is told when nothing happened.
   */
  async open(meta: DocumentMeta): Promise<boolean> {
    const file = this.fileOf(meta)
    if (!file) return false
    const readable = ['md', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mp3', 'wav', 'canvas']
    if (readable.includes(file.extension)) {
      await this.app.workspace.getLeaf('tab').openFile(file)
      return true
    }
    const opener = (this.app as App & { openWithDefaultApp?: (path: string) => Promise<void> }).openWithDefaultApp
    if (!opener) return false
    await opener.call(this.app, file.path)
    return true
  }

  /** Every file in the project's docs folder that no document claims. */
  orphanFiles(project: Project, tasks: Task[]): string[] {
    const claimed = new Set(
      tasks.flatMap((task) => [documentOf(task).file, ...documentOf(task).versions.map((v) => v.file)])
    )
    const folder = this.docsFolder(project)
    return this.app.vault
      .getFiles()
      .filter((file) => folderOf(file.path) === folder && !claimed.has(file.path))
      .map((file) => file.path)
  }
}
