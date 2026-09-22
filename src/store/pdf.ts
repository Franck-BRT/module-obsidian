import type { DocxBlock, DocxCell, DocxDocument, DocxRun, DocxStyle } from './docx'
import { textWidth, wrapText } from './pdfFont'

/**
 * A PDF, written by hand.
 *
 * The same document model the Word export is built from, so the two cannot drift: what
 * changes is who breaks the lines. Word is handed a paragraph and does its own layout; a
 * PDF says where every line starts, which means this file does the wrapping, the column
 * widths and the page breaks itself.
 *
 * Helvetica, one of the fourteen fonts every reader has, so nothing is embedded and the
 * file opens the same everywhere. The price is the characters Helvetica does not hold:
 * they are replaced by a question mark rather than dropped, because a specification that
 * quietly loses a character is worse than one that shows it lost it.
 */

/* ---- The page ---------------------------------------------------------------- */

/** A4, and 2 cm of margin, in points. The text width matches the Word export's exactly. */
export const PAGE = { width: 595.28, height: 841.89, margin: 56.7 }
export const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin

interface StyleMetrics {
  size: number
  bold: boolean
  italic: boolean
  grey: boolean
  /** How far in from the left margin, in points. */
  indent: number
  before: number
  after: number
  bullet: boolean
}

const STYLES: Record<DocxStyle, StyleMetrics> = {
  Title: { size: 20, bold: true, italic: false, grey: false, indent: 0, before: 0, after: 16, bullet: false },
  Heading1: { size: 15, bold: true, italic: false, grey: false, indent: 0, before: 18, after: 7, bullet: false },
  Heading2: { size: 12.5, bold: true, italic: false, grey: false, indent: 0, before: 14, after: 6, bullet: false },
  Heading3: { size: 11, bold: true, italic: false, grey: false, indent: 0, before: 11, after: 5, bullet: false },
  Normal: { size: 10, bold: false, italic: false, grey: false, indent: 0, before: 0, after: 7, bullet: false },
  Quote: { size: 10, bold: false, italic: true, grey: true, indent: 18, before: 2, after: 8, bullet: false },
  Meta: { size: 8.5, bold: false, italic: true, grey: true, indent: 0, before: 0, after: 6, bullet: false },
  Bullet: { size: 10, bold: false, italic: false, grey: false, indent: 14, before: 0, after: 4, bullet: true }
}

const LEADING = 1.32
const CELL_PAD = 4
/** Twentieths of a point is how the document model measures a column. */
const DXA = 20

/* ---- What a page holds ------------------------------------------------------- */

export interface PdfSpan {
  text: string
  x: number
  bold: boolean
  italic: boolean
}

export interface PdfText {
  kind: 'text'
  y: number
  size: number
  grey: boolean
  spans: PdfSpan[]
}

export interface PdfRect {
  kind: 'rect'
  x: number
  y: number
  width: number
  height: number
}

export type PdfItem = PdfText | PdfRect
export type PdfPage = PdfItem[]

/* ---- Laying it out ------------------------------------------------------------ */

interface Token {
  text: string
  bold: boolean
  italic: boolean
  /** A hard break the author wrote, which ends the line whatever room is left. */
  brk: boolean
  /** Follows the token before it with no space, because the text had none there. */
  glue: boolean
}

/**
 * The words, with the spaces between them remembered.
 *
 * Styling and spacing are two different things, and a word can change style in the middle
 * of itself: *pm-req* followed by a comma is three runs and two words, and a layout that
 * put a space at every run boundary would write "pm-req , et" — which is how you can tell,
 * reading a document, that a machine laid it out.
 */
function tokens(runs: DocxRun[], style: StyleMetrics): Token[] {
  const out: Token[] = []
  let spaced = true
  for (const run of runs) {
    const bold = run.bold ?? style.bold
    const italic = run.italic ?? style.italic
    run.text.split('\n').forEach((piece, line) => {
      if (line > 0) {
        out.push({ text: '', bold, italic, brk: true, glue: false })
        spaced = true
      }
      piece.split(' ').forEach((word, at) => {
        if (at > 0) spaced = true
        if (!word) return
        out.push({ text: word, bold, italic, brk: false, glue: !spaced && out.length > 0 })
        spaced = false
      })
    })
  }
  return out
}

/**
 * Words packed into lines that fit.
 *
 * Measured token by token rather than run by run, so a bold word in the middle of a
 * sentence does not start a line of its own: the styling and the line breaking are two
 * different questions and only one of them is about where the words go.
 */
function layLines(runs: DocxRun[], style: StyleMetrics, width: number): PdfSpan[][] {
  const space = textWidth(' ', style.size)
  const lines: PdfSpan[][] = []
  let line: PdfSpan[] = []
  let x = 0
  const flush = (): void => {
    lines.push(line)
    line = []
    x = 0
  }
  for (const token of tokens(runs, style)) {
    if (token.brk) {
      flush()
      continue
    }
    const gap = line.length && !token.glue ? space : 0
    const size = textWidth(token.text, style.size)
    if (line.length && x + gap + size > width) flush()
    if (!line.length && size > width) {
      // One word wider than the column: cut it rather than run past the margin.
      for (const piece of wrapText(token.text, style.size, width)) {
        line.push({ text: piece, x: 0, bold: token.bold, italic: token.italic })
        flush()
      }
      continue
    }
    const at = line.length ? x + gap : 0
    line.push({ text: token.text, x: at, bold: token.bold, italic: token.italic })
    x = at + size
  }
  flush()
  return lines.length ? lines : [[]]
}

function shift(spans: PdfSpan[], by: number): PdfSpan[] {
  return spans.map((span) => ({ ...span, x: span.x + by }))
}

class Sheet {
  readonly pages: PdfPage[] = [[]]
  /** The baseline of the next line, measured from the bottom of the page. */
  y = PAGE.height - PAGE.margin

  get page(): PdfPage {
    return this.pages[this.pages.length - 1]
  }

  get bottom(): number {
    return PAGE.margin
  }

  /** Starts a page. Nothing else may decide that, so a caller cannot half-draw a row. */
  break(): void {
    this.pages.push([])
    this.y = PAGE.height - PAGE.margin
  }

  room(): number {
    return this.y - this.bottom
  }
}

function drawParagraph(sheet: Sheet, block: Extract<DocxBlock, { kind: 'p' }>): void {
  const style = STYLES[block.style ?? 'Normal']
  const width = TEXT_WIDTH - style.indent
  const leading = style.size * LEADING
  const lines = layLines(block.runs, style, width)
  // Never a heading alone at the foot of a page: it belongs to what comes after it.
  const keep = style.bold && block.style !== 'Title' ? Math.min(2, lines.length) : 1
  if (sheet.room() < style.before + leading * keep) sheet.break()
  else sheet.y -= style.before

  lines.forEach((spans, at) => {
    if (sheet.room() < leading) sheet.break()
    sheet.y -= style.size
    const placed = shift(spans, PAGE.margin + style.indent)
    if (style.bullet && at === 0) {
      placed.unshift({ text: '•', x: PAGE.margin + style.indent - 10, bold: false, italic: false })
    }
    sheet.page.push({ kind: 'text', y: sheet.y, size: style.size, grey: style.grey, spans: placed })
    sheet.y -= leading - style.size
  })
  sheet.y -= style.after
}

interface CellLayout {
  lines: PdfSpan[][]
  x: number
  width: number
}

function layCells(cells: DocxCell[], bold: boolean): CellLayout[] {
  const style = { ...STYLES.Normal, bold }
  const out: CellLayout[] = []
  let x = PAGE.margin
  for (const cell of cells) {
    const width = cell.width / DXA
    out.push({
      lines: layLines(cell.runs, style, Math.max(10, width - 2 * CELL_PAD)),
      x,
      width
    })
    x += width
  }
  return out
}

/**
 * A table, page by page.
 *
 * A row is drawn as far as the page allows and continued on the next, rather than moved
 * whole or cut short: a requirement whose wording is half a page long has to arrive in
 * full, and a specification that dropped the end of one would be worse than useless.
 *
 * The header comes back at the top of every page the table runs onto, because a column
 * nobody can name is a column nobody can read.
 */
function drawTable(sheet: Sheet, block: Extract<DocxBlock, { kind: 'table' }>): void {
  const leading = STYLES.Normal.size * LEADING
  const header = layCells(block.header, true)
  const rows = block.rows.map((row) => layCells(row, false))

  const drawSlice = (cells: CellLayout[], from: number, count: number): number => {
    const height = count * leading + 2 * CELL_PAD
    const top = sheet.y
    for (const cell of cells) {
      sheet.page.push({ kind: 'rect', x: cell.x, y: top - height, width: cell.width, height })
      cell.lines.slice(from, from + count).forEach((spans, at) => {
        const baseline = top - CELL_PAD - STYLES.Normal.size - at * leading
        sheet.page.push({
          kind: 'text',
          y: baseline,
          size: STYLES.Normal.size,
          grey: false,
          spans: shift(spans, cell.x + CELL_PAD)
        })
      })
    }
    sheet.y = top - height
    return height
  }

  const fits = (): number => Math.floor((sheet.room() - 2 * CELL_PAD) / leading)
  const headerLines = Math.max(...header.map((cell) => cell.lines.length))

  const putHeader = (): void => {
    if (fits() < headerLines + 1) sheet.break()
    drawSlice(header, 0, headerLines)
  }

  if (sheet.room() < 3 * leading + 4 * CELL_PAD) sheet.break()
  putHeader()

  for (const row of rows) {
    const total = Math.max(...row.map((cell) => cell.lines.length))
    let done = 0
    while (done < total) {
      let room = fits()
      if (room < 1) {
        sheet.break()
        putHeader()
        room = fits()
      }
      const take = Math.min(total - done, Math.max(1, room))
      drawSlice(row, done, take)
      done += take
    }
  }
  sheet.y -= 10
}

export function layoutPdf(doc: DocxDocument): PdfPage[] {
  const sheet = new Sheet()
  for (const block of doc.blocks) {
    if (block.kind === 'table') drawTable(sheet, block)
    else drawParagraph(sheet, block)
  }
  return sheet.pages
}

/* ---- Writing the file --------------------------------------------------------- */

/**
 * The 0x80–0x9F corner of WinAnsi, where it is not Latin-1.
 *
 * Everything above it is Latin-1 and needs no table; this block is the one Windows put
 * typography in, and it holds the characters a French document actually uses — the
 * apostrophe, the dash, the ellipsis.
 */
const WIN_ANSI: Readonly<Record<string, number>> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f
}

/**
 * One character as the byte Helvetica will draw.
 *
 * A character the encoding has no room for becomes a question mark. Said out loud in the
 * document rather than dropped: a reader who sees one knows something was lost, where a
 * silent gap reads as a sentence that was written that way.
 */
export function winAnsiByte(char: string): number {
  const code = char.charCodeAt(0)
  if (code >= 32 && code <= 126) return code
  if (code >= 0xa0 && code <= 0xff) return code
  return WIN_ANSI[char] ?? 0x3f
}

/** A PDF string: bytes, with the three characters that would end it escaped. */
export function pdfString(text: string): string {
  let out = '('
  for (const char of text) {
    const byte = winAnsiByte(char)
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`
    else out += String.fromCharCode(byte)
  }
  return `${out})`
}

function fontName(bold: boolean, italic: boolean): string {
  if (bold && italic) return '/F4'
  if (bold) return '/F2'
  return italic ? '/F3' : '/F1'
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

function pageStream(page: PdfPage): string {
  const out: string[] = ['0.4 w', '0.75 0.75 0.75 RG']
  for (const item of page) {
    if (item.kind === 'rect') {
      out.push(`${round(item.x)} ${round(item.y)} ${round(item.width)} ${round(item.height)} re S`)
      continue
    }
    if (!item.spans.length) continue
    out.push(item.grey ? '0.35 0.35 0.35 rg' : '0 0 0 rg')
    for (const span of item.spans) {
      if (!span.text) continue
      out.push(
        `BT ${fontName(span.bold, span.italic)} ${round(item.size)} Tf ${round(span.x)} ${round(item.y)} Td ${pdfString(span.text)} Tj ET`
      )
    }
  }
  return out.join('\n')
}

const FONTS = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']

function stamp(at: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return (
    `D:${at.getUTCFullYear()}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}` +
    `${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}Z`
  )
}

/**
 * The file.
 *
 * Objects in order, then the cross-reference table that says where each one starts, which
 * is the part a reader trusts absolutely: an offset out by one byte is a file that will
 * not open at all. So the offsets are taken from the bytes as they are written, never
 * computed a second time from the lengths.
 */
export function buildPdf(doc: DocxDocument, at = new Date()): Uint8Array {
  const pages = layoutPdf(doc)
  const bytes: number[] = []
  const push = (text: string): void => {
    for (const char of text) bytes.push(char.charCodeAt(0) & 0xff)
  }

  // 1 catalog, 2 pages, 3 info, 4..7 fonts, then a page and a stream each.
  const first = 8
  const pageId = (at2: number): number => first + at2 * 2
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    `<< /Title ${pdfString(doc.title)} /Producer (Black Projects) /CreationDate (${stamp(at)}) >>`,
    ...FONTS.map((font) => `<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`)
  ]
  pages.forEach((page, i) => {
    const stream = pageStream(page)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(PAGE.width)} ${round(PAGE.height)}]` +
        ' /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R /F4 7 0 R >> >>' +
        ` /Contents ${pageId(i) + 1} 0 R >>`
    )
    // The length is in bytes, and the stream is seven-bit by construction — every
    // accent left pdfString as an octal escape — so its length in characters is its
    // length in bytes. A stream that held one accented byte would put the reader one
    // byte off the end of it.
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })

  push('%PDF-1.7\n')
  // A comment of high bytes, which is how a file says "this is not text" to anything
  // that might otherwise helpfully convert its line endings.
  bytes.push(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a)
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(bytes.length)
    push(`${i + 1} 0 obj\n${object}\nendobj\n`)
  })
  const xref = bytes.length
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  for (const offset of offsets) push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Uint8Array.from(bytes)
}
