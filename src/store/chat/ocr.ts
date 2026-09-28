import { parseFrontmatter } from '../YamlParser'

/**
 * A document with no text in it — a scanned planning, a Gantt exported as a picture —
 * read by a model that sees.
 *
 * Page by page: each page drawn as an image and handed to the model with the same
 * instruction, its transcription kept under the page's number. A page that cannot be
 * read is said to be so, in its place, and the others still are; past a number of pages,
 * the rest are named rather than read, since each is a request that takes its time.
 *
 * The transcription is kept as a note beside the document. It is what the chat reads
 * from then on, as long as the document has not changed — reading a scan is slow and not
 * free — and it is the reader's to check and to correct, since what the model made of a
 * blurred date is what the plan will be updated from.
 */

export const TRANSCRIPT_KEY = 'pm-transcript'

/** How many pages are read at most: a planning, not a whole specification. */
export const OCR_PAGE_LIMIT = 30

/**
 * Whether a PDF's text is too thin to be the document: less than a few lines a page is
 * a title block around a picture, which is what a planning exported as an image is.
 */
export function needsOcr(text: string, pages: number): boolean {
  const letters = text.replace(/^#+ .*$/gm, '').replace(/\s+/g, '').length
  return letters < 80 * Math.max(1, pages)
}

export interface OcrWords {
  page: (page: number, total: number) => string
  failed: (page: number, reason: string) => string
  skipped: (count: number) => string
}

export interface OcrSource {
  pages: number
  /** The page, drawn as an image, as a data URL. */
  render: (page: number) => Promise<string>
}

/** Every page, read in turn; `progress` is told before each one. */
export async function transcribe(
  source: OcrSource,
  read: (image: string, page: number, total: number) => Promise<string>,
  words: OcrWords,
  progress: (page: number, total: number) => void = () => {},
  limit = OCR_PAGE_LIMIT
): Promise<{ text: string; read: number; failed: number }> {
  const total = source.pages
  const shown = Math.min(total, limit)
  const parts: string[] = []
  let failed = 0
  for (let page = 1; page <= shown; page++) {
    progress(page, shown)
    let body: string
    try {
      body = (await read(await source.render(page), page, total)).trim()
    } catch (error) {
      failed++
      body = words.failed(page, error instanceof Error ? error.message : String(error))
    }
    parts.push(total > 1 ? `## ${words.page(page, total)}\n\n${body}` : body)
  }
  if (total > shown) parts.push(words.skipped(total - shown))
  return { text: parts.join('\n\n'), read: shown - failed, failed }
}

export interface TranscriptMeta {
  /** The document it was read from, by path. */
  source: string
  /** The document's modification time when it was read: a newer one is read again. */
  sourceMtime: number
  model: string
  at: string
  pages: number
}

/** The note the transcription is kept in: where it came from, then the text. */
export function transcriptNote(meta: TranscriptMeta, text: string, heading: string): string {
  const target = meta.source
  return [
    '---',
    `${TRANSCRIPT_KEY}: ${JSON.stringify(`[[${target}]]`)}`,
    `source-mtime: ${meta.sourceMtime}`,
    `model: ${JSON.stringify(meta.model)}`,
    `at: ${JSON.stringify(meta.at)}`,
    `pages: ${meta.pages}`,
    '---',
    '',
    heading,
    '',
    text,
    ''
  ].join('\n')
}

/**
 * A transcription read back: its text — as the reader may have corrected it — and the
 * time of the document it was read from. Null when the note is not one.
 */
export function readTranscript(content: string): { sourceMtime: number; text: string } | null {
  const { frontmatter, body } = parseFrontmatter(content)
  if (!frontmatter || frontmatter[TRANSCRIPT_KEY] === undefined) return null
  const mtime = Number(frontmatter['source-mtime'])
  // The heading line the note opens with is the plugin's, not the document's.
  const text = body.replace(/^\s*>[^\n]*\n/, '').trim()
  return { sourceMtime: Number.isFinite(mtime) ? mtime : 0, text }
}

/** Where a document's transcription is kept: beside it, named after it. */
export function transcriptPath(source: string, suffix: string): string {
  const slash = source.lastIndexOf('/')
  const folder = slash >= 0 ? source.slice(0, slash + 1) : ''
  const name = source.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return `${folder}${base} (${suffix}).md`
}
