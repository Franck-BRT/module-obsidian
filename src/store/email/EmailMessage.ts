/**
 * What the plugin keeps of a message dropped in from a mail client.
 *
 * Deliberately small: a ticket made from an e-mail needs to say what it was about, who
 * sent it, when, and what it said. Everything else — flags, headers, the thread it
 * belonged to — is the mail client's business, and the message file itself is kept beside
 * the ticket for anyone who needs the rest.
 */
/**
 * A file that came with a message.
 *
 * The bytes are what the parser found and are what writing it to the vault needs — but a
 * mailbox of two hundred messages holding every attachment would sit in memory all
 * session, so they are dropped from a message once it is only being listed. Optional, so
 * the compiler asks every reader what it does when they are not there, rather than the
 * question being answered by a crash.
 */
export interface EmailAttachment {
  name: string
  /** What the message said it is. Empty when it did not say; the name still hints. */
  mime: string
  size: number
  bytes?: Uint8Array
}

export interface EmailMessage {
  subject: string
  /** Display name and address when both are known, whichever exists otherwise. */
  from: string
  to: string[]
  cc: string[]
  /** YYYY-MM-DD, empty when the message carries no readable date. */
  date: string
  /** Plain text. An HTML-only message is reduced to its text. */
  body: string
  /** The files that came with it, in the order the message lists them. */
  attachments: EmailAttachment[]
}

export function emptyEmail(): EmailMessage {
  return { subject: '', from: '', to: [], cc: [], date: '', body: '', attachments: [] }
}

/** One address as "Name <address>", or whichever half the message actually gave. */
export function formatAddress(name: string, address: string): string {
  const cleanName = name.trim().replace(/^"|"$/g, '')
  const cleanAddress = address.trim()
  if (cleanName && cleanAddress && cleanName !== cleanAddress) return `${cleanName} <${cleanAddress}>`
  return cleanName || cleanAddress
}

/** Splits a header list on the commas that separate addresses, not the ones inside names. */
export function splitAddressList(raw: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (const char of raw) {
    if (char === '"') quoted = !quoted
    if (char === ',' && !quoted) {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/**
 * The note body a ticket made from a message starts with.
 *
 * The envelope first as a short list, then the message itself under a rule. A reader
 * opening the ticket in a month wants to know who asked and when before reading what they
 * asked for, and the plain text is kept as text rather than being folded into a quote —
 * it is the content of the ticket, not a citation.
 */
export function emailToMarkdown(mail: EmailMessage, labels: EmailLabels): string {
  const lines: string[] = []
  if (mail.from) lines.push(`**${labels.from}** ${mail.from}`)
  if (mail.to.length) lines.push(`**${labels.to}** ${mail.to.join(', ')}`)
  if (mail.cc.length) lines.push(`**${labels.cc}** ${mail.cc.join(', ')}`)
  if (mail.date) lines.push(`**${labels.date}** ${mail.date}`)
  const head = lines.join('\n')
  const body = mail.body.trim()
  if (!head) return body
  return body ? `${head}\n\n---\n\n${body}` : head
}

export interface EmailLabels {
  from: string
  to: string
  cc: string
  date: string
}

/**
 * A file size as it is read, not as it is stored: `284 ko`, not `290816`.
 *
 * Decimal units, because that is what every file manager a reader has ever seen shows,
 * and one decimal below ten so `1,4 Mo` keeps the detail that `1 Mo` throws away.
 */
export function formatBytes(bytes: number, units: readonly string[]): string {
  if (bytes <= 0) return `0 ${units[0]}`
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

/** The same message with its attachments' bytes let go of, for holding in a list. */
export function withoutAttachmentBytes(mail: EmailMessage): EmailMessage {
  return {
    ...mail,
    attachments: mail.attachments.map(({ name, mime, size }) => ({ name, mime, size }))
  }
}
