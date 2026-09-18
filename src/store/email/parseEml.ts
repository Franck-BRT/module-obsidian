import type { EmailAttachment, EmailMessage } from './EmailMessage'
import { emptyEmail, formatAddress, splitAddressList } from './EmailMessage'

/**
 * Reading an `.eml`: the format a mail client hands over when it drags a message out as
 * a plain file, and what Outlook on the web and most non-Microsoft clients produce.
 *
 * Only what a ticket needs is read — the envelope and the text — so this is not a mail
 * library and does not try to be one. What it does have to get right is the encodings,
 * because a subject in French is routinely an encoded word and a body is routinely
 * quoted-printable: read naively, both arrive as mojibake, which is worse than nothing.
 */
export function parseEml(raw: string): EmailMessage {
  const normalised = raw.replace(/\r\n/g, '\n')
  const split = normalised.indexOf('\n\n')
  const headerBlock = split === -1 ? normalised : normalised.slice(0, split)
  const body = split === -1 ? '' : normalised.slice(split + 2)
  const headers = parseHeaders(headerBlock)

  const mail = emptyEmail()
  mail.subject = decodeWords(headers.get('subject') ?? '')
  mail.from = addressList(headers.get('from') ?? '')[0] ?? ''
  mail.to = addressList(headers.get('to') ?? '')
  mail.cc = addressList(headers.get('cc') ?? '')
  mail.date = isoDate(headers.get('date') ?? '')
  mail.body = readBody(body, headers)
  mail.attachments = readAttachments(body, headers)
  return mail
}

/**
 * The files a message carries.
 *
 * A part is an attachment when it names a file — through `Content-Disposition` or, for
 * the clients that never learned to set one, through the `name` on its own content type.
 * The text and HTML the message is made of name no file, which is exactly what tells them
 * apart from a `.txt` someone actually attached.
 */
function readAttachments(body: string, headers: Map<string, string>): EmailAttachment[] {
  const contentType = headers.get('content-type') ?? ''
  if (!/^multipart\//i.test(contentType.trim())) return []
  const boundary = paramOf(contentType, 'boundary')
  if (!boundary) return []

  const out: EmailAttachment[] = []
  for (const part of splitParts(body, boundary)) {
    const at = part.indexOf('\n\n')
    const partHeaders = parseHeaders(at === -1 ? part : part.slice(0, at))
    const partBody = at === -1 ? '' : part.slice(at + 2)
    const type = (partHeaders.get('content-type') ?? '').trim()
    // A part that is itself multipart holds its own; an attached message carries its own
    // attachments, and they are the attached message's business, not this one's.
    if (/^multipart\//i.test(type)) {
      out.push(...readAttachments(partBody, partHeaders))
      continue
    }
    const disposition = partHeaders.get('content-disposition') ?? ''
    const name = decodeWords(paramOf(disposition, 'filename') || paramOf(type, 'name'))
    if (!name) continue
    const bytes = attachmentBytes(partBody, partHeaders.get('content-transfer-encoding') ?? '7bit')
    out.push({ name, mime: type.split(';')[0].trim().toLowerCase(), size: bytes.length, bytes })
  }
  return out
}

/** An attachment is bytes, never text: it is never decoded into a string on the way out. */
function attachmentBytes(body: string, encoding: string): Uint8Array {
  const kind = encoding.toLowerCase().trim()
  if (kind === 'base64') return base64Bytes(body)
  if (kind === 'quoted-printable') return quotedPrintableBytes(body)
  const out = new Uint8Array(body.length)
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff
  return out
}

/** Header name (lower-cased) to value, continuation lines folded back onto one. */
function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>()
  let name = ''
  let value = ''
  const commit = (): void => {
    if (name && !headers.has(name)) headers.set(name, value.trim())
  }
  for (const line of block.split('\n')) {
    // A line starting with whitespace continues the one before it, which is how a long
    // subject or a list of recipients reaches us.
    if (/^[ \t]/.test(line) && name) {
      value += ` ${line.trim()}`
      continue
    }
    const at = line.indexOf(':')
    if (at === -1) continue
    commit()
    name = line.slice(0, at).trim().toLowerCase()
    value = line.slice(at + 1)
  }
  commit()
  return headers
}

function addressList(raw: string): string[] {
  return splitAddressList(raw)
    .map((entry) => {
      const angled = /^(.*)<([^>]+)>\s*$/.exec(entry)
      if (angled) return formatAddress(decodeWords(angled[1]), angled[2])
      return decodeWords(entry)
    })
    .filter(Boolean)
}

/** RFC 2047 encoded words: `=?utf-8?B?…?=` and `=?utf-8?Q?…?=`, anywhere in the value. */
export function decodeWords(raw: string): string {
  return raw
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_whole, charset: string, kind: string, text: string) => {
      const bytes =
        kind.toUpperCase() === 'B'
          ? base64Bytes(text)
          : // Q is quoted-printable with underscore standing in for a space.
            quotedPrintableBytes(text.replace(/_/g, ' '))
      return decodeBytes(bytes, charset)
    })
    .replace(/\?=\s+=\?/g, '')
    .trim()
}

export function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes)
  } catch {
    // An unknown or misspelled charset: latin-1 at least keeps the ASCII readable.
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '')
  const binary = atob(clean)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function quotedPrintableBytes(text: string): Uint8Array {
  // Soft line breaks first: "=\n" joins a line that was split to stay under 76 columns.
  const joined = text.replace(/=\n/g, '')
  const out: number[] = []
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      out.push(parseInt(joined.slice(i + 1, i + 3), 16))
      i += 2
      continue
    }
    out.push(joined.charCodeAt(i) & 0xff)
  }
  return new Uint8Array(out)
}

function decodeContent(body: string, encoding: string, charset: string): string {
  const kind = encoding.toLowerCase().trim()
  if (kind === 'base64') return decodeBytes(base64Bytes(body), charset)
  if (kind === 'quoted-printable') return decodeBytes(quotedPrintableBytes(body), charset)
  return body
}

function paramOf(header: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, 'i').exec(header)
  return match ? match[1].trim() : ''
}

/**
 * The text of the message.
 *
 * A multipart message is walked for its plain-text part, which is what a ticket wants.
 * Only when there is none is the HTML taken and stripped, because a mail's HTML is mostly
 * layout and reads far worse than the text the same message already carries.
 */
function readBody(body: string, headers: Map<string, string>): string {
  const contentType = headers.get('content-type') ?? 'text/plain'
  const encoding = headers.get('content-transfer-encoding') ?? '7bit'
  const charset = paramOf(contentType, 'charset') || 'utf-8'

  if (!/^multipart\//i.test(contentType.trim())) {
    const text = decodeContent(body, encoding, charset)
    return /^text\/html/i.test(contentType.trim()) ? htmlToText(text) : text.trim()
  }

  const boundary = paramOf(contentType, 'boundary')
  if (!boundary) return body.trim()
  const parts = splitParts(body, boundary)
  let html = ''
  for (const part of parts) {
    const at = part.indexOf('\n\n')
    const partHeaders = parseHeaders(at === -1 ? part : part.slice(0, at))
    const partBody = at === -1 ? '' : part.slice(at + 2)
    const type = (partHeaders.get('content-type') ?? 'text/plain').trim()
    const partCharset = paramOf(type, 'charset') || 'utf-8'
    const partEncoding = partHeaders.get('content-transfer-encoding') ?? '7bit'
    // A part that is itself multipart (alternative inside mixed) is walked in turn.
    if (/^multipart\//i.test(type)) {
      const nested = readBody(partBody, partHeaders)
      if (nested) return nested
      continue
    }
    if (/^text\/plain/i.test(type)) return decodeContent(partBody, partEncoding, partCharset).trim()
    if (/^text\/html/i.test(type) && !html) html = decodeContent(partBody, partEncoding, partCharset)
  }
  return html ? htmlToText(html) : ''
}

function splitParts(body: string, boundary: string): string[] {
  const marker = `--${boundary}`
  return body
    .split(marker)
    .slice(1)
    .filter((part) => !part.startsWith('--'))
    .map((part) => part.replace(/^\n/, ''))
}

/** Enough of an HTML reduction for a mail body: block breaks kept, tags and entities gone. */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      // A paragraph and a heading are separated by a blank line, the way they read; a div,
      // a row or a list item only break the line.
      .replace(/<\/(p|h[1-6])>/gi, '\n\n')
      .replace(/<\/(div|tr|li)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** The day a message was sent, as YYYY-MM-DD. Empty when the header is unreadable. */
export function isoDate(raw: string): string {
  if (!raw.trim()) return ''
  const at = Date.parse(raw.trim())
  if (Number.isNaN(at)) return ''
  return new Date(at).toISOString().slice(0, 10)
}
