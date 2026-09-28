import { readDocx, type DocxReadBlock } from '../docxRead'
import { readHtml } from '../htmlRead'
import { readPdf } from '../pdfRead'
import { pdfBlocks } from '../pdfText'
import { readPptx } from '../pptxRead'
import { readXlsx } from '../xlsxRead'

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

/** The extensions read as plain text, as they are. */
const PLAIN = new Set(['md', 'txt', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'ics', 'log', 'eml'])

/** Every extension a file can be attached with. */
export const READABLE_EXTENSIONS = new Set([...PLAIN, 'pdf', 'docx', 'xlsx', 'pptx', 'html', 'htm'])

export function isReadable(extension: string): boolean {
  return READABLE_EXTENSIONS.has(extension.toLowerCase())
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
 * The file's text. Throws a `FileReadError` saying why when there is none to give: the
 * format is not one of these, the file holds no text (a scanned PDF), or it does not read.
 */
export async function fileText(extension: string, bytes: Uint8Array): Promise<string> {
  const ext = extension.toLowerCase()
  let text: string
  try {
    if (PLAIN.has(ext)) text = new TextDecoder().decode(bytes)
    else if (ext === 'html' || ext === 'htm') text = blocksText(readHtml(new TextDecoder().decode(bytes)))
    else if (ext === 'pdf') text = blocksText(pdfBlocks(await readPdf(bytes)))
    else if (ext === 'docx') text = blocksText(await readDocx(bytes))
    else if (ext === 'xlsx') {
      text = (await readXlsx(bytes))
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
 * How much of one file goes with a question, in characters: a planning of a few hundred
 * lines whole, a long specification cut.
 */
export const FILE_BUDGET = 30000

export interface ContextFile {
  path: string
  name: string
  text: string
}

export interface FileWords {
  heading: (name: string, path: string) => string
  truncated: (sent: number, total: number) => string
}

/** The attached files, each whole or cut at a line with the model told so, for the instructions. */
export function filesContext(files: ContextFile[], words: FileWords, budget = FILE_BUDGET): string {
  return files
    .map((file) => {
      let sent = file.text
      let tail = ''
      if (sent.length > budget) {
        const line = sent.lastIndexOf('\n', budget)
        sent = sent.slice(0, line > budget * 0.8 ? line : budget).trimEnd()
        tail = `\n\n${words.truncated(sent.length, file.text.length)}`
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
