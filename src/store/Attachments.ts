import { TFile, normalizePath } from 'obsidian'
import type { App } from 'obsidian'
import type { EmailAttachment } from './email'
import { parseEmail } from './email'
import { ensureFolder } from './vaultFs'

/**
 * Getting a message's attachment out of the message and into the vault.
 *
 * The bytes are not kept with the listed message — a mailbox of two hundred would sit in
 * memory all session — so the file is read and parsed again at the moment one is asked
 * for. That costs a read on a click, which nobody notices, and saves a folder of mail
 * being held open, which everybody would.
 */
export async function attachmentBytes(app: App, messagePath: string, name: string): Promise<Uint8Array | null> {
  const file = app.vault.getAbstractFileByPath(normalizePath(messagePath))
  if (!(file instanceof TFile)) return null
  const mail = parseEmail(file.name, new Uint8Array(await app.vault.readBinary(file)))
  const found = mail?.attachments.find((attachment) => attachment.name === name)
  return found?.bytes ?? null
}

/**
 * A name nothing else in the folder has.
 *
 * `plan.pdf`, `plan-2.pdf`, … so saving the same attachment from two messages never
 * lands one on top of the other. The suffix goes before the extension, where it belongs:
 * `plan.pdf-2` is not a PDF as far as anything else is concerned.
 */
export function freeAttachmentPath(folder: string, name: string, taken: (path: string) => boolean): string {
  const clean = safeName(name)
  const dot = clean.lastIndexOf('.')
  const base = dot <= 0 ? clean : clean.slice(0, dot)
  const ext = dot <= 0 ? '' : clean.slice(dot)
  for (let n = 0; n < 100; n++) {
    const candidate = normalizePath(`${folder}/${base}${n === 0 ? '' : `-${n}`}${ext}`)
    if (!taken(candidate)) return candidate
  }
  return normalizePath(`${folder}/${base}-${Date.now()}${ext}`)
}

/**
 * A file name a vault will accept.
 *
 * A mail client will happily send `rapport 1/2.pdf` or a name with a colon in it, and a
 * path separator inside a name would write the file somewhere nobody asked for. The
 * characters are replaced rather than dropped, so what is left still reads as the name
 * the sender gave it.
 */
export function safeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    // `..` never means anything in a file name, and is how walking out of a folder is
    // written; collapsing it leaves nothing for the trim below to have to reason about.
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .trim()
    // A leading dot would hide the file, a leading dash is what is left of a separator,
    // and a trailing dot is not a name at all.
    .replace(/^[.-]+/, '')
    .replace(/\.+$/, '')
  return cleaned || 'attachment'
}

/** Writes an attachment into a folder and answers where it landed. */
export async function saveAttachment(
  app: App,
  folder: string,
  attachment: EmailAttachment,
  bytes: Uint8Array
): Promise<string> {
  await ensureFolder(app, folder)
  const path = freeAttachmentPath(folder, attachment.name, (candidate) =>
    Boolean(app.vault.getAbstractFileByPath(candidate))
  )
  await app.vault.createBinary(path, bytes.slice().buffer)
  return path
}
