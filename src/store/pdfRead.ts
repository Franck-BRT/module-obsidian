import { charWidth } from './pdfFont'

/**
 * Reading the text out of a PDF, by hand.
 *
 * A PDF does not hold sentences. It holds instructions to draw glyphs at places on a
 * page, in fonts whose codes are not necessarily characters, inside streams that are
 * usually compressed, inside objects that may themselves be packed into other streams.
 * So reading one is four jobs: find the objects, unpack the streams, learn each font's
 * way of turning codes into characters, and follow the drawing instructions keeping track
 * of where each piece of text lands and how wide it is.
 *
 * This file does those four and stops there: what comes out is text with positions and
 * the rectangles drawn around it. Turning that back into lines, paragraphs and tables is
 * `pdfText`'s job, because it is a different kind of problem — guessing, from where words
 * sit, what the author meant — and it is better kept apart from the part that must simply
 * be right.
 *
 * Not read: encrypted files (refused, by name), text drawn as outlines or pictures, and
 * the rarer compressions (LZW, run-length). A scanned document has no text at all.
 */

export class PdfError extends Error {}

export interface PdfTextItem {
  page: number
  x: number
  y: number
  /** The drawn size, in points: the font size scaled by whatever the page applied. */
  size: number
  /** How far the text runs, in points. */
  width: number
  text: string
  bold: boolean
  italic: boolean
  /** The marked-content id the text was drawn under, which the structure tree points at. */
  mcid?: number
  /** Drawn as the page's furniture — a running head, a page number — and said to be so. */
  artifact?: boolean
}

/**
 * A tagged PDF's structure: what the author's document said each piece of text was — a
 * heading, a paragraph, a table cell — before it was laid out. Word and LibreOffice both
 * write it, and it is worth more than anything guessed from where the text landed.
 */
export interface PdfStructElement {
  /** The standard role — `P`, `H1`, `Table`, `TD` — after the file's own role map. */
  role: string
  /** The name as the file wrote it, which is often the author's style: `Meta`, `Quote`. */
  name: string
  kids: (PdfStructElement | PdfContentRef)[]
}

export interface PdfContentRef {
  page: number
  mcid: number
}

export interface PdfRectItem {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface PdfContent {
  pages: number
  items: PdfTextItem[]
  rects: PdfRectItem[]
  structure?: PdfStructElement
  /** Things that could not be read, so the reader can be told rather than left guessing. */
  problems: string[]
}

/* ---- Objects -------------------------------------------------------------------- */

class PName {
  constructor(readonly name: string) {}
}

class PString {
  /** One character per byte. */
  constructor(readonly bytes: string) {}
}

class PRef {
  constructor(
    readonly num: number,
    readonly gen: number
  ) {}
}

class POp {
  constructor(readonly op: string) {}
}

type PDict = Map<string, PObj>

class PStream {
  constructor(
    readonly dict: PDict,
    /** The raw bytes, one character each. */
    readonly raw: string
  ) {}
}

type PObj = null | boolean | number | PName | PString | PRef | POp | PObj[] | PDict | PStream

const WHITE = new Set([0, 9, 10, 12, 13, 32])
const DELIMITER = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%'])

function isWhite(char: string | undefined): boolean {
  return char !== undefined && WHITE.has(char.charCodeAt(0))
}

/** A reader over a string of bytes: the whole file, or one content stream. */
class Lexer {
  constructor(
    readonly src: string,
    public at = 0
  ) {}

  skipWhite(): void {
    for (;;) {
      while (this.at < this.src.length && isWhite(this.src[this.at])) this.at++
      if (this.src[this.at] !== '%') return
      while (this.at < this.src.length && this.src[this.at] !== '\n' && this.src[this.at] !== '\r') this.at++
    }
  }

  private word(): string {
    const start = this.at
    while (this.at < this.src.length && !isWhite(this.src[this.at]) && !DELIMITER.has(this.src[this.at])) this.at++
    return this.src.slice(start, this.at)
  }

  private literal(): PString {
    // Past the opening parenthesis. Parentheses nest; a backslash escapes.
    let depth = 1
    let out = ''
    while (this.at < this.src.length) {
      const char = this.src[this.at++]
      if (char === '\\') {
        const next = this.src[this.at++]
        if (next === undefined) break
        const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }
        if (escapes[next]) out += escapes[next]
        else if (next >= '0' && next <= '7') {
          let digits = next
          while (digits.length < 3 && this.src[this.at] >= '0' && this.src[this.at] <= '7') {
            digits += this.src[this.at++]
          }
          out += String.fromCharCode(Number.parseInt(digits, 8) & 0xff)
        } else if (next === '\r') {
          if (this.src[this.at] === '\n') this.at++
        } else if (next !== '\n') out += next
      } else if (char === '(') {
        depth++
        out += char
      } else if (char === ')') {
        if (--depth === 0) break
        out += char
      } else out += char
    }
    return new PString(out)
  }

  private hex(): PString {
    const end = this.src.indexOf('>', this.at)
    const digits = this.src.slice(this.at, end === -1 ? undefined : end).replace(/[^0-9a-fA-F]/g, '')
    this.at = end === -1 ? this.src.length : end + 1
    const padded = digits.length % 2 ? `${digits}0` : digits
    let out = ''
    for (let i = 0; i < padded.length; i += 2) out += String.fromCharCode(Number.parseInt(padded.slice(i, i + 2), 16))
    return new PString(out)
  }

  private name(): PName {
    return new PName(
      this.word().replace(/#([0-9a-fA-F]{2})/g, (_whole, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    )
  }

  /** One object, or an operator in a content stream. `undefined` at the end. */
  next(): PObj | undefined {
    this.skipWhite()
    if (this.at >= this.src.length) return undefined
    const char = this.src[this.at]
    if (char === '/') {
      this.at++
      return this.name()
    }
    if (char === '(') {
      this.at++
      return this.literal()
    }
    if (char === '<') {
      if (this.src[this.at + 1] === '<') {
        this.at += 2
        return this.dict()
      }
      this.at++
      return this.hex()
    }
    if (char === '[') {
      this.at++
      const items: PObj[] = []
      for (;;) {
        this.skipWhite()
        if (this.src[this.at] === ']' || this.at >= this.src.length) {
          this.at++
          return items
        }
        const item = this.next()
        if (item === undefined) return items
        items.push(item)
      }
    }
    if (char === ']' || char === '>' || char === ')' || char === '{' || char === '}') {
      this.at++
      return new POp(char)
    }
    const word = this.word()
    if (word === '') {
      this.at++
      return new POp(char)
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      const value = Number(word)
      // `12 0 R` is a reference, which only reading ahead can tell.
      if (/^\d+$/.test(word)) {
        const back = this.at
        this.skipWhite()
        const gen = this.word()
        this.skipWhite()
        if (
          /^\d+$/.test(gen) &&
          this.src[this.at] === 'R' &&
          (this.at + 1 >= this.src.length || isWhite(this.src[this.at + 1]) || DELIMITER.has(this.src[this.at + 1]))
        ) {
          this.at++
          return new PRef(value, Number(gen))
        }
        this.at = back
      }
      return value
    }
    if (word === 'true') return true
    if (word === 'false') return false
    if (word === 'null') return null
    return new POp(word)
  }

  private dict(): PDict {
    const out: PDict = new Map()
    for (;;) {
      this.skipWhite()
      if (this.at >= this.src.length) return out
      if (this.src.startsWith('>>', this.at)) {
        this.at += 2
        return out
      }
      const key = this.next()
      if (!(key instanceof PName)) continue
      const value = this.next()
      if (value === undefined) return out
      out.set(key.name, value)
    }
  }
}

/* ---- Streams -------------------------------------------------------------------- */

function toBytes(raw: string): Uint8Array {
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 0xff
  return out
}

function toBinary(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return out
}

/**
 * Deflate, taking what comes out even when the stream ends badly: a PDF writer that cut
 * the checksum off a stream is common enough, and the text before it is still the text.
 */
async function inflate(data: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format)).getReader()
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } catch {
    if (!chunks.length) throw new PdfError('damaged compressed stream')
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** PNG row filters, which cross-reference streams in particular are written with. */
function unpredict(data: Uint8Array, parms: PDict | undefined): Uint8Array {
  const predictor = Number(parms?.get('Predictor') ?? 1)
  if (predictor < 10) return data
  const colors = Number(parms?.get('Colors') ?? 1)
  const bits = Number(parms?.get('BitsPerComponent') ?? 8)
  const columns = Number(parms?.get('Columns') ?? 1)
  const pixel = Math.max(1, (colors * bits) / 8)
  const row = Math.ceil((columns * colors * bits) / 8)
  const out = new Uint8Array(Math.floor(data.length / (row + 1)) * row)
  let previous = new Uint8Array(row)
  for (let r = 0; (r + 1) * (row + 1) <= data.length; r++) {
    const filter = data[r * (row + 1)]
    const line = data.slice(r * (row + 1) + 1, (r + 1) * (row + 1))
    for (let i = 0; i < row; i++) {
      const left = i >= pixel ? line[i - pixel] : 0
      const up = previous[i]
      const corner = i >= pixel ? previous[i - pixel] : 0
      if (filter === 1) line[i] = (line[i] + left) & 0xff
      else if (filter === 2) line[i] = (line[i] + up) & 0xff
      else if (filter === 3) line[i] = (line[i] + ((left + up) >> 1)) & 0xff
      else if (filter === 4) {
        const p = left + up - corner
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - corner)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner)) & 0xff
      }
    }
    out.set(line, r * row)
    previous = line
  }
  return out
}

function asciiHex(data: Uint8Array): Uint8Array {
  const text = toBinary(data)
    .replace(/>.*$/s, '')
    .replace(/[^0-9a-fA-F]/g, '')
  const padded = text.length % 2 ? `${text}0` : text
  const out = new Uint8Array(padded.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(padded.slice(i * 2, i * 2 + 2), 16)
  return out
}

function ascii85(data: Uint8Array): Uint8Array {
  const text = toBinary(data).replace(/^<~/, '').replace(/~>.*$/s, '').replace(/\s/g, '')
  const out: number[] = []
  let group: number[] = []
  const flush = (count: number): void => {
    let value = 0
    for (const digit of group) value = value * 85 + digit
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
    out.push(...bytes.slice(0, count))
  }
  for (const char of text) {
    if (char === 'z' && group.length === 0) {
      out.push(0, 0, 0, 0)
      continue
    }
    group.push(char.charCodeAt(0) - 33)
    if (group.length === 5) {
      flush(4)
      group = []
    }
  }
  if (group.length) {
    const count = group.length - 1
    while (group.length < 5) group.push(84)
    flush(count)
  }
  return Uint8Array.from(out)
}

/* ---- The file ------------------------------------------------------------------- */

class PdfFile {
  readonly objects = new Map<number, PObj>()
  readonly trailers: PDict[] = []

  constructor(readonly src: string) {}

  resolve(obj: PObj | undefined): PObj | undefined {
    let current = obj
    for (let depth = 0; current instanceof PRef && depth < 16; depth++) current = this.objects.get(current.num)
    return current
  }

  dict(obj: PObj | undefined): PDict | undefined {
    const found = this.resolve(obj)
    if (found instanceof PStream) return found.dict
    return found instanceof Map ? found : undefined
  }

  get(dict: PDict | undefined, key: string): PObj | undefined {
    return dict ? this.resolve(dict.get(key)) : undefined
  }

  nameOf(obj: PObj | undefined): string | undefined {
    const found = this.resolve(obj)
    return found instanceof PName ? found.name : undefined
  }

  async decode(stream: PStream): Promise<Uint8Array | null> {
    let data = toBytes(stream.raw)
    const filterObj = this.get(stream.dict, 'Filter')
    const filters = (Array.isArray(filterObj) ? filterObj : filterObj ? [filterObj] : []).map(
      (each) => this.nameOf(each) ?? ''
    )
    const parmsObj = this.get(stream.dict, 'DecodeParms') ?? this.get(stream.dict, 'DP')
    const parms = Array.isArray(parmsObj) ? parmsObj.map((each) => this.dict(each)) : [this.dict(parmsObj)]
    for (const [index, filter] of filters.entries()) {
      if (filter === 'FlateDecode' || filter === 'Fl') {
        try {
          data = await inflate(data, 'deflate')
        } catch {
          // A stream with no zlib header, which some writers produce.
          data = await inflate(data, 'deflate-raw')
        }
        data = unpredict(data, parms[index])
      } else if (filter === 'ASCIIHexDecode' || filter === 'AHx') data = asciiHex(data)
      else if (filter === 'ASCII85Decode' || filter === 'A85') data = ascii85(data)
      else return null
    }
    return data
  }
}

/** The stream's bytes, found by its declared length where that holds, by `endstream` where not. */
function streamAt(src: string, dict: PDict, from: number): { raw: string; end: number } {
  let start = from
  if (src[start] === '\r') start++
  if (src[start] === '\n') start++
  const length = dict.get('Length')
  if (typeof length === 'number') {
    const after = src.slice(start + length, start + length + 12)
    if (/^\s*endstream/.test(after)) return { raw: src.slice(start, start + length), end: start + length }
  }
  const end = src.indexOf('endstream', start)
  const stop = end === -1 ? src.length : end
  let raw = src.slice(start, stop)
  raw = raw.replace(/\r?\n$|\r$/, '')
  return { raw, end: stop }
}

const OBJ = /(\d+)\s+(\d+)\s+obj\b/g

/**
 * Every object in the file, found by reading it front to back.
 *
 * Not through the cross-reference table: a table out by a byte — which edited files
 * often have — would lose the whole document, where reading the objects where they sit
 * loses nothing. A later definition wins, as it does in a file updated incrementally.
 */
async function load(bytes: Uint8Array): Promise<PdfFile> {
  const file = new PdfFile(toBinary(bytes))
  const { src } = file
  if (!src.slice(0, 1024).includes('%PDF')) throw new PdfError('not a PDF')

  OBJ.lastIndex = 0
  const streams: [number, PStream][] = []
  for (let match = OBJ.exec(src); match; match = OBJ.exec(src)) {
    const lexer = new Lexer(src, match.index + match[0].length)
    let value: PObj | undefined
    try {
      value = lexer.next()
    } catch {
      continue
    }
    if (value === undefined) continue
    lexer.skipWhite()
    if (value instanceof Map && src.startsWith('stream', lexer.at)) {
      const found = streamAt(src, value, lexer.at + 6)
      value = new PStream(value, found.raw)
      streams.push([Number(match[1]), value])
      OBJ.lastIndex = found.end
    } else OBJ.lastIndex = lexer.at
    file.objects.set(Number(match[1]), value)
  }

  // Trailers, the old kind and the cross-reference streams that replaced them.
  for (let at = src.indexOf('trailer'); at !== -1; at = src.indexOf('trailer', at + 7)) {
    const found = new Lexer(src, at + 7).next()
    if (found instanceof Map) file.trailers.push(found)
  }
  for (const [, stream] of streams) {
    if (file.nameOf(stream.dict.get('Type')) === 'XRef') file.trailers.push(stream.dict)
  }

  // Objects packed into object streams, unless the file also defines them directly.
  for (const [, stream] of streams) {
    if (file.nameOf(stream.dict.get('Type')) !== 'ObjStm') continue
    const data = await file.decode(stream).catch(() => null)
    if (!data) continue
    const text = toBinary(data)
    const count = Number(file.resolve(stream.dict.get('N')) ?? 0)
    const first = Number(file.resolve(stream.dict.get('First')) ?? 0)
    const header = new Lexer(text)
    const entries: [number, number][] = []
    for (let i = 0; i < count; i++) {
      const num = header.next()
      const offset = header.next()
      if (typeof num === 'number' && typeof offset === 'number') entries.push([num, offset])
    }
    for (const [num, offset] of entries) {
      if (file.objects.has(num)) continue
      const value = new Lexer(text, first + offset).next()
      if (value !== undefined) file.objects.set(num, value)
    }
  }
  return file
}

/* ---- Fonts -------------------------------------------------------------------- */

/** Glyph names for the WinAnsi codes from 0x20, in order; `.` where the code has none. */
const WIN_ANSI_NAMES = (
  'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash ' +
  'zero one two three four five six seven eight nine colon semicolon less equal greater question ' +
  'at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore ' +
  'grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde . ' +
  'Euro . quotesinglbase florin quotedblbase ellipsis dagger daggerdbl circumflex perthousand Scaron guilsinglleft OE . Zcaron . ' +
  '. quoteleft quoteright quotedblleft quotedblright bullet endash emdash tilde trademark scaron guilsinglright oe . zcaron Ydieresis ' +
  'nbspace exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot sfthyphen registered macron ' +
  'degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown ' +
  'Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis ' +
  'Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls ' +
  'agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis ' +
  'eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis'
).split(' ')

const WIN_ANSI = new TextDecoder('windows-1252')

const GLYPHS: Map<string, string> = (() => {
  const out = new Map<string, string>()
  WIN_ANSI_NAMES.forEach((name, at) => {
    if (name !== '.') out.set(name, WIN_ANSI.decode(Uint8Array.of(0x20 + at)))
  })
  const extra: Record<string, string> = {
    space: ' ',
    nbspace: ' ',
    nonbreakingspace: ' ',
    sfthyphen: '',
    minus: '−',
    fi: 'fi',
    fl: 'fl',
    ff: 'ff',
    ffi: 'ffi',
    ffl: 'ffl',
    dotlessi: 'ı',
    Lslash: 'Ł',
    lslash: 'ł',
    fraction: '⁄',
    quotedbl: '"',
    periodcentered: '·',
    middot: '·',
    Delta: 'Δ',
    Omega: 'Ω',
    mu: 'µ',
    le: '≤',
    lessequal: '≤',
    greaterequal: '≥',
    notequal: '≠',
    approxequal: '≈',
    infinity: '∞',
    arrowright: '→'
  }
  for (const [name, char] of Object.entries(extra)) out.set(name, char)
  return out
})()

/** A glyph's name as the character it draws: from the list, or from the name spelling it. */
function glyphChar(name: string): string {
  const known = GLYPHS.get(name)
  if (known !== undefined) return known
  const base = name.split('.')[0]
  if (base !== name && GLYPHS.has(base)) return GLYPHS.get(base) ?? ''
  const uni = /^uni((?:[0-9A-Fa-f]{4})+)$/.exec(base)
  if (uni) return (uni[1].match(/.{4}/g) ?? []).map((hex) => String.fromCharCode(Number.parseInt(hex, 16))).join('')
  const u = /^u([0-9A-Fa-f]{4,6})$/.exec(base)
  if (u) return String.fromCodePoint(Number.parseInt(u[1], 16))
  return ''
}

function utf16(bytes: string): string {
  let out = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1))
  }
  return out
}

function hexBytes(hex: string): string {
  let out = ''
  for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16))
  return out
}

/** A ToUnicode map: what each code means, which is the one thing a text extractor needs. */
function readCMap(text: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      out.set(Number.parseInt(pair[1], 16), utf16(hexBytes(pair[2])))
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const low = Number.parseInt(range[1], 16)
      const high = Math.min(Number.parseInt(range[2], 16), low + 0xffff)
      if (range[3].startsWith('[')) {
        const targets = [...range[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((each) => utf16(hexBytes(each[1])))
        targets.forEach((target, at) => out.set(low + at, target))
        continue
      }
      const start = utf16(hexBytes(range[3].slice(1, -1)))
      for (let code = low; code <= high; code++) {
        const shift = code - low
        out.set(code, start.slice(0, -1) + String.fromCharCode(start.charCodeAt(start.length - 1) + shift))
      }
    }
  }
  return out
}

interface Font {
  /** Two for a composite font's codes, one for everything else. */
  codeBytes: number
  decode: (code: number) => string
  /** Thousandths of the font size. */
  width: (code: number, char: string) => number
  bold: boolean
  italic: boolean
}

const FALLBACK_FONT: Font = {
  codeBytes: 1,
  decode: (code) => WIN_ANSI.decode(Uint8Array.of(code)),
  width: (_code, char) => charWidth(char),
  bold: false,
  italic: false
}

async function loadFont(file: PdfFile, dict: PDict): Promise<Font> {
  const subtype = file.nameOf(dict.get('Subtype'))
  const base = (file.nameOf(dict.get('BaseFont')) ?? '').replace(/^[A-Z]{6}\+/, '')
  const composite = subtype === 'Type0'
  const descendant = composite ? file.dict((file.get(dict, 'DescendantFonts') as PObj[] | undefined)?.[0]) : undefined
  const descriptor = file.dict((descendant ?? dict).get('FontDescriptor'))
  const flags = Number(file.get(descriptor, 'Flags') ?? 0)
  const weight = Number(file.get(descriptor, 'FontWeight') ?? 400)
  const bold = /bold|black|heavy|semibold|demi/i.test(base) || weight >= 600
  const italic = /italic|oblique/i.test(base) || (flags & 64) !== 0

  let unicode: Map<number, string> | undefined
  const toUnicode = file.resolve(dict.get('ToUnicode'))
  if (toUnicode instanceof PStream) {
    const data = await file.decode(toUnicode).catch(() => null)
    if (data) unicode = readCMap(toBinary(data))
  }

  if (composite) {
    const widths = new Map<number, number>()
    const w = file.get(descendant, 'W')
    if (Array.isArray(w)) {
      for (let i = 0; i < w.length;) {
        const first = file.resolve(w[i])
        const second = file.resolve(w[i + 1])
        if (typeof first === 'number' && Array.isArray(second)) {
          second.forEach((each, at) => widths.set(first + at, Number(file.resolve(each))))
          i += 2
        } else if (typeof first === 'number' && typeof second === 'number') {
          const value = Number(file.resolve(w[i + 2]))
          for (let code = first; code <= second && code - first < 0x10000; code++) widths.set(code, value)
          i += 3
        } else break
      }
    }
    const fallback = Number(file.get(descendant, 'DW') ?? 1000)
    return {
      codeBytes: 2,
      decode: (code) => unicode?.get(code) ?? '',
      width: (code) => widths.get(code) ?? fallback,
      bold,
      italic
    }
  }

  // A simple font: one byte a code, an encoding and its differences.
  const encodingObj = file.resolve(dict.get('Encoding'))
  const encodingName =
    encodingObj instanceof PName ? encodingObj.name : file.nameOf(file.dict(encodingObj)?.get('BaseEncoding'))
  const differences = new Map<number, string>()
  const diffObj = encodingObj instanceof Map ? file.get(encodingObj, 'Differences') : undefined
  if (Array.isArray(diffObj)) {
    let code = 0
    for (const each of diffObj) {
      const value = file.resolve(each)
      if (typeof value === 'number') code = value
      else if (value instanceof PName) differences.set(code++, glyphChar(value.name))
    }
  }
  const mac = encodingName === 'MacRomanEncoding' ? new TextDecoder('macintosh') : undefined
  const decodeByte = (code: number): string => {
    if (unicode?.has(code)) return unicode.get(code) ?? ''
    if (differences.has(code)) return differences.get(code) ?? ''
    if (mac && code >= 0x80) return mac.decode(Uint8Array.of(code))
    return WIN_ANSI.decode(Uint8Array.of(code))
  }
  const firstChar = Number(file.get(dict, 'FirstChar') ?? 0)
  const widthsObj = file.get(dict, 'Widths')
  const widths = Array.isArray(widthsObj) ? widthsObj.map((each) => Number(file.resolve(each))) : undefined
  const missing = Number(file.get(descriptor, 'MissingWidth') ?? 0)
  return {
    codeBytes: 1,
    decode: decodeByte,
    // Without widths the font is one of the fourteen standard ones; Helvetica's are the
    // ones this plugin writes with, and near enough for the others to find a gap.
    width: (code, char) => {
      const held = widths?.[code - firstChar]
      if (held !== undefined && Number.isFinite(held)) return held
      if (widths && missing) return missing
      return /courier/i.test(base) ? 600 : charWidth(char)
    },
    bold,
    italic
  }
}

/* ---- Pages ---------------------------------------------------------------------- */

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5]
  ]
}

function point(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]
}

interface GraphicsState {
  ctm: Matrix
  font: Font
  size: number
  charSpacing: number
  wordSpacing: number
  scale: number
  leading: number
  rise: number
}

interface Page {
  dict: PDict
  resources: PDict | undefined
  /** The page's object number, which the structure tree refers to it by. */
  num?: number
}

function rootOf(file: PdfFile): PDict | undefined {
  return [...file.trailers]
    .reverse()
    .map((trailer) => file.dict(trailer.get('Root')))
    .find(Boolean)
}

function pagesOf(file: PdfFile): Page[] {
  const out: Page[] = []
  const seen = new Set<PDict>()
  const walk = (ref: PObj | undefined, resources: PDict | undefined): void => {
    const node = file.dict(ref)
    if (!node || seen.has(node)) return
    seen.add(node)
    const own = file.dict(node.get('Resources')) ?? resources
    const kids = file.get(node, 'Kids')
    if (Array.isArray(kids)) for (const kid of kids) walk(kid, own)
    else if (file.nameOf(node.get('Type')) === 'Page' || node.has('Contents')) {
      out.push({ dict: node, resources: own, num: ref instanceof PRef ? ref.num : undefined })
    }
  }
  walk(rootOf(file)?.get('Pages'), undefined)
  return out
}

/** The structure tree, with roles mapped to the standard ones and pages to their numbers. */
function structureOf(file: PdfFile, pages: Page[]): PdfStructElement | undefined {
  const root = file.dict(rootOf(file)?.get('StructTreeRoot'))
  if (!root) return undefined
  const roleMap = file.dict(root.get('RoleMap'))
  const pageNumber = new Map<number, number>()
  pages.forEach((page, at) => {
    if (page.num !== undefined) pageNumber.set(page.num, at + 1)
  })
  const standard = (name: string): string => {
    let role = name
    for (let depth = 0; depth < 8; depth++) {
      const mapped = file.nameOf(roleMap?.get(role))
      if (!mapped || mapped === role) break
      role = mapped
    }
    return role
  }
  const seen = new Set<PDict>()
  const element = (dict: PDict, inherited: number | undefined): PdfStructElement => {
    seen.add(dict)
    const pg = dict.get('Pg')
    const page = pg instanceof PRef ? (pageNumber.get(pg.num) ?? inherited) : inherited
    const name = file.nameOf(dict.get('S')) ?? ''
    const out: PdfStructElement = { role: standard(name), name, kids: [] }
    const k = file.resolve(dict.get('K'))
    for (const kid of Array.isArray(k) ? k : k === undefined || k === null ? [] : [k]) {
      const value = file.resolve(kid)
      if (typeof value === 'number') {
        if (page !== undefined) out.kids.push({ page, mcid: value })
      } else if (value instanceof Map && !seen.has(value)) {
        const type = file.nameOf(value.get('Type'))
        if (type === 'MCR') {
          const ref = value.get('Pg')
          const on = ref instanceof PRef ? (pageNumber.get(ref.num) ?? page) : page
          const mcid = file.resolve(value.get('MCID'))
          if (on !== undefined && typeof mcid === 'number') out.kids.push({ page: on, mcid })
        } else if (type !== 'OBJR') out.kids.push(element(value, page))
      }
    }
    return out
  }
  return element(root, undefined)
}

/**
 * One page's drawing instructions, followed.
 *
 * Only what places text and boxes is tracked: the transformation, the text matrix and the
 * text state. Colours, paths other than rectangles, and images are drawing, not words.
 */
async function readPage(
  file: PdfFile,
  source: string,
  resources: PDict | undefined,
  pageNumber: number,
  start: GraphicsState,
  out: PdfContent,
  depth: number
): Promise<void> {
  const fonts = new Map<string, Font>()
  const fontOf = async (name: string): Promise<Font> => {
    const cached = fonts.get(name)
    if (cached) return cached
    const dict = file.dict(file.dict(resources?.get('Font'))?.get(name))
    const font = dict ? await loadFont(file, dict).catch(() => FALLBACK_FONT) : FALLBACK_FONT
    fonts.set(name, font)
    return font
  }

  let state: GraphicsState = { ...start }
  const stack: GraphicsState[] = []
  // What the text is being drawn under: the ids the structure tree points at, and
  // whether it is the page's furniture.
  const marks: { mcid?: number; artifact: boolean }[] = []
  let tm: Matrix = IDENTITY
  let tlm: Matrix = IDENTITY
  const operands: PObj[] = []
  const lexer = new Lexer(source)

  const show = (bytes: string): void => {
    const { font, size, scale } = state
    let text = ''
    let advance = 0
    const origin = point(multiply(tm, state.ctm), 0, state.rise)
    for (let i = 0; i + font.codeBytes <= bytes.length; i += font.codeBytes) {
      const code = font.codeBytes === 2 ? (bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1) : bytes.charCodeAt(i)
      const char = font.decode(code)
      text += char
      const spacing = state.charSpacing + (font.codeBytes === 1 && code === 32 ? state.wordSpacing : 0)
      advance += ((font.width(code, char) / 1000) * size + spacing) * scale
    }
    const m = multiply(tm, state.ctm)
    const across = Math.hypot(m[0], m[1])
    // The height across the baseline, not along the slant: an italic made by skewing is
    // no taller than the upright text beside it.
    const drawn = across ? (size * Math.abs(m[0] * m[3] - m[1] * m[2])) / across : size * Math.abs(m[3])
    if (text) {
      const mark = [...marks].reverse().find((each) => each.mcid !== undefined)
      out.items.push({
        page: pageNumber,
        x: origin[0],
        y: origin[1],
        size: drawn,
        width: advance * across,
        text,
        bold: font.bold,
        // A slant put on by the matrix is an italic too: it is how a writer draws one in
        // a font that has none.
        italic: font.italic || Math.abs(m[2]) > 0.1 * Math.abs(m[3]),
        ...(mark?.mcid !== undefined ? { mcid: mark.mcid } : {}),
        ...(marks.some((each) => each.artifact) ? { artifact: true } : {})
      })
    }
    tm = multiply([1, 0, 0, 1, advance, 0], tm)
  }

  for (let token = lexer.next(); token !== undefined; token = lexer.next()) {
    if (!(token instanceof POp)) {
      operands.push(token)
      continue
    }
    const num = (at: number): number => Number(operands[at] ?? 0)
    switch (token.op) {
      case 'q':
        stack.push({ ...state })
        break
      case 'Q':
        state = stack.pop() ?? state
        break
      case 'cm':
        state.ctm = multiply([num(0), num(1), num(2), num(3), num(4), num(5)], state.ctm)
        break
      case 'BT':
        tm = IDENTITY
        tlm = IDENTITY
        break
      case 'Tf': {
        const name = operands[0]
        if (name instanceof PName) state.font = await fontOf(name.name)
        state.size = num(1)
        break
      }
      case 'Tc':
        state.charSpacing = num(0)
        break
      case 'Tw':
        state.wordSpacing = num(0)
        break
      case 'Tz':
        state.scale = num(0) / 100
        break
      case 'TL':
        state.leading = num(0)
        break
      case 'Ts':
        state.rise = num(0)
        break
      case 'Td':
        tlm = multiply([1, 0, 0, 1, num(0), num(1)], tlm)
        tm = tlm
        break
      case 'TD':
        state.leading = -num(1)
        tlm = multiply([1, 0, 0, 1, num(0), num(1)], tlm)
        tm = tlm
        break
      case 'Tm':
        tlm = [num(0), num(1), num(2), num(3), num(4), num(5)]
        tm = tlm
        break
      case 'T*':
        tlm = multiply([1, 0, 0, 1, 0, -state.leading], tlm)
        tm = tlm
        break
      case 'Tj':
        if (operands[0] instanceof PString) show(operands[0].bytes)
        break
      case "'":
      case '"': {
        if (token.op === '"') {
          state.wordSpacing = num(0)
          state.charSpacing = num(1)
        }
        tlm = multiply([1, 0, 0, 1, 0, -state.leading], tlm)
        tm = tlm
        const last = operands[operands.length - 1]
        if (last instanceof PString) show(last.bytes)
        break
      }
      case 'TJ': {
        const parts = operands[0]
        if (!Array.isArray(parts)) break
        for (const part of parts) {
          if (part instanceof PString) show(part.bytes)
          else if (typeof part === 'number') {
            tm = multiply([1, 0, 0, 1, (-part / 1000) * state.size * state.scale, 0], tm)
          }
        }
        break
      }
      case 're': {
        const [x1, y1] = point(state.ctm, num(0), num(1))
        const [x2, y2] = point(state.ctm, num(0) + num(2), num(1) + num(3))
        out.rects.push({
          page: pageNumber,
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1)
        })
        break
      }
      case 'Do': {
        // A form: a drawing kept aside and placed here, which can hold text of its own.
        const name = operands[0]
        if (!(name instanceof PName) || depth > 4) break
        const form = file.resolve(file.dict(resources?.get('XObject'))?.get(name.name))
        if (!(form instanceof PStream) || file.nameOf(form.dict.get('Subtype')) !== 'Form') break
        const data = await file.decode(form).catch(() => null)
        if (!data) break
        const matrix = file.get(form.dict, 'Matrix')
        const placed: Matrix = Array.isArray(matrix) && matrix.length === 6 ? (matrix.map(Number) as Matrix) : IDENTITY
        const inner = file.dict(form.dict.get('Resources')) ?? resources
        await readPage(
          file,
          toBinary(data),
          inner,
          pageNumber,
          { ...state, ctm: multiply(placed, state.ctm) },
          out,
          depth + 1
        )
        break
      }
      case 'BMC':
        marks.push({ artifact: operands[0] instanceof PName && operands[0].name === 'Artifact' })
        break
      case 'BDC': {
        const tag = operands[0]
        const props =
          operands[1] instanceof PName
            ? file.dict(file.dict(resources?.get('Properties'))?.get(operands[1].name))
            : file.dict(operands[1])
        const mcid = file.get(props, 'MCID')
        marks.push({
          mcid: typeof mcid === 'number' ? mcid : undefined,
          artifact: tag instanceof PName && tag.name === 'Artifact'
        })
        break
      }
      case 'EMC':
        marks.pop()
        break
      case 'BI': {
        // An inline image: its bytes are not tokens, and are skipped whole.
        const end = source.slice(lexer.at).search(/\sEI(\s|$)/)
        lexer.at = end === -1 ? source.length : lexer.at + end + 3
        break
      }
    }
    operands.length = 0
  }
}

/** The text and boxes of every page, in page order. */
export async function readPdf(bytes: Uint8Array): Promise<PdfContent> {
  const file = await load(bytes)
  if (file.trailers.some((trailer) => trailer.has('Encrypt'))) {
    throw new PdfError('the PDF is encrypted')
  }
  const out: PdfContent = { pages: 0, items: [], rects: [], problems: [] }
  const pages = pagesOf(file)
  out.pages = pages.length
  for (const [index, page] of pages.entries()) {
    const contents = file.resolve(page.dict.get('Contents'))
    const parts = Array.isArray(contents) ? contents.map((each) => file.resolve(each)) : [contents]
    const decoded: string[] = []
    for (const part of parts) {
      if (!(part instanceof PStream)) continue
      const data = await file.decode(part).catch(() => null)
      if (data) decoded.push(toBinary(data))
      else out.problems.push(`page ${index + 1}: unreadable stream`)
    }
    const start: GraphicsState = {
      ctm: IDENTITY,
      font: FALLBACK_FONT,
      size: 12,
      charSpacing: 0,
      wordSpacing: 0,
      scale: 1,
      leading: 0,
      rise: 0
    }
    // The parts of a page's contents are one stream cut in pieces, and are read as one.
    await readPage(file, decoded.join('\n'), page.resources, index + 1, start, out, 0)
  }
  out.structure = structureOf(file, pages)
  return out
}
