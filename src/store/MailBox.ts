import { TFile, TFolder, normalizePath } from 'obsidian'
import type { App } from 'obsidian'
import type { Project } from '../types'
import { isEmailFile, parseEmail, withoutAttachmentBytes, type EmailMessage } from './email'
import { projectMailFolder } from './vaultFs'

/**
 * A project's `_mail` folder, read as a mailbox.
 *
 * The documents library lists tickets; this lists files, because that is what a mailbox
 * is. A message is not a thing the plan tracks the state of — it arrived, it says what it
 * says, and the only question worth asking of it is what it turns into. So there is no
 * state, no version, no approval here: a sender, a subject, a date, and what was written.
 */
export interface MailEntry {
  path: string
  name: string
  /** Null when the file is not a message this plugin can read; the row still lists it. */
  mail: EmailMessage | null
}

/** What a mailbox row sorts and searches on, with the file name standing in for a gap. */
export function entryDate(entry: MailEntry): string {
  return entry.mail?.date ?? ''
}
export function entryFrom(entry: MailEntry): string {
  return entry.mail?.from ?? ''
}
export function entrySubject(entry: MailEntry): string {
  return entry.mail?.subject.trim() || entry.name
}

/**
 * Whether a row answers what was typed in the search box.
 *
 * Sender, subject and body, because all three are how someone looks for a message they
 * half remember. The file name is searched too: an unreadable message has nothing else.
 */
export function matchesQuery(entry: MailEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [entry.name, entry.mail?.subject ?? '', entry.mail?.from ?? '', entry.mail?.body ?? '']
  return haystack.some((field) => field.toLowerCase().includes(q))
}

/** The message files in a project's `_mail` folder, in the order the vault lists them. */
export function mailFiles(app: App, project: Project): TFile[] {
  const folder = app.vault.getAbstractFileByPath(normalizePath(projectMailFolder(app, project.filePath)))
  if (!(folder instanceof TFolder)) return []
  return folder.children.filter((child): child is TFile => child instanceof TFile && isEmailFile(child.name))
}

/**
 * Parsed messages, kept between renders.
 *
 * Reading a `.msg` means walking a compound file and decoding half a dozen streams, and
 * the list redraws on every keystroke in the search box and every click in the pane. A
 * mailbox of two hundred messages would re-read all of them each time. The file's own
 * modification time and size decide when a cached answer is stale, so a message edited
 * outside Obsidian is still re-read while an untouched one is never read twice.
 */
export class MailCache {
  private entries = new Map<string, { stamp: string; entry: MailEntry }>()

  private static stamp(file: TFile): string {
    return `${file.stat.mtime}:${file.stat.size}`
  }

  /** What is already known, without touching the disk. */
  peek(file: TFile): MailEntry | null {
    const held = this.entries.get(file.path)
    return held && held.stamp === MailCache.stamp(file) ? held.entry : null
  }

  async read(app: App, file: TFile): Promise<MailEntry> {
    const held = this.peek(file)
    if (held) return held
    let mail: EmailMessage | null = null
    try {
      const parsed = parseEmail(file.name, new Uint8Array(await app.vault.readBinary(file)))
      // The names and sizes are kept; the bytes are let go of. Two hundred messages
      // holding every attachment they came with would sit in memory all session, and
      // one is wanted only when it is clicked — at which point the file is read again.
      mail = parsed ? withoutAttachmentBytes(parsed) : null
    } catch (error) {
      // A message that cannot be read is still a message that arrived: it keeps its row,
      // named by its file, rather than vanishing from the mailbox that holds it.
      console.error(`[Black Projects] Could not read the message "${file.name}":`, error)
    }
    const entry: MailEntry = { path: file.path, name: file.name, mail }
    this.entries.set(file.path, { stamp: MailCache.stamp(file), entry })
    return entry
  }

  /** Drops what the vault no longer has, so a long session does not hold deleted mail. */
  prune(paths: Iterable<string>): void {
    const live = new Set(paths)
    for (const path of this.entries.keys()) {
      if (!live.has(path)) this.entries.delete(path)
    }
  }

  get size(): number {
    return this.entries.size
  }
}
