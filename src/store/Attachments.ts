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
 * The names an attachment may be saved under, in the order they are tried.
 *
 * `plan.pdf`, `plan-1.pdf`, … The suffix goes before the extension, where it belongs:
 * `plan.pdf-1` is not a PDF as far as anything else in the vault is concerned.
 */
export function attachmentCandidates(folder: string, name: string, limit = 100): string[] {
  const clean = safeName(name)
  const dot = clean.lastIndexOf('.')
  const base = dot <= 0 ? clean : clean.slice(0, dot)
  const ext = dot <= 0 ? '' : clean.slice(dot)
  const out: string[] = []
  for (let n = 0; n < limit; n++) out.push(normalizePath(`${folder}/${base}${n === 0 ? '' : `-${n}`}${ext}`))
  return out
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export interface TargetProbe {
  /** The size of what is at this path, or null when nothing is. */
  sizeOf(path: string): number | null
  /** What is at this path, asked for only once a size has already matched. */
  bytesOf(path: string): Promise<Uint8Array | null>
}

export interface AttachmentTarget {
  path: string
  /** True when this exact file is already there and only needs opening. */
  exists: boolean
}

/**
 * Where this attachment belongs, and whether it is already there.
 *
 * Saving the same attachment twice must not make a second copy, and nothing is written
 * down to remember that it was saved — a note of where a file went is a note that goes
 * stale the moment somebody moves or deletes it. The file itself is the record: a
 * candidate holding exactly these bytes *is* this attachment, and one holding something
 * else is another file that happens to share a name, so the next candidate is tried.
 *
 * That answers the deleted case without a special rule for it. A file that is gone
 * leaves its name free, so the next click writes it again.
 */
export async function resolveAttachmentTarget(
  candidates: string[],
  bytes: Uint8Array,
  probe: TargetProbe
): Promise<AttachmentTarget> {
  for (const path of candidates) {
    const size = probe.sizeOf(path)
    // Nothing there: the name is free, and this is where the file goes.
    if (size === null) return { path, exists: false }
    // A different size is a different file; only a match is worth reading to be sure.
    if (size !== bytes.length) continue
    const held = await probe.bytesOf(path)
    if (held && sameBytes(held, bytes)) return { path, exists: true }
  }
  // A hundred files of the same name and none of them this one: stamped rather than
  // refused, because losing the attachment would be worse than an ugly name. Built from
  // the plain name, not from the last candidate tried — `Devis-99-1789…` names nothing.
  const first = candidates[0] ?? ''
  const dot = first.lastIndexOf('.')
  const slash = first.lastIndexOf('/')
  const stamp = `-${Date.now()}`
  return {
    path: dot > slash ? `${first.slice(0, dot)}${stamp}${first.slice(dot)}` : `${first}${stamp}`,
    exists: false
  }
}

/**
 * Whether this attachment looks like it has already been saved, judged without reading
 * anything — the size the message declares against the size of what is in the folder.
 *
 * Only good enough to label a chip. A click still settles it by the bytes, because two
 * different files of the same name and the same length are rare but not impossible, and
 * opening the wrong one would be worse than the label being a little optimistic.
 */
export function looksSaved(candidates: string[], size: number, sizeOf: (path: string) => number | null): boolean {
  return candidates.some((path) => sizeOf(path) === size)
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

/**
 * Puts an attachment in the project's folder, once.
 *
 * Answers where it is and whether this call is what put it there, so the caller can say
 * "saved" the first time and simply open it every time after.
 */
export async function saveAttachment(
  app: App,
  folder: string,
  attachment: EmailAttachment,
  bytes: Uint8Array
): Promise<AttachmentTarget> {
  const target = await resolveAttachmentTarget(attachmentCandidates(folder, attachment.name), bytes, vaultProbe(app))
  if (target.exists) return target
  await ensureFolder(app, folder)
  await app.vault.createBinary(target.path, bytes.slice().buffer)
  return target
}

/** The vault, answering the two questions the resolver asks of a candidate path. */
export function vaultProbe(app: App): TargetProbe {
  return {
    sizeOf: (path) => {
      const file = app.vault.getAbstractFileByPath(path)
      return file instanceof TFile ? file.stat.size : null
    },
    bytesOf: async (path) => {
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) return null
      return new Uint8Array(await app.vault.readBinary(file))
    }
  }
}
