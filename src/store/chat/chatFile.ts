import { readDocx, type DocxReadBlock } from '../docxRead'
import { isCfb } from '../cfb'
import { readDoc } from '../docRead'
import { isRtf, readRtf } from '../rtfRead'
import { readHtml } from '../htmlRead'
import { readPdf } from '../pdfRead'
import { pdfBlocks } from '../pdfText'
import { readPptx } from '../pptxRead'
import { readSpreadsheet } from '../xlsRead'
import { fold } from '../library/libraryDoc'

/**
 * A file, as text a model can read.
 *
 * The readers are the ones the imports already use — PDF, Word, Excel, PowerPoint, HTML —
 * so a planning received as a PDF reads here the way it would read into the library:
 * paragraphs, headings, and tables kept as rows of cells, which is where a planning's
 * dates are. Plain text formats are read as they are.
 *
 * What cannot be read says why, in a word the panel turns into a sentence: a scanned PDF
 * has no text to give, and an image is not something this plugin can read.
 */

/** The extensions read as plain text, as they are — a test bench's `.result` among them. */
const PLAIN = new Set(['md', 'txt', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'ics', 'log', 'eml', 'result'])

/**
 * Plain text in UTF-8, or else in the Windows code page — what older tools and test
 * benches still write, and what UTF-8 would turn into question marks.
 */
export function plainText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Pictures, read by a model that sees, with the type a data URL gives them. */
const IMAGES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

/** Every extension a file can be attached with. */
export const READABLE_EXTENSIONS = new Set([
  ...PLAIN,
  'pdf',
  'docx',
  'doc',
  'dot',
  'rtf',
  'xlsx',
  'xlsm',
  'xls',
  'pptx',
  'html',
  'htm',
  ...Object.keys(IMAGES)
])

export function isReadable(extension: string): boolean {
  return READABLE_EXTENSIONS.has(extension.toLowerCase())
}

export function isImage(extension: string): boolean {
  return extension.toLowerCase() in IMAGES
}

/** A picture as a data URL, the form a model is handed an image in. */
export function imageDataUrl(extension: string, bytes: Uint8Array): string {
  let binary = ''
  // In slices: a string built from a whole scan in one call overflows the argument list.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return `data:${IMAGES[extension.toLowerCase()] ?? 'application/octet-stream'};base64,${btoa(binary)}`
}

/** A PDF's text and its number of pages, which together say whether the text is the document. */
export async function readPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  let content
  try {
    content = await readPdf(bytes)
  } catch {
    throw new FileReadError('unreadable')
  }
  return { text: blocksText(pdfBlocks(content)).replace(/\r\n?/g, '\n').trim(), pages: content.pages }
}

export type FileProblem = 'unsupported' | 'empty' | 'unreadable'

export class FileReadError extends Error {
  constructor(readonly problem: FileProblem) {
    super(problem)
  }
}

function cell(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '/')
    .trim()
}

/** Rows of cells as lines a model reads as a table, one row a line. */
function rowsText(rows: string[][]): string {
  return rows
    .map((row) => row.map(cell))
    .filter((row) => row.some(Boolean))
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')
}

/** Paragraphs and tables, as Markdown: a heading keeps its level, a list item its bullet. */
export function blocksText(blocks: DocxReadBlock[]): string {
  const out: string[] = []
  for (const block of blocks) {
    if (block.kind === 'table') {
      const table = rowsText(block.rows)
      if (table) out.push(table)
      continue
    }
    const text = block.text.trim()
    if (!text) continue
    if (block.style === 'title') out.push(`# ${text}`)
    else if (block.style === 'heading') out.push(`${'#'.repeat(Math.min(6, (block.level ?? 1) + 1))} ${text}`)
    else if (block.style === 'list') out.push(`- ${text}`)
    else out.push(text)
  }
  return out.join('\n\n')
}

/**
 * A Word document of before 2007, by what it really is rather than by its name: the
 * binary format of Word 97–2003 (and 6 and 95), RTF — which many `.doc` are —, a newer
 * document renamed, a web page saved as a document, or plain text.
 */
async function oldWordText(bytes: Uint8Array): Promise<string> {
  if (isCfb(bytes)) return readDoc(bytes)
  if (isRtf(bytes)) return readRtf(bytes)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return blocksText(await readDocx(bytes))
  const text = plainText(bytes)
  return /^\s*</.test(text) && /<(html|body|p|div)\b/i.test(text) ? blocksText(readHtml(text)) : text
}

/**
 * The file's text. Throws a `FileReadError` saying why when there is none to give: the
 * format is not one of these, the file holds no text (a scanned PDF), or it does not read.
 */
export async function fileText(extension: string, bytes: Uint8Array): Promise<string> {
  const ext = extension.toLowerCase()
  let text: string
  try {
    if (PLAIN.has(ext)) text = plainText(bytes)
    else if (ext === 'html' || ext === 'htm') text = blocksText(readHtml(plainText(bytes)))
    else if (ext === 'pdf') text = blocksText(pdfBlocks(await readPdf(bytes)))
    else if (ext === 'docx') text = blocksText(await readDocx(bytes))
    else if (ext === 'doc' || ext === 'dot' || ext === 'rtf') text = await oldWordText(bytes)
    else if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls') {
      text = (await readSpreadsheet(bytes))
        .filter((sheet) => sheet.rows.length)
        .map((sheet) => `## ${sheet.name}\n\n${rowsText(sheet.rows)}`)
        .join('\n\n')
    } else if (ext === 'pptx') {
      text = (await readPptx(bytes))
        .map((slide, at) => {
          const shapes = [...slide.shapes].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
          const parts = shapes.map((shape) =>
            shape.kind === 'table'
              ? rowsText(shape.rows)
              : shape.paragraphs
                  .map((paragraph) => (paragraph.bullet ? `- ${paragraph.text}` : paragraph.text))
                  .filter((line) => line.trim())
                  .join('\n')
          )
          return [`## ${at + 1}`, ...parts.filter(Boolean)].join('\n\n')
        })
        .join('\n\n')
    } else throw new FileReadError('unsupported')
  } catch (error) {
    if (error instanceof FileReadError) throw error
    throw new FileReadError('unreadable')
  }
  text = text.replace(/\r\n?/g, '\n').trim()
  if (!text.replace(/^#+ \d*$/gm, '').trim()) throw new FileReadError('empty')
  return text
}

/**
 * How much of one file goes with a question, in characters, unless the reader says
 * otherwise: some sixty thousand tokens, a long specification or a scanned document's
 * transcription whole. A longer one goes by its passages the question speaks of, the
 * reader told; a model that reads less says so, and the files are sent again, shorter.
 */
export const FILE_BUDGET = 200000

/**
 * What all the files sent with one question may add up to, in characters, by default:
 * two long files whole, and a dozen documents of a project each with a fair part of it.
 */
export const FILES_TOTAL = 400000

/** The least of a file sent, however many go together or however short the model's reading: a few pages. */
export const FILE_FLOOR = 6000

/** How much of each file goes, when this many go together: never below a few pages. */
export function fileShare(count: number, budget = FILE_BUDGET, total = FILES_TOTAL): number {
  if (count <= 1) return budget
  return Math.min(budget, Math.max(FILE_FLOOR, Math.floor(total / count)))
}

/** The words of a question worth looking for in a document: four letters or more, folded, once each. */
export function questionWords(question: string): string[] {
  const words = fold(question)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4)
  return [...new Set(words)]
}

/** A long block split into pieces of whole lines, so a table is taken a few rows at a time. */
const PIECE = 2000

function pieces(text: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = []
  const blocks = text.split(/(\n{2,})/)
  let at = 0
  for (const block of blocks) {
    if (/^\n+$/.test(block) || !block) {
      at += block.length
      continue
    }
    if (block.length <= PIECE) out.push({ at, text: block })
    else {
      let start = 0
      while (start < block.length) {
        let end = Math.min(block.length, start + PIECE)
        const line = block.lastIndexOf('\n', end)
        if (end < block.length && line > start) end = line
        out.push({ at: at + start, text: block.slice(start, end).replace(/^\n/, '') })
        start = end
      }
    }
    at += block.length
  }
  return out
}

/**
 * The part of a long text a question needs, within a budget: its opening — what the
 * document is — then the passages holding the most of the question's words, in the order
 * the document gives them, a mark where something was left out. Null when no passage
 * holds any of them, and the text is better cut at its budget from the start.
 */
export function excerptFor(text: string, budget: number, words: string[]): string | null {
  if (text.length <= budget || !words.length) return null
  const all = pieces(text)
  const scored = all.map((piece, index) => {
    const folded = fold(piece.text)
    return { index, piece, score: words.filter((word) => folded.includes(word)).length }
  })
  if (!scored.some((each) => each.score > 0)) return null
  const chosen = new Set<number>()
  let used = 0
  // The opening, up to a third of the budget.
  for (const each of scored) {
    if (used + each.piece.text.length > budget / 3) break
    chosen.add(each.index)
    used += each.piece.text.length
  }
  // Then the passages that speak of the question, the most of its words first.
  const ranked = scored
    .filter((each) => each.score > 0 && !chosen.has(each.index))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  for (const each of ranked) {
    if (used + each.piece.text.length > budget) continue
    chosen.add(each.index)
    used += each.piece.text.length
  }
  const parts: string[] = []
  let last = -1
  for (const index of [...chosen].sort((a, b) => a - b)) {
    if (index !== last + 1) parts.push('[…]')
    parts.push(all[index].text)
    last = index
  }
  if (last !== all.length - 1) parts.push('[…]')
  return parts.join('\n\n')
}

export interface ContextFile {
  path: string
  name: string
  text: string
}

export interface FileWords {
  heading: (name: string, path: string) => string
  truncated: (sent: number, total: number) => string
  /** Said when the passages a question needs were sent rather than the file's start. */
  excerpted?: (sent: number, total: number) => string
}

/**
 * The attached files, for the instructions: each whole when it fits its budget; otherwise
 * the passages the question's words are in, or its start cut at a line — the model told
 * which, either way.
 */
export function filesContext(
  files: ContextFile[],
  words: FileWords,
  budget = FILE_BUDGET,
  question: string[] = []
): string {
  return files
    .map((file) => {
      let sent = file.text
      let tail = ''
      if (sent.length > budget) {
        const excerpt = words.excerpted ? excerptFor(file.text, budget, question) : null
        if (excerpt !== null && words.excerpted) {
          sent = excerpt
          tail = `\n\n${words.excerpted(sent.length, file.text.length)}`
        } else {
          const line = sent.lastIndexOf('\n', budget)
          sent = sent.slice(0, line > budget * 0.8 ? line : budget).trimEnd()
          tail = `\n\n${words.truncated(sent.length, file.text.length)}`
        }
      }
      return `${words.heading(file.name, file.path)}\n<file path="${file.path}">\n${sent}${tail}\n</file>`
    })
    .join('\n\n')
}

/** The files the conversation's latest question was asked with, by path. */
export function currentFiles(turns: { role: string; files?: string[] }[]): string[] {
  for (let at = turns.length - 1; at >= 0; at--) {
    if (turns[at].role === 'user') return turns[at].files ?? []
  }
  return []
}
