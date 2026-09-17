import type { EmailMessage } from './EmailMessage'
import { emptyEmail, formatAddress, splitAddressList } from './EmailMessage'
import { readCfb, type CfbFile } from './cfb'
import { htmlToText } from './parseEml'

/**
 * Reading a `.msg`: what Outlook on Windows hands over when a message is dragged out of
 * it, and therefore the format that actually turns up in a vault.
 *
 * Each property sits in its own stream named after its MAPI tag, so reading the message
 * is reading half a dozen streams by name. The only awkward one is the date, which is a
 * fixed-length property and lives packed with the others rather than in a stream of its
 * own.
 */

/** `__substg1.0_XXXXYYYY`: the property id, then the type it is stored as. */
const TAG = {
  subject: '0037',
  body: '1000',
  bodyHtml: '1013',
  senderName: '0C1A',
  senderEmail: '0C1F',
  senderSmtp: '5D01',
  displayTo: '0E04',
  displayCc: '0E03'
} as const

const TYPE_UNICODE = '001F'
const TYPE_ASCII = '001E'
const TYPE_BINARY = '0102'

/** PidTagClientSubmitTime, a PT_SYSTIME and so never a stream of its own. */
const SENT_TAG = 0x0039
const PROPERTY_STREAM = '__properties_version1.0'

export function parseMsg(bytes: Uint8Array): EmailMessage {
  const file = readCfb(bytes)
  const mail = emptyEmail()

  mail.subject = readString(file, TAG.subject)
  mail.from = formatAddress(
    readString(file, TAG.senderName),
    readString(file, TAG.senderSmtp) || readString(file, TAG.senderEmail)
  )
  mail.to = splitAddressList(readString(file, TAG.displayTo))
  mail.cc = splitAddressList(readString(file, TAG.displayCc))
  mail.date = readSentDate(file)

  const plain = readString(file, TAG.body)
  mail.body = plain.trim() ? plain.trim() : htmlToText(readHtml(file))
  return mail
}

/** A property as text, whichever of the two string types it was written as. */
function readString(file: CfbFile, tag: string): string {
  const unicode = file.entries.get(`__substg1.0_${tag}${TYPE_UNICODE}`)
  if (unicode) return trimNul(new TextDecoder('utf-16le').decode(file.read(unicode)))
  const ascii = file.entries.get(`__substg1.0_${tag}${TYPE_ASCII}`)
  if (ascii) return trimNul(new TextDecoder('windows-1252').decode(file.read(ascii)))
  return ''
}

function readHtml(file: CfbFile): string {
  const binary = file.entries.get(`__substg1.0_${TAG.bodyHtml}${TYPE_BINARY}`)
  if (binary) return new TextDecoder('windows-1252').decode(file.read(binary))
  return readString(file, TAG.bodyHtml)
}

function trimNul(text: string): string {
  return text.replace(/\0+$/, '')
}

/**
 * The day the message was sent.
 *
 * Fixed-length properties are packed sixteen bytes to an entry in one stream, behind a
 * header whose length depends on what kind of thing owns them — thirty-two bytes for a
 * message read from a file. Rather than trust that, the entries are scanned from both
 * plausible starts: a wrong guess reads a tag that is not there and gives nothing, which
 * is the same answer as not looking.
 */
function readSentDate(file: CfbFile): string {
  const entry = file.entries.get(PROPERTY_STREAM)
  if (!entry) return ''
  const bytes = file.read(entry)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (const header of [32, 24, 8]) {
    for (let at = header; at + 16 <= bytes.length; at += 16) {
      const tag = view.getUint32(at, true)
      if (tag >>> 16 !== SENT_TAG) continue
      const filetime = view.getBigUint64(at + 8, true)
      const iso = fromFiletime(filetime)
      if (iso) return iso
    }
  }
  return ''
}

/** Windows counts 100-nanosecond ticks from 1601; the rest of the world uses 1970. */
export function fromFiletime(ticks: bigint): string {
  if (ticks <= 0n) return ''
  const millis = Number(ticks / 10_000n) - 11_644_473_600_000
  if (!Number.isFinite(millis) || millis < 0) return ''
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}
