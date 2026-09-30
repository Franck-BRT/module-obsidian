import { parseFrontmatter } from '../YamlParser'
import { fold } from '../library/libraryDoc'

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
export function readTranscript(
  content: string
): { sourceMtime: number; text: string; model: string; at: string; pages: number } | null {
  const { frontmatter, body } = parseFrontmatter(content)
  if (!frontmatter || frontmatter[TRANSCRIPT_KEY] === undefined) return null
  const mtime = Number(frontmatter['source-mtime'])
  const pages = Number(frontmatter.pages)
  // The heading line the note opens with is the plugin's, not the document's.
  const text = body.replace(/^\s*>[^\n]*\n/, '').trim()
  return {
    sourceMtime: Number.isFinite(mtime) ? mtime : 0,
    text,
    model: typeof frontmatter.model === 'string' ? frontmatter.model : '',
    at: typeof frontmatter.at === 'string' ? frontmatter.at : '',
    pages: Number.isFinite(pages) ? pages : 0
  }
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

/** Where a transcription opens and closes in a library record: comments, unseen when read. */
const SECTION_OPEN = '%% pm-transcript'
const SECTION_CLOSE = '%% /pm-transcript %%'

/** A transcription's headings, one level down: it sits under its own heading in the record. */
function demoted(text: string): string {
  return text.replace(/^(#{1,5}) /gm, '#$1 ')
}

/**
 * A library record with the transcription of its document in it: the section it already
 * has replaced, or one added at its end — under its heading, what it was read from kept
 * in a comment, the text as the model read it.
 */
export function withTranscriptSection(
  content: string,
  meta: Omit<TranscriptMeta, 'source'>,
  text: string,
  words: { heading: string; note: string }
): string {
  const facts = JSON.stringify({ sourceMtime: meta.sourceMtime, model: meta.model, at: meta.at, pages: meta.pages })
  const section = [
    `## ${words.heading}`,
    '',
    `${SECTION_OPEN} ${facts} %%`,
    words.note,
    '',
    demoted(text.trim()),
    '',
    SECTION_CLOSE
  ].join('\n')
  const found = sectionAt(content)
  if (found) return `${content.slice(0, found.start)}${section}${content.slice(found.end)}`
  return `${content.replace(/\s*$/, '')}\n\n${section}\n`
}

/** Where the section is: from its heading, when right above it, to its closing comment. */
function sectionAt(content: string): { start: number; end: number } | null {
  const open = content.indexOf(SECTION_OPEN)
  if (open < 0) return null
  const close = content.indexOf(SECTION_CLOSE, open)
  const end = close < 0 ? content.length : close + SECTION_CLOSE.length
  // Its heading comes with it, when nothing but blank lines stands between them.
  const before = content.slice(0, open)
  const heading = /(^|\n)## [^\n]*\n\s*$/.exec(before)
  return { start: heading ? heading.index + heading[1].length : open, end }
}

/**
 * The transcription a library record holds: its text — as the reader may have corrected
 * it — and the time of the document it was read from. Null when it holds none.
 */
export function readTranscriptSection(content: string): { sourceMtime: number; text: string } | null {
  const open = content.indexOf(SECTION_OPEN)
  if (open < 0) return null
  const lineEnd = content.indexOf('\n', open)
  const line = content.slice(open + SECTION_OPEN.length, lineEnd < 0 ? content.length : lineEnd)
  let sourceMtime = 0
  try {
    const facts = JSON.parse(line.replace(/%%\s*$/, '').trim()) as { sourceMtime?: unknown }
    const mtime = Number(facts.sourceMtime)
    sourceMtime = Number.isFinite(mtime) ? mtime : 0
  } catch {
    // Its facts unreadable: read again, as a document that changed would be.
  }
  if (lineEnd < 0) return { sourceMtime, text: '' }
  const close = content.indexOf(SECTION_CLOSE, lineEnd)
  const body = content.slice(lineEnd + 1, close < 0 ? content.length : close)
  // The line the section opens with is the plugin's, not the document's.
  const text = body.replace(/^\s*>[^\n]*\n/, '').trim()
  return { sourceMtime, text }
}

/** A line repeated from page to page — a running header, a footer, a page number — and how often it went. */
export interface Furniture {
  line: string
  count: number
}

/** How many lines at the top and at the bottom of a page are where headers and footers sit. */
const FURNITURE_ZONE = 3

/** The heading a transcription opens each page with: « Page 3 sur 19 », « Page 3 of 19 ». */
const PAGE_MARK = /^#{1,6}\s+page\s+\d+\s+(?:sur|of|\/)\s+\d+\s*$/i

/** What a line is known by from page to page: its words, whatever its numbers and emphasis; null when it is no candidate. */
function furnitureKey(line: string): string | null {
  const bare = line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Markup — tables, formulas, pictures — and lines of a word or two are the document's own;
  // a short one with a number in it — « S 7 212 - 4 », « 12 » — may be a page's number.
  if (!bare || /^[<|$!]/.test(bare) || PAGE_MARK.test(line.trim())) return null
  const letters = (bare.match(/\p{L}/gu) ?? []).length
  const numbered = bare.length <= 30 && /\d/.test(bare)
  if (letters < 3 && !numbered) return null
  // Its numbers aside only when it reads like a page's number: a line of text that differs
  // by a number from one page to the next — « chapitre 2 », « total : 12 € » — is text.
  const pageLike = numbered && (letters < 3 || /^\W*(?:page|p\.)\s*\d+(?:\s*(?:\/|sur|of|de)\s*\d+)?\W*$/i.test(bare))
  return pageLike ? fold(bare).replace(/\d+/g, '#') : fold(bare)
}

/**
 * A transcription without what the printed pages repeat: a line found at the top or the
 * bottom of two pages or more, or on two pages in five anywhere, is the page's furniture
 * and goes — every occurrence of it, but the first of a heading, which is the document's
 * title as often as a running header. Pages are told apart by the headings the
 * transcription opens them with; a text of one page is left as it is.
 */
export function stripFurniture(text: string): { text: string; removed: Furniture[] } {
  const lines = text.split('\n')
  const pages: number[][] = []
  for (let at = 0; at < lines.length; at++) {
    if (PAGE_MARK.test(lines[at].trim())) pages.push([])
    else if (pages.length && lines[at].trim()) pages[pages.length - 1].push(at)
  }
  if (pages.length < 2) return { text, removed: [] }
  const onPages = new Map<string, number>()
  const inZone = new Map<string, number>()
  for (const page of pages) {
    const seen = new Set<string>()
    const zone = new Set<string>()
    // A page too short to have a middle has no top nor bottom to tell from it.
    const zoned = page.length > 2 * FURNITURE_ZONE
    page.forEach((at, index) => {
      const key = furnitureKey(lines[at])
      if (!key) return
      seen.add(key)
      if (zoned && (index < FURNITURE_ZONE || index >= page.length - FURNITURE_ZONE)) zone.add(key)
    })
    for (const key of seen) onPages.set(key, (onPages.get(key) ?? 0) + 1)
    for (const key of zone) inZone.set(key, (inZone.get(key) ?? 0) + 1)
  }
  const often = Math.max(3, Math.ceil(pages.length * 0.4))
  const furniture = (key: string): boolean => (inZone.get(key) ?? 0) >= 2 || (onPages.get(key) ?? 0) >= often
  const removed = new Map<string, Furniture>()
  const keptHeading = new Set<string>()
  const kept: string[] = []
  for (const line of lines) {
    const key = furnitureKey(line)
    if (key && furniture(key)) {
      if (/^\s*#/.test(line) && !keptHeading.has(key)) {
        keptHeading.add(key)
        kept.push(line)
        continue
      }
      const found = removed.get(key)
      if (found) found.count++
      else removed.set(key, { line: line.trim(), count: 1 })
      continue
    }
    kept.push(line)
  }
  if (!removed.size) return { text, removed: [] }
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n'), removed: [...removed.values()] }
}

/**
 * A note's transcription without its pages' furniture: the section of a library record,
 * or the body of a transcription note. Null when the note holds no transcription.
 */
export function cleanTranscriptIn(content: string): { content: string; removed: Furniture[] } | null {
  const open = content.indexOf(SECTION_OPEN)
  if (open >= 0) {
    const from = content.indexOf('\n', open)
    if (from < 0) return { content, removed: [] }
    const close = content.indexOf(SECTION_CLOSE, from)
    const to = close < 0 ? content.length : close
    const cleaned = stripFurniture(content.slice(from + 1, to))
    return { content: `${content.slice(0, from + 1)}${cleaned.text}${content.slice(to)}`, removed: cleaned.removed }
  }
  if (!readTranscript(content)) return null
  const end = content.indexOf('\n---', 3)
  const bodyAt = end < 0 ? 0 : content.indexOf('\n', end + 1) + 1
  const cleaned = stripFurniture(content.slice(bodyAt))
  return { content: `${content.slice(0, bodyAt)}${cleaned.text}`, removed: cleaned.removed }
}
