import type { App } from 'obsidian'
import { makeDocument, makeTask } from '../../types'
import { sanitizeFileName } from '../../utils'
import { freePath, type DocumentStore } from '../DocumentStore'
import type { TaskSource } from '../TaskSource'
import { ensureFolder, projectInboxFolder } from '../vaultFs'

/**
 * A file dropped on the chat, kept in the vault before it is read.
 *
 * With a project attached, it is filed into that project the way its inbox files one: a
 * document ticket, the file deposited into `_docs` as its first issue — a planning
 * received is a document the project was sent, and belongs in its register whether or
 * not anyone talks about it. Without one, it goes beside the conversations, in a folder
 * of their own.
 *
 * Reports where the file now is, so it can be attached by that path.
 */

export interface KeepDeps {
  app: App
  store: TaskSource
  documents: DocumentStore
  /** Where a file with no project to go into is put. */
  looseFolder: string
  /** Who deposited it, and what the deposit says. */
  by: string
  note: string
}

function split(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? { base: name, ext: '' } : { base: name.slice(0, dot), ext: name.slice(dot + 1) }
}

export async function keepDroppedFile(
  deps: KeepDeps,
  name: string,
  bytes: Uint8Array,
  projectPath: string | null
): Promise<{ path: string; filed: boolean }> {
  const { app } = deps
  const { base, ext } = split(name)
  const clean = sanitizeFileName(base).trim() || 'document'
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const project = projectPath ? await deps.store.loadProjectByPath(projectPath) : null
  // A programme holds no tickets: the file goes beside the conversations instead.
  if (project && !project.program) {
    const inbox = projectInboxFolder(app, project.filePath)
    await ensureFolder(app, inbox)
    const source = await app.vault.createBinary(await freePath(app, inbox, clean, ext), data)
    const task = makeTask({ title: base, type: 'document', start: '', document: makeDocument({ reference: base }) })
    const document = await deps.documents.deposit(project, task, source, { move: true, by: deps.by, note: deps.note })
    await deps.store.insertTask(project, { ...task, document })
    return { path: document.file, filed: true }
  }
  await ensureFolder(app, deps.looseFolder)
  const file = await app.vault.createBinary(await freePath(app, deps.looseFolder, clean, ext), data)
  return { path: file.path, filed: false }
}
