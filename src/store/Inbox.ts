import { TFile, TFolder, normalizePath } from 'obsidian'
import type { App } from 'obsidian'
import type { Project, Task } from '../types'
import { makeDocument, makeTask } from '../types'
import { isEmailFile, parseEmail, type EmailMessage } from './email'
import { ensureFolder, projectInboxFolder, projectMailFolder } from './vaultFs'

/** What the sweep decided to do with one file. */
export type InboxKind = 'mail' | 'document' | 'skipped'

export interface InboxPlan {
  name: string
  kind: InboxKind
}

/**
 * What a file dropped in the inbox is.
 *
 * A message goes one way and everything else goes the other, because those are the two
 * things a project actually receives: correspondence, and deliverables. The exceptions are
 * both about not touching what is not ours — a markdown note may be a ticket the plugin
 * itself wrote, and a dotfile belongs to whatever tool made it.
 */
export function planInboxFile(name: string): InboxKind {
  const clean = name.trim()
  if (!clean || clean.startsWith('.')) return 'skipped'
  if (isEmailFile(clean)) return 'mail'
  if (/\.md$/i.test(clean)) return 'skipped'
  return 'document'
}

export function planInbox(names: string[]): InboxPlan[] {
  return names.map((name) => ({ name, kind: planInboxFile(name) }))
}

export interface SweepResult {
  mails: number
  documents: number
  skipped: number
  failed: string[]
}

/** The files waiting in a project's inbox, in the order the vault lists them. */
export function inboxFiles(app: App, project: Project): TFile[] {
  const folder = app.vault.getAbstractFileByPath(normalizePath(projectInboxFolder(app, project.filePath)))
  if (!(folder instanceof TFolder)) return []
  return folder.children.filter((child): child is TFile => child instanceof TFile)
}

export interface SweepDeps {
  /** Files a document ticket is given, moved into `_docs` by the document store. */
  deposit: (task: Task, source: TFile) => Promise<Task>
  /** Writes a finished ticket into the project. */
  insert: (task: Task) => Promise<void>
  /** What a ticket made from a message says, envelope and text. */
  describeMail: (mail: EmailMessage, link: string) => string
  untitled: string
}

/**
 * Empties the inbox: every message becomes a ticket and is kept in `_mail`, every other
 * file becomes a document ticket and is kept in `_docs`.
 *
 * One file failing must not strand the rest — a locked PDF is not a reason to leave nine
 * good files unfiled — so each is taken on its own and what went wrong is reported by
 * name at the end rather than raised.
 */
export async function sweepInbox(app: App, project: Project, deps: SweepDeps): Promise<SweepResult> {
  const result: SweepResult = { mails: 0, documents: 0, skipped: 0, failed: [] }
  for (const file of inboxFiles(app, project)) {
    const kind = planInboxFile(file.name)
    if (kind === 'skipped') {
      result.skipped++
      continue
    }
    try {
      if (kind === 'mail') {
        await fileMessage(app, project, file, deps)
        result.mails++
      } else {
        await fileDocument(file, deps)
        result.documents++
      }
    } catch (error) {
      console.error(`[Black Projects] Could not file "${file.name}" from the inbox:`, error)
      result.failed.push(file.name)
    }
  }
  return result
}

/**
 * A message: read, moved into `_mail`, and turned into a ticket that names it.
 *
 * Moved before the ticket is written, so the link the ticket carries is the path the file
 * will actually be at. A message that cannot be read is still filed and still becomes a
 * ticket — its file name is a poor title, but losing the mail would be worse.
 */
async function fileMessage(app: App, project: Project, file: TFile, deps: SweepDeps): Promise<void> {
  const bytes = new Uint8Array(await app.vault.readBinary(file))
  const mail = parseEmail(file.name, bytes)

  const folder = projectMailFolder(app, project.filePath)
  await ensureFolder(app, folder)
  const target = await freePath(app, folder, file.name)
  await app.fileManager.renameFile(file, target)

  const title = mail?.subject.trim() || file.basename || deps.untitled
  await deps.insert(
    makeTask({
      title,
      start: '',
      ...(mail ? { description: deps.describeMail(mail, target) } : { description: `[[${target}]]` })
    })
  )
}

/** Anything else: a document ticket, and the file deposited into `_docs` as its first issue. */
async function fileDocument(file: TFile, deps: SweepDeps): Promise<void> {
  const base = file.basename
  const task = makeTask({
    title: base,
    type: 'document',
    start: '',
    document: makeDocument({ reference: base })
  })
  await deps.insert(await deps.deposit(task, file))
}

/** `name.pdf`, `name-2.pdf`, … so filing never lands on top of something already there. */
async function freePath(app: App, folder: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.')
  const base = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? '' : name.slice(dot)
  for (let n = 0; n < 100; n++) {
    const candidate = normalizePath(`${folder}/${base}${n === 0 ? '' : `-${n}`}${ext}`)
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate
  }
  return normalizePath(`${folder}/${base}-${Date.now()}${ext}`)
}
