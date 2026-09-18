import type { EmailMessage } from './EmailMessage'
import { looksLikeCfb } from './cfb'
import { parseEml } from './parseEml'
import { parseMsg } from './parseMsg'

export type { EmailAttachment, EmailMessage, EmailLabels } from './EmailMessage'
export { emailToMarkdown, formatBytes, withoutAttachmentBytes } from './EmailMessage'
export { parseEml } from './parseEml'
export { parseMsg } from './parseMsg'
export { looksLikeCfb } from './cfb'

/** Which files a drop is worth looking inside. */
export function isEmailFile(name: string): boolean {
  return /\.(msg|eml)$/i.test(name.trim())
}

/**
 * A dropped message, whichever of the two shapes it arrived in.
 *
 * The name is a hint and the bytes are the evidence: Outlook on Windows drops a `.msg`,
 * which is a compound file, and everything else drops an `.eml`, which is text — so the
 * signature decides and a misnamed file still reads correctly. Null when the bytes are
 * neither, which is how a dropped PDF is left for whatever else wants it.
 */
export function parseEmail(name: string, bytes: Uint8Array): EmailMessage | null {
  if (looksLikeCfb(bytes)) {
    try {
      return parseMsg(bytes)
    } catch {
      return null
    }
  }
  if (!isEmailFile(name)) return null
  const text = new TextDecoder('utf-8').decode(bytes)
  const mail = parseEml(text)
  // Headers are what tells a message from any other text file that ends in .eml.
  return mail.subject || mail.from || mail.date ? mail : null
}
