/**
 * What the plugin keeps of a message dropped in from a mail client.
 *
 * Deliberately small: a ticket made from an e-mail needs to say what it was about, who
 * sent it, when, and what it said. Everything else — flags, headers, the thread it
 * belonged to — is the mail client's business, and the message file itself is kept beside
 * the ticket for anyone who needs the rest.
 */
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
}

export function emptyEmail(): EmailMessage {
  return { subject: '', from: '', to: [], cc: [], date: '', body: '' }
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
