import { parseEmail, isEmailFile } from '../email'
import { fileText, FileReadError, isImage, readPdfText } from '../chat/chatFile'
import { needsOcr } from '../chat/ocr'
import { extensionOf, fold } from './libraryDoc'

/**
 * What a document says, as text the library can search.
 *
 * Read once, by the readers the imports and the chat already use — PDF, Word, Excel,
 * PowerPoint, web pages, messages — and kept, so a search runs through a thousand
 * documents without opening one. What cannot be read that way says why: a scan (a PDF
 * with no text to speak of, a photo) waits for a model that sees; a format this plugin has
 * no reader for, an old `.doc` say, is only found by its name.
 */

/**
 * Bumped when the readers improve. What an older reader could not read is read again —
 * a PDF locked against editing, which version 1 refused; a `.result`, which version 2 did
 * not know; a `.doc` or an `.rtf`, which version 3 did not —; what it did read is kept.
 */
export const TEXT_VERSION = 4

/** The most kept of one document: five hundred dense pages or so, past which the start is enough to find it. */
export const TEXT_LIMIT = 1_000_000

export type TextState = 'ok' | 'scan' | 'empty' | 'unreadable' | 'unsupported'

export interface DocText {
  state: TextState
  text: string
  /** The file's modification time when it was read: a newer file is read again. */
  mtime: number
  /** A scan read by a model rather than by a reader. */
  ocr?: boolean
}

/** A document's text as it is kept: a line saying what it is, then the text. */
export function encodeText(entry: DocText): string {
  return `pm-text ${TEXT_VERSION} ${entry.state} ${entry.mtime}${entry.ocr ? ' ocr' : ''}\n${entry.text}`
}

/** Null when it was kept by an older reader, or is not one of these. */
export function decodeText(raw: string): DocText | null {
  const end = raw.indexOf('\n')
  const head = (end < 0 ? raw : raw.slice(0, end)).split(' ')
  const version = Number(head[1])
  if (head[0] !== 'pm-text' || !(version >= 1 && version <= TEXT_VERSION)) return null
  const state = head[2] as TextState
  if (!['ok', 'scan', 'empty', 'unreadable', 'unsupported'].includes(state)) return null
  if ((state === 'unreadable' || state === 'unsupported') && version < TEXT_VERSION) return null
  const mtime = Number(head[3])
  return {
    state,
    text: end < 0 ? '' : raw.slice(end + 1),
    mtime: Number.isFinite(mtime) ? mtime : 0,
    ...(head[4] === 'ocr' ? { ocr: true } : {})
  }
}

/** The labels a message's lines are written with, their colons included. */
export interface MailWords {
  from: string
  to: string
  date: string
  attachments: string
}

/** A message as the words it is found by: who, when, what about, what it says, what came with it. */
function mailText(name: string, bytes: Uint8Array, words: MailWords): string | null {
  const mail = parseEmail(name, bytes)
  if (!mail) return null
  return [
    mail.subject && `# ${mail.subject}`,
    mail.from && `${words.from} ${mail.from}`,
    mail.to.length ? `${words.to} ${[...mail.to, ...mail.cc].join(', ')}` : '',
    mail.date && `${words.date} ${mail.date}`,
    mail.body,
    mail.attachments.length ? `${words.attachments} ${mail.attachments.map((file) => file.name).join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Reads a file's text, and says what it is when there is none to give. */
export async function extractText(
  name: string,
  bytes: Uint8Array,
  words: MailWords
): Promise<{ state: TextState; text: string }> {
  const ext = extensionOf(name)
  const cut = (text: string): string => (text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT) : text)
  if (isImage(ext)) return { state: 'scan', text: '' }
  if (isEmailFile(name)) {
    try {
      const text = mailText(name, bytes, words)
      return text?.trim() ? { state: 'ok', text: cut(text) } : { state: 'empty', text: '' }
    } catch {
      return { state: 'unreadable', text: '' }
    }
  }
  if (ext === 'pdf') {
    try {
      const { text, pages } = await readPdfText(bytes)
      // A few words a page is a title block round a picture: a scan, whatever text it has.
      return needsOcr(text, pages) ? { state: 'scan', text: cut(text) } : { state: 'ok', text: cut(text) }
    } catch {
      return { state: 'unreadable', text: '' }
    }
  }
  try {
    return { state: 'ok', text: cut(await fileText(ext, bytes)) }
  } catch (error) {
    const problem = error instanceof FileReadError ? error.problem : 'unreadable'
    return { state: problem, text: '' }
  }
}

/**
 * Text folded for searching — lower case, accents off — with, for each of its characters,
 * where it was in the text, so what is found can be shown where it is.
 */
export function foldWithMap(text: string): { folded: string; at: number[] } {
  let folded = ''
  const at: number[] = []
  let index = 0
  for (const char of text) {
    const piece = fold(char)
    at.push(...new Array<number>(piece.length).fill(index))
    folded += piece
    index += char.length
  }
  return { folded, at }
}

export interface Snippet {
  /** The passage, in pieces: the words searched for marked. */
  parts: { text: string; hit: boolean }[]
  /** Whether the passage starts or ends inside the text. */
  before: boolean
  after: boolean
}

/**
 * The passage of a text around the first word searched for that it holds, the words found
 * in it marked. Null when it holds none of them.
 */
export function snippet(text: string, words: string[], folded = fold(text), radius = 90): Snippet | null {
  const wanted = words.map(fold).filter(Boolean)
  if (!wanted.length || !text) return null
  // Folding keeps a text's length but for the rare letter written as two — a base and its
  // accent apart — so the positions are the text's own, and only then worked out one by one.
  const mapped = folded.length === text.length ? null : foldWithMap(text)
  const at = mapped ? (index: number): number => mapped.at[index] : (index: number): number => index
  if (mapped) folded = mapped.folded
  let first = -1
  for (const word of wanted) {
    const found = folded.indexOf(word)
    if (found >= 0 && (first < 0 || found < first)) first = found
  }
  if (first < 0) return null
  const centre = at(first)
  let start = Math.max(0, centre - radius)
  let end = Math.min(text.length, centre + radius * 2)
  // On word boundaries, not halfway through one.
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space >= 0 && space < centre) start = space + 1
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > centre) end = space
  }

  // The words found inside the passage, in the text's own positions.
  const marks: [number, number][] = []
  for (const word of wanted) {
    let from = 0
    for (;;) {
      const found = folded.indexOf(word, from)
      if (found < 0) break
      const begin = at(found)
      const finish = at(found + word.length - 1) + 1
      if (begin >= start && finish <= end) marks.push([begin, finish])
      from = found + word.length
    }
  }
  marks.sort((a, b) => a[0] - b[0])
  const parts: Snippet['parts'] = []
  let cursor = start
  for (const [begin, finish] of marks) {
    if (begin < cursor) continue
    if (begin > cursor) parts.push({ text: text.slice(cursor, begin), hit: false })
    parts.push({ text: text.slice(begin, finish), hit: true })
    cursor = finish
  }
  if (cursor < end) parts.push({ text: text.slice(cursor, end), hit: false })
  // One line, read as prose: the line breaks, the headings' hashes and the tables' bars
  // the readers write are what the document looked like, not what it says.
  for (const part of parts) {
    part.text = part.text
      .replace(/\s+/g, ' ')
      .replace(/(^| )#{1,6}(?= )/g, '$1')
      .replace(/ ?\|( ?\|)* ?/g, ' · ')
      .replace(/ {2,}/g, ' ')
  }
  const opening = parts[0]
  const closing = parts[parts.length - 1]
  if (!opening.hit) opening.text = opening.text.replace(/^[ ·]+/, '')
  if (!closing.hit) closing.text = closing.text.replace(/[ ·]+$/, '')
  return { parts: parts.filter((part) => part.text), before: start > 0, after: end < text.length }
}
