import { DOCX_TEXT_WIDTH, type DocxBlock, type DocxCell, type DocxRun, type DocxStyle } from './docx'

/**
 * A note made the blocks Word and PDF are written from — the way back of `markdownDoc`.
 *
 * What a note a reader writes as a template holds, no more: headings, paragraphs, quotes,
 * lists, tables, bold and italic. A line break inside a paragraph is kept, as Obsidian
 * shows it; `<br>` breaks a table's cell; a line holding only `&nbsp;` is an empty
 * paragraph, to leave room. Comments (`%%…%%`), the properties, pictures and rules are
 * left out; a link keeps the words it shows.
 */

/** A space no line breaks at: what `&nbsp;` stands for. */
const NBSP = String.fromCharCode(0xa0)

/** A heading's level made a style: `#` the title, `##` a heading, and so on down. */
const HEADINGS: DocxStyle[] = ['Title', 'Heading1', 'Heading2', 'Heading3']

/** The words of a line, with their bold and italic, its links and marks made text. */
export function inlineRuns(source: string): DocxRun[] {
  const text = source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, NBSP)
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, (_, target: string) => target.replace(/#.*$/, '').replace(/^.*\//, ''))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
  const runs: DocxRun[] = []
  let bold = false
  let italic = false
  let current = ''
  const push = (): void => {
    if (!current) return
    const last = runs[runs.length - 1]
    if (last && !!last.bold === bold && !!last.italic === italic) last.text += current
    else runs.push({ text: current, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) })
    current = ''
  }
  for (let at = 0; at < text.length; at++) {
    const char = text[at]
    if (char === '\\' && at + 1 < text.length && /[\\`*_{}[\]()#+\-.!|~=]/.test(text[at + 1])) {
      current += text[++at]
    } else if ((char === '*' || char === '_') && text[at + 1] === char) {
      push()
      bold = !bold
      at++
    } else if (char === '*' || (char === '_' && underscoreMarks(text, at, italic))) {
      push()
      italic = !italic
    } else current += char
  }
  push()
  return runs
}

/** Whether an underscore opens or closes an italic: not one inside a word, as in GC_PL_002. */
function underscoreMarks(text: string, at: number, open: boolean): boolean {
  const before = text[at - 1] ?? ''
  const after = text[at + 1] ?? ''
  return open ? !/\w/.test(after) : !/\w/.test(before) && /\S/.test(after)
}

/** A table row's cells, split on the pipes that are not escaped. */
function cellsOf(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let at = 0; at < inner.length; at++) {
    if (inner[at] === '\\' && inner[at + 1] === '|') {
      cell += '\\|'
      at++
    } else if (inner[at] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += inner[at]
  }
  cells.push(cell.trim())
  return cells
}

const isSeparator = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)

/**
 * The columns' widths, after what they hold: the longest cell of each, its header's word
 * at least, none narrower than a tenth of the line nor wider than three fifths of it.
 */
function widths(rows: string[][], count: number): number[] {
  const longest = Array.from({ length: count }, (_, column) =>
    Math.max(
      4,
      ...rows.map((row) =>
        Math.max(...(row[column] ?? '').split(/<br\s*\/?>/i).map((piece) => piece.replace(/[*_\\]/g, '').length))
      )
    )
  )
  const total = longest.reduce((sum, one) => sum + one, 0)
  const shares = longest.map((one) => Math.min(0.6, Math.max(0.1, one / total)))
  const sum = shares.reduce((acc, one) => acc + one, 0)
  const out = shares.map((share) => Math.floor((share / sum) * DOCX_TEXT_WIDTH))
  out[out.length - 1] += DOCX_TEXT_WIDTH - out.reduce((acc, one) => acc + one, 0)
  return out
}

/** The note's text without its properties nor its comments. */
export function noteBody(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---(\n|$)/, '')
    .replace(/%%[\s\S]*?%%/g, '')
}

export function markdownBlocks(markdown: string): DocxBlock[] {
  const lines = noteBody(markdown).split('\n')
  const blocks: DocxBlock[] = []
  let paragraph: string[] = []
  let quote: string[] = []
  const flush = (): void => {
    if (paragraph.length) blocks.push({ kind: 'p', style: 'Normal', runs: inlineRuns(paragraph.join('\n')) })
    if (quote.length) blocks.push({ kind: 'p', style: 'Quote', runs: inlineRuns(quote.join('\n')) })
    paragraph = []
    quote = []
  }
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flush()
      const style = HEADINGS[Math.min(heading[1].length, HEADINGS.length) - 1]
      blocks.push({ kind: 'p', style, runs: inlineRuns(heading[2].replace(/\s+#+$/, '')) })
      continue
    }
    if (trimmed.startsWith('|') && isSeparator(lines[at + 1] ?? '')) {
      flush()
      const head = cellsOf(trimmed)
      const body: string[][] = []
      at += 2
      while (at < lines.length && lines[at].trim().startsWith('|')) body.push(cellsOf(lines[at++]))
      at--
      const sizes = widths([head, ...body], head.length)
      const cell = (text: string, column: number, bold = false): DocxCell => ({
        runs: inlineRuns(text).map((run) => (bold ? { ...run, bold: true } : run)),
        width: sizes[column]
      })
      blocks.push({
        kind: 'table',
        header: head.map((text, column) => cell(text, column, true)),
        rows: body.map((row) => head.map((_, column) => cell(row[column] ?? '', column)))
      })
      continue
    }
    if (trimmed.startsWith('>')) {
      if (paragraph.length) flush()
      const text = trimmed.replace(/^>\s?/, '').replace(/^\[![\w-]+\][+-]?\s*/, '')
      quote.push(text)
      continue
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed)
    if (bullet) {
      flush()
      blocks.push({ kind: 'p', style: 'Bullet', runs: inlineRuns(bullet[1]) })
      continue
    }
    // A picture, alone on its line: not drawn here.
    if (/^!\[\[[^\]]*\]\]$|^!\[[^\]]*\]\([^)]*\)$/.test(trimmed)) continue
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush()
      continue
    }
    if (quote.length) flush()
    if (/^(&nbsp;|<br\s*\/?>)$/i.test(trimmed)) {
      flush()
      blocks.push({ kind: 'p', style: 'Normal', runs: [] })
      continue
    }
    paragraph.push(trimmed)
  }
  flush()
  return blocks
}
