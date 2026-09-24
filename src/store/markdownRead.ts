import type { DocxReadBlock, DocxReadParagraph } from './docxRead'

/**
 * A Markdown document, read into the paragraphs and tables a Word document reads into.
 *
 * The Markdown that documents are written in, not all of CommonMark: headings, paragraphs,
 * quotes, lists, pipe tables, and the emphasis, links and escapes inside them. Code is
 * code and is skipped whole — a `pm-req` block in a note is a query of the library, not
 * requirements to import.
 *
 * Two liberties, both to read the plugin's own exports back exactly:
 *
 * - Lines of one paragraph keep their line breaks. Markdown would join them, but a
 *   requirement written on three lines was exported on three lines, and must come back so.
 * - A paragraph set wholly in italics is a note under something — the badge line under a
 *   requirement's heading — rather than prose.
 */

export interface MarkdownRead {
  blocks: DocxReadBlock[]
  /** The front matter's fields, as written. `language` says what the wordings are in. */
  front: Record<string, string>
}

export interface MarkdownReadOptions {
  /** Paragraphs that open with one of these and a colon are notes — `Source : CDC §4`. */
  notePrefixes?: string[]
}

/** Emphasis, links and escapes taken off, leaving the words. */
export function plainInline(text: string): string {
  return (
    text
      // A link's words, a wiki link's alias or target, an image's nothing.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      // Emphasis around words, never a lone star between numbers.
      .replace(/(?<![\w*])(\*{1,3}|_{1,3})(?=\S)([\s\S]*?\S)\1(?![\w*])/g, '$2')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
  )
}

function frontMatter(lines: string[]): { front: Record<string, string>; from: number } {
  const front: Record<string, string> = {}
  if (lines[0]?.trim() !== '---') return { front, from: 0 }
  const end = lines.findIndex((line, at) => at > 0 && line.trim() === '---')
  if (end === -1) return { front, from: 0 }
  for (const line of lines.slice(1, end)) {
    const found = /^([\w-]+):\s*(.*)$/.exec(line)
    if (!found) continue
    let value = found[2].trim()
    if (/^".*"$/.test(value)) {
      try {
        value = String(JSON.parse(value))
      } catch {
        value = value.slice(1, -1)
      }
    } else if (/^'.*'$/.test(value)) value = value.slice(1, -1)
    front[found[1]] = value
  }
  return { front, from: end + 1 }
}

/** A pipe table's row as cells: split on the pipes that are not escaped. */
function cells(line: string): string[] {
  const inner = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
  return inner.split(/(?<!\\)\|/).map((cell) => plainInline(cell.trim()).trim())
}

const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const FENCE = /^\s*(`{3,}|~{3,})/

export function readMarkdown(source: string, options: MarkdownReadOptions = {}): MarkdownRead {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const { front, from } = frontMatter(lines)
  const blocks: DocxReadBlock[] = []
  let paragraph: string[] = []
  let quote: string[] = []

  const flushParagraph = (): void => {
    if (!paragraph.length) return
    const raw = paragraph.join('\n').trim()
    paragraph = []
    if (!raw) return
    // Wholly in single italics: a note under something rather than prose.
    const italic = /^\*(?!\*)([\s\S]*\S)\*$/.exec(raw) ?? /^_(?!_)([\s\S]*\S)_$/.exec(raw)
    const text = plainInline(italic ? italic[1] : raw)
    const noted = options.notePrefixes?.some((prefix) =>
      new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'i').test(text)
    )
    blocks.push({ kind: 'p', style: italic || noted ? 'meta' : 'normal', styleName: '', text })
  }
  const flushQuote = (): void => {
    if (!quote.length) return
    const text = plainInline(quote.join('\n').trim())
    quote = []
    if (text) blocks.push({ kind: 'p', style: 'quote', styleName: '', text })
  }
  const flush = (): void => {
    flushParagraph()
    flushQuote()
  }

  for (let at = from; at < lines.length; at++) {
    const line = lines[at]
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const close = lines.findIndex((each, index) => index > at && each.trim().startsWith(fence[1]))
      at = close === -1 ? lines.length : close
      continue
    }
    if (/^\s*<!--/.test(line)) {
      flush()
      const close = lines.findIndex((each, index) => index >= at && each.includes('-->'))
      at = close === -1 ? lines.length : close
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      flush()
      blocks.push({
        kind: 'p',
        style: 'heading',
        level: heading[1].length,
        styleName: '',
        text: plainInline(heading[2])
      })
      continue
    }
    if (line.trim().startsWith('|') && SEPARATOR.test(lines[at + 1] ?? '')) {
      flush()
      const rows = [cells(line)]
      at += 2
      while (at < lines.length && lines[at].trim().startsWith('|')) rows.push(cells(lines[at++]))
      at -= 1
      blocks.push({ kind: 'table', rows })
      continue
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line)
    if (quoted) {
      flushParagraph()
      quote.push(quoted[1])
      continue
    }
    flushQuote()
    const item = LIST.exec(line)
    if (item && !paragraph.length) {
      // An item, and the lines indented under it that go on with it.
      const text = [item[3]]
      while (at + 1 < lines.length && /^\s{2,}\S/.test(lines[at + 1]) && !LIST.test(lines[at + 1])) {
        text.push(lines[++at].trim())
      }
      blocks.push({ kind: 'p', style: 'list', styleName: '', text: plainInline(text.join('\n')) })
      continue
    }
    // A setext heading: a line underlined with = or -.
    if (paragraph.length === 1 && /^\s*(=+|-+)\s*$/.test(line)) {
      const text = plainInline(paragraph[0].trim())
      paragraph = []
      blocks.push({ kind: 'p', style: 'heading', level: line.trim().startsWith('=') ? 1 : 2, styleName: '', text })
      continue
    }
    paragraph.push(line)
  }
  flush()

  // One first-level heading, before any other: the document's title, and every heading
  // under it a level up — the exports write the title as `#` and categories as `##`.
  const headings = blocks.filter((block): block is DocxReadParagraph => block.kind === 'p' && block.style === 'heading')
  if (headings[0]?.level === 1 && headings.filter((block) => block.level === 1).length === 1) {
    headings[0].style = 'title'
    delete headings[0].level
    for (const block of headings.slice(1)) block.level = Math.max(1, (block.level ?? 2) - 1)
  }
  return { blocks, front }
}
