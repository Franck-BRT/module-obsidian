import { CfbError, isCfb, readCfb, type CfbFile } from './cfb'

/**
 * The text of a Word 97–2003 document — the `.doc` of before 2007 —, read by hand.
 *
 * The file is a compound file (`cfb`). Its `WordDocument` stream starts with the File
 * Information Block, which says which of the two table streams is the live one and where,
 * in it, the piece table is. The piece table cuts the document's characters into pieces,
 * each kept either as one byte a character in the Windows code page or as UTF-16, at an
 * offset of `WordDocument`. Put back in order, they are the text — with Word's own marks
 * in it: paragraph ends, table cell and row ends, and fields, whose code is dropped and
 * whose result is kept.
 *
 * Not read: files protected by a password (refused, by name), and the formatting.
 */

export class DocError extends Error {}

const WIN_ANSI = new TextDecoder('windows-1252')

/**
 * The code page a Word 6 or 95 document's bytes are in, by the language it was written in:
 * Cyrillic, Central European, Greek, Turkish, Hebrew, Arabic, Baltic — else Western.
 */
function codePage(lid: number): TextDecoder {
  const primary = lid & 0x3ff
  const page =
    [0x19, 0x22, 0x02, 0x23, 0x2f, 0x3f, 0x40, 0x44].includes(primary) || lid === 0x0c1a || lid === 0x1c1a
      ? 1251
      : [0x15, 0x05, 0x0e, 0x1b, 0x24, 0x1a, 0x18, 0x1c].includes(primary)
        ? 1250
        : primary === 0x08
          ? 1253
          : primary === 0x1f || primary === 0x2c
            ? 1254
            : primary === 0x0d
              ? 1255
              : primary === 0x01 || primary === 0x29 || primary === 0x20
                ? 1256
                : [0x25, 0x26, 0x27].includes(primary)
                  ? 1257
                  : 1252
  return page === 1252 ? WIN_ANSI : new TextDecoder(`windows-${page}`)
}

function utf16(bytes: Uint8Array): string {
  let out = ''
  for (let at = 0; at + 1 < bytes.length; at += 2) out += String.fromCharCode(bytes[at] | (bytes[at + 1] << 8))
  return out
}

/**
 * How many characters each story of the document has, in the order they follow one
 * another: the body, the footnotes, the headers, the macros, the comments, the endnotes,
 * the text boxes and the headers' text boxes.
 */
interface Stories {
  text: number
  footnotes: number
  headers: number
  macros: number
  comments: number
  endnotes: number
  boxes: number
}

function storiesAt(view: DataView, at: number): Stories {
  const n = (index: number): number =>
    at + index * 4 + 4 <= view.byteLength ? view.getUint32(at + index * 4, true) : 0
  return { text: n(0), footnotes: n(1), headers: n(2), macros: n(3), comments: n(4), endnotes: n(5), boxes: n(6) }
}

/** The characters of the document's stories, Word's marks still in them, and how many each has. */
function rawText(word: Uint8Array, table: Uint8Array | null): { raw: string; stories: Stories } {
  const view = new DataView(word.buffer, word.byteOffset, word.byteLength)
  if (word.length < 0x22) throw new DocError('not a Word document')
  const ident = view.getUint16(0, true)
  const nFib = view.getUint16(2, true)
  const flags = view.getUint16(0x0a, true)
  // Word 97 and after, by its mark; Word 6 and 95 by their version, whatever their mark —
  // a few tools of the time wrote another.
  const modern = ident === 0xa5ec && nFib >= 106 && table !== null
  const old = nFib >= 101 && nFib <= 105
  if (!modern && !old) throw new DocError('not a Word document this reader knows')
  if (flags & 0x0100) throw new DocError('the document is protected by a password')

  // Word 6 and 95: one byte a character, and no table stream. Saved quickly, the piece
  // table is in the document's own stream; else the text is where the header says.
  if (!modern) {
    const decoder = codePage(view.getUint16(0x06, true))
    const stories = storiesAt(view, 0x4c)
    if (flags & 0x0004 && word.length >= 0x1aa) {
      const fcClx = view.getUint32(0x1a2, true)
      const lcbClx = view.getUint32(0x1a6, true)
      if (lcbClx && fcClx + lcbClx <= word.length) {
        return { raw: pieces(word, word, fcClx, lcbClx, total(stories), decoder), stories }
      }
    }
    const fcMin = view.getUint32(0x18, true)
    const fcMac = view.getUint32(0x1c, true)
    return { raw: decoder.decode(word.subarray(fcMin, Math.min(fcMac, word.length))), stories }
  }

  // The header's variable parts, to reach the counts and the offsets after them.
  let at = 32
  const csw = view.getUint16(at, true)
  at += 2 + csw * 2
  const cslw = view.getUint16(at, true)
  const longs = at + 2
  at = longs + cslw * 4
  const stories = storiesAt(view, longs + 3 * 4)
  const pairs = at + 2
  const fcClx = view.getUint32(pairs + 33 * 8, true)
  const lcbClx = view.getUint32(pairs + 33 * 8 + 4, true)
  if (!table || !lcbClx || fcClx + lcbClx > table.length) throw new DocError('no piece table')
  return { raw: pieces(word, table, fcClx, lcbClx, total(stories), null), stories }
}

function total(stories: Stories): number {
  const { text, footnotes, headers, macros, comments, endnotes, boxes } = stories
  return text + footnotes + headers + macros + comments + endnotes + boxes
}

/**
 * The text put back together from the piece table: each piece one byte a character, or
 * two — always one in Word 6 and 95, whose offsets are the bytes' own.
 */
function pieces(
  word: Uint8Array,
  table: Uint8Array,
  fcClx: number,
  lcbClx: number,
  ccpText: number,
  /** Word 6 and 95's: every piece one byte a character, in this code page. */
  eightBit: TextDecoder | null
): string {
  // The CLX: formatting records first, skipped; then the piece table.
  const clx = new DataView(table.buffer, table.byteOffset + fcClx, lcbClx)
  let pos = 0
  while (pos < lcbClx && clx.getUint8(pos) === 0x01) pos += 3 + clx.getInt16(pos + 1, true)
  if (pos >= lcbClx || clx.getUint8(pos) !== 0x02) throw new DocError('no piece table')
  const lcb = clx.getUint32(pos + 1, true)
  const plc = pos + 5
  const count = Math.floor((lcb - 4) / 12)
  const parts: string[] = []
  let taken = 0
  for (let piece = 0; piece < count && taken < ccpText; piece++) {
    const cpStart = clx.getUint32(plc + piece * 4, true)
    const cpEnd = clx.getUint32(plc + (piece + 1) * 4, true)
    const descriptor = plc + (count + 1) * 4 + piece * 8
    const fcRaw = clx.getUint32(descriptor + 2, true)
    const chars = Math.min(cpEnd - cpStart, ccpText - taken)
    if (chars <= 0) continue
    if (eightBit) {
      const fc = fcRaw & ~0x40000000
      parts.push(eightBit.decode(word.subarray(fc, fc + chars)))
    } else if (fcRaw & 0x40000000) {
      const fc = (fcRaw & ~0x40000000) / 2
      parts.push(WIN_ANSI.decode(word.subarray(fc, fc + chars)))
    } else parts.push(utf16(word.subarray(fcRaw, fcRaw + chars * 2)))
    taken += chars
  }
  return parts.join('')
}

/**
 * Word's marks made text: paragraphs as lines, tables as rows of cells, fields as what
 * they show, and the marks of pictures, notes and hyphens that are not text taken out.
 */
export function cleanWordText(raw: string): string {
  const lines: string[] = []
  let line = ''
  let cells: string[] = []
  // The fields open, each showing its code (dropped) or its result (kept).
  const fields: boolean[] = []
  const showing = (): boolean => fields.every((result) => result)
  for (let at = 0; at < raw.length; at++) {
    const char = raw[at]
    const code = char.charCodeAt(0)
    if (code === 0x13) fields.push(false)
    else if (code === 0x14) {
      if (fields.length) fields[fields.length - 1] = true
    } else if (code === 0x15) fields.pop()
    else if (!showing()) continue
    else if (code === 0x0d || code === 0x0b || code === 0x0c || code === 0x0e) {
      lines.push(line)
      line = ''
    } else if (code === 0x07) {
      // A cell's end; a second one at once is the row's.
      cells.push(line.trim())
      line = ''
      if (raw.charCodeAt(at + 1) === 0x07) {
        lines.push(`| ${cells.map((cell) => cell.replace(/\|/g, '/')).join(' | ')} |`)
        cells = []
        at++
      }
    } else if (code === 0x1e) line += '-'
    else if (code === 0xa0) line += ' '
    else if (code === 0x09) line += '\t'
    else if (code >= 0x20) line += char
  }
  if (cells.length) lines.push(`| ${cells.join(' | ')} |`)
  lines.push(line)
  return lines
    .map((one) => one.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A `.doc`'s text, paragraph by paragraph, its tables as rows of cells — then the Word documents embedded in it. */
export function readDoc(bytes: Uint8Array): string {
  if (!isCfb(bytes)) throw new DocError('not a Word 97–2003 document')
  let file: CfbFile
  try {
    file = readCfb(bytes)
  } catch (error) {
    throw new DocError(error instanceof CfbError ? error.message : 'unreadable compound file')
  }
  const own = documentIn(file, [])
  if (own === null) throw new DocError('not a Word document')
  // Word documents embedded as objects: each in a storage of the object pool, as a file is.
  const embedded: string[] = []
  for (const storage of file.children(['ObjectPool'])) {
    if (storage.type !== 1) continue
    try {
      const text = documentIn(file, ['ObjectPool', storage.name])
      if (text) embedded.push(text)
    } catch {
      // An object that does not read leaves the rest as it is.
    }
  }
  return [own, ...embedded].filter(Boolean).join('\n\n')
}

/** The text of the Word document in this storage of the file; null when there is none there. */
function documentIn(file: CfbFile, path: string[]): string | null {
  const word = file.stream('WordDocument', path)
  if (!word) return null
  const flags = word.length > 0x0b ? word[0x0a] | (word[0x0b] << 8) : 0
  const table = file.stream(flags & 0x0200 ? '1Table' : '0Table', path)
  const { raw, stories } = rawText(word, table)
  // The body; then what is read with it — footnotes, endnotes, text boxes —, not the
  // headers and footers, which repeat on every page, nor the comments.
  let from = 0
  const take = (count: number): string => {
    const part = raw.slice(from, from + count)
    from += count
    return part
  }
  const body = take(stories.text)
  const footnotes = take(stories.footnotes)
  take(stories.headers + stories.macros + stories.comments)
  const endnotes = take(stories.endnotes)
  const boxes = take(stories.boxes)
  // A file whose counts say nothing: all of it as the body.
  const main = stories.text ? body : raw
  return [main, footnotes, endnotes, boxes].map(cleanWordText).filter(Boolean).join('\n\n')
}
