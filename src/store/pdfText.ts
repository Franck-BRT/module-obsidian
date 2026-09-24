import type { DocxReadBlock, DocxReadParagraph } from './docxRead'
import type { PdfContent, PdfContentRef, PdfRectItem, PdfStructElement, PdfTextItem } from './pdfRead'
import { charWidth } from './pdfFont'

/**
 * A PDF's text, put back into paragraphs and tables.
 *
 * The file only says where each word was drawn. So the document's shape is worked out
 * from the page the way a reader's eye does it: words on one baseline are a line, a gap
 * wider than a space is a space, lines close together in the same size are a paragraph, a
 * size well above the text's is a heading, small italics are a caption, and text inside
 * drawn boxes is a table. What comes out is the same shape a Word document reads into, so
 * the requirements are found in it by the same rules.
 *
 * Two decisions are guesses, and are made the way the plugin's own PDF export would have
 * to be read back exactly:
 *
 * - Whether a line ended because the words ran out of room or because the author broke
 *   it. The test is the one the layout used: would the next line's first word have fit
 *   at the end of this one? If not, the line was wrapped and the two join with a space.
 * - Where a table is. Only tables drawn with a box around each cell are recognised as
 *   tables; one drawn with loose rules reads as its text, line by line.
 */

interface Line {
  page: number
  x: number
  right: number
  y: number
  size: number
  bold: boolean
  italic: boolean
  text: string
  /** The width of the first word, to tell a wrapped line from a broken one. */
  firstWord: number
  /** Where the words start after a bullet, so the item's next lines are known as its own. */
  textX: number
}

const near = (a: number, b: number, by = 1): boolean => Math.abs(a - b) <= by

/** A space in the font at hand, near enough: the gap below which two pieces touch. */
const SPACE = 0.2

function firstWordWidth(item: PdfTextItem): number {
  const word = item.text.trimStart().split(/\s/)[0] ?? ''
  return item.text.length ? (item.width * word.length) / item.text.length : 0
}

/** Pieces of text on one baseline, left to right, as one line. */
function lineOf(items: PdfTextItem[]): Line {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  let text = ''
  let right = -Infinity
  let bulletEnd: number | undefined
  const chars = new Map<number, number>()
  let previous: PdfTextItem | undefined
  for (const item of sorted) {
    // The same text drawn twice in the same place — a bold faked by overprinting — once.
    if (previous && previous.text === item.text && near(previous.x, item.x, 0.5)) continue
    previous = item
    if (
      right !== -Infinity &&
      item.x - right > SPACE * item.size &&
      !text.endsWith(' ') &&
      !item.text.startsWith(' ')
    ) {
      text += ' '
    }
    if (text === '' && /^[•·▪◦‣-]$/.test(item.text.trim())) bulletEnd = item.x + item.width
    text += item.text
    right = Math.max(right, item.x + item.width)
    chars.set(item.size, (chars.get(item.size) ?? 0) + item.text.length)
  }
  const size = [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? sorted[0].size
  const after =
    bulletEnd === undefined ? sorted[0] : sorted.find((item) => item.x >= bulletEnd - 0.5 && item.text.trim() !== '•')
  const lettered = sorted.filter((item) => item.text.trim() !== '')
  return {
    page: sorted[0].page,
    x: sorted[0].x,
    right,
    y: sorted[0].y,
    size,
    bold: lettered.every((item) => item.bold),
    italic: lettered.every((item) => item.italic),
    text: text.replace(/\s+$/, ''),
    firstWord: firstWordWidth(after ?? sorted[0]),
    textX: (after ?? sorted[0]).x
  }
}

/** Words into lines: the same page, and baselines within a third of the text's height. */
function linesOf(items: PdfTextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  const groups: PdfTextItem[][] = []
  for (const item of sorted) {
    const last = groups[groups.length - 1]
    if (last && last[0].page === item.page && Math.abs(last[0].y - item.y) < 0.3 * Math.max(item.size, last[0].size)) {
      last.push(item)
    } else groups.push([item])
  }
  return groups.map(lineOf).filter((line) => line.text.trim() !== '')
}

/**
 * Two lines of one paragraph, joined as the author wrote them: by a space where the first
 * ran out of room, by a line break where the author broke it.
 */
function join(previous: Line, next: Line, limit: number): string {
  const wrapped = previous.right + SPACE * next.size + next.firstWord > limit - 0.5
  if (!wrapped || previous.italic !== next.italic) return '\n'
  // One word filling the column to within a letter was too long for it and was cut,
  // not wrapped: `OMLX-THER` over `M-0001` is one identifier.
  // The test is the cutter's own: not even the next line's first letter would have fitted.
  const single = !/\s/.test(previous.text.trim())
  const letter = (charWidth(next.text.charAt(0)) / 1000) * next.size
  return single && previous.right + letter > limit - 0.5 ? '' : ' '
}

function joinLines(lines: Line[], limit: number): string {
  return lines.map((line, at) => (at === 0 ? line.text : `${join(lines[at - 1], line, limit)}${line.text}`)).join('')
}

/* ---- Running heads and feet ----------------------------------------------------- */

/**
 * Lines that sit at the same place on most pages — a running title, "Page 3 of 12" — are
 * the page's furniture, not the document's text.
 */
function furniture(lines: Line[], pages: number): Set<Line> {
  const out = new Set<Line>()
  if (pages < 3) return out
  const key = (line: Line): string => `${Math.round(line.y / 2)}|${line.text.replace(/\d+/g, '#')}`
  const count = new Map<string, Set<number>>()
  for (const line of lines) {
    const pagesSeen = count.get(key(line)) ?? new Set<number>()
    pagesSeen.add(line.page)
    count.set(key(line), pagesSeen)
  }
  for (const line of lines) if ((count.get(key(line))?.size ?? 0) >= Math.max(3, pages * 0.6)) out.add(line)
  return out
}

/* ---- Tables --------------------------------------------------------------------- */

interface Cell {
  rect: PdfRectItem
  items: PdfTextItem[]
}

interface TableRow {
  top: number
  cells: Cell[]
}

interface Table {
  page: number
  top: number
  rows: TableRow[]
}

/**
 * Boxes drawn around text, into tables: boxes of one height side by side are a row, rows
 * with the same columns stacked edge to edge are a table.
 */
function tablesOf(rects: PdfRectItem[], page: number): Table[] {
  const boxes = rects.filter((rect) => rect.page === page && rect.width > 2 && rect.height > 2)
  const rows: { top: number; bottom: number; cells: PdfRectItem[] }[] = []
  for (const box of [...boxes].sort((a, b) => b.y + b.height - (a.y + a.height) || a.x - b.x)) {
    const row = rows.find((each) => near(each.top, box.y + box.height) && near(each.bottom, box.y))
    if (row) row.cells.push(box)
    else rows.push({ top: box.y + box.height, bottom: box.y, cells: [box] })
  }
  const tables: Table[] = []
  let current: { columns: number[]; bottom: number; table: Table } | undefined
  for (const row of rows) {
    if (row.cells.length < 2) {
      current = undefined
      continue
    }
    row.cells.sort((a, b) => a.x - b.x)
    const columns = row.cells.map((cell) => cell.x)
    const continues =
      current !== undefined &&
      near(current.bottom, row.top, 2) &&
      current.columns.length === columns.length &&
      current.columns.every((x, at) => near(x, columns[at]))
    if (!continues || !current) {
      current = { columns, bottom: row.bottom, table: { page, top: row.top, rows: [] } }
      tables.push(current.table)
    }
    current.bottom = row.bottom
    current.table.rows.push({ top: row.top, cells: row.cells.map((rect) => ({ rect, items: [] })) })
  }
  return tables
}

function inside(item: PdfTextItem, rect: PdfRectItem): boolean {
  return (
    item.x >= rect.x - 0.5 &&
    item.x < rect.x + rect.width &&
    item.y >= rect.y - 0.5 &&
    item.y <= rect.y + rect.height + 0.5
  )
}

/** A cell's text: its lines joined by the same rule as a paragraph's, against its own edge. */
function cellLines(cell: Cell): Line[] {
  return linesOf(cell.items)
}

/* ---- Paragraphs ----------------------------------------------------------------- */

interface Paragraph {
  lines: Line[]
  limit: number
}

function sameStyle(a: Line, b: Line): boolean {
  return near(a.size, b.size, 0.3) && a.bold === b.bold && a.italic === b.italic
}

function startsBullet(line: Line): boolean {
  return /^[•·▪◦‣]\s/.test(line.text)
}

/**
 * Whether the document sets its paragraphs apart with space. Where it does, a line that
 * ends short inside tight spacing is a break the author wrote; where it does not, the
 * short line is the only sign a paragraph ended.
 */
function spacesParagraphs(lines: Line[]): boolean {
  let gaps = 0
  let wide = 0
  for (let at = 1; at < lines.length; at++) {
    const [a, b] = [lines[at - 1], lines[at]]
    if (a.page !== b.page || !near(a.size, b.size, 0.3)) continue
    gaps += 1
    if (a.y - b.y > 1.5 * b.size) wide += 1
  }
  // Said only on evidence: a page of three lines shows nothing either way, and then a
  // short line is taken for the break it looks like.
  return gaps < 5 || wide >= gaps * 0.1
}

/** Lines into paragraphs: kept together while they look alike and sit a line apart. */
function paragraphsOf(lines: Line[], limitOf: (page: number) => number): Paragraph[] {
  const spaced = spacesParagraphs(lines)
  const out: Paragraph[] = []
  let current: Paragraph | undefined
  for (const line of lines) {
    const last = current?.lines[current.lines.length - 1]
    let continues = false
    if (current && last && sameStyle(last, line) && !startsBullet(line)) {
      const first = current.lines[0]
      const aligned = near(line.x, first.x, 3) || near(line.x, first.textX, 3)
      if (line.page === last.page) {
        continues =
          aligned && last.y - line.y <= 1.5 * line.size && (spaced || join(last, line, current.limit) !== '\n')
      } else {
        // Over a page break, only where the last line ran out of room: a paragraph that
        // ended at the foot of a page and one that goes on look otherwise the same.
        continues = aligned && join(last, line, current.limit) === ' '
      }
    }
    if (continues && current) current.lines.push(line)
    else {
      current = { lines: [line], limit: limitOf(line.page) }
      out.push(current)
    }
  }
  return out
}

/**
 * What each paragraph is, from its size and slant against the text around it: the body's
 * size is the one most characters are set in, and a heading stands above it.
 */
function classify(paragraphs: Paragraph[]): DocxReadParagraph[] {
  const body = bodySize(paragraphs.flatMap((paragraph) => paragraph.lines))
  const left = Math.min(...paragraphs.filter((p) => near(p.lines[0].size, body, 0.3)).map((p) => p.lines[0].x))

  const isHeading = (paragraph: Paragraph): boolean => {
    const line = paragraph.lines[0]
    const text = paragraph.lines.map((each) => each.text).join(' ')
    return line.size >= body * 1.12 || (line.bold && line.size > body * 1.04 && text.length < 160)
  }
  const sizes = [...new Set(paragraphs.filter(isHeading).map((p) => Math.round(p.lines[0].size * 2) / 2))].sort(
    (a, b) => b - a
  )
  // The largest size, once, before anything else: the document's title rather than a heading.
  const first = paragraphs[0]
  const titled =
    first !== undefined &&
    isHeading(first) &&
    Math.round(first.lines[0].size * 2) / 2 === sizes[0] &&
    paragraphs.filter((p) => Math.round(p.lines[0].size * 2) / 2 === sizes[0]).length === 1
  const levels = titled ? sizes.slice(1) : sizes

  return paragraphs.map((paragraph, at): DocxReadParagraph => {
    const line = paragraph.lines[0]
    let text = joinLines(paragraph.lines, paragraph.limit)
    const base = { kind: 'p' as const, styleName: '', text }
    if (isHeading(paragraph)) {
      if (titled && at === 0) return { ...base, style: 'title' }
      return { ...base, style: 'heading', level: levels.indexOf(Math.round(line.size * 2) / 2) + 1 }
    }
    if (startsBullet(line)) {
      text = text.replace(/^[•·▪◦‣]\s*/, '')
      return { ...base, style: 'list', text }
    }
    if (line.italic && line.size < body * 0.95) return { ...base, style: 'meta' }
    if (line.italic && line.x > left + 5) return { ...base, style: 'quote' }
    return { ...base, style: 'normal' }
  })
}

export interface PdfBlockOptions {
  /**
   * Whether a row, first on a page under a repeated header, starts a row of its own rather
   * than finishing the one the page break cut. Only the table's meaning can say: the
   * default takes an empty first cell for the rest of a cut row, and a requirements table
   * knows better — a row without a whole identifier in its identifier column is one.
   */
  startsRow?: (header: string[], cells: string[]) => boolean
}

/* ---- A tagged PDF ------------------------------------------------------------------ */

const GROUPING = new Set([
  'Document',
  'Part',
  'Art',
  'Sect',
  'Div',
  'NonStruct',
  'Private',
  'BlockQuote',
  'TOC',
  'TOCI',
  'Index'
])

/**
 * The document as its structure tree says it was written: a paragraph is what the author
 * made a paragraph, a heading is a heading, a cell is a cell. The page furniture is not in
 * the tree, and falls away by itself.
 *
 * Null when the tree does not account for most of the text — a file tagged by a tool that
 * only tagged some of it — and the page is then read from where the text sits instead.
 */
function structuredBlocks(content: PdfContent, structure: PdfStructElement): DocxReadBlock[] | null {
  const byRef = new Map<string, PdfTextItem[]>()
  for (const item of content.items) {
    if (item.mcid === undefined) continue
    const key = `${item.page}:${item.mcid}`
    byRef.set(key, [...(byRef.get(key) ?? []), item])
  }
  const reached = new Set<string>()

  const refsUnder = (node: PdfStructElement, out: PdfContentRef[] = []): PdfContentRef[] => {
    for (const kid of node.kids) {
      if ('mcid' in kid) out.push(kid)
      else refsUnder(kid, out)
    }
    return out
  }
  const itemsOf = (refs: PdfContentRef[]): PdfTextItem[] =>
    refs.flatMap((ref) => {
      const key = `${ref.page}:${ref.mcid}`
      reached.add(key)
      return byRef.get(key) ?? []
    })
  /** A piece of the tree's text as lines, joined against its own widest line. */
  const textOf = (items: PdfTextItem[]): { lines: Line[]; text: string } => {
    const lines = linesOf(items)
    const limit = Math.max(0, ...lines.map((line) => line.right))
    return { lines, text: joinLines(lines, limit) }
  }

  interface Found {
    block: DocxReadBlock
    lines: Line[]
    name: string
  }
  const found: Found[] = []

  const walk = (node: PdfStructElement): void => {
    const role = node.role
    if (role === 'Table') {
      const rows: string[][] = []
      const rowsOf = (each: PdfStructElement): void => {
        for (const kid of each.kids) {
          if ('mcid' in kid) continue
          if (kid.role === 'TR') {
            rows.push(
              kid.kids
                .filter((cell): cell is PdfStructElement => !('mcid' in cell))
                .map((cell) => {
                  // A cell's paragraphs, each joined by its own lines, one under the other.
                  const parts = cell.kids.some((part) => !('mcid' in part))
                    ? cell.kids.map((part) =>
                        'mcid' in part ? textOf(itemsOf([part])).text : textOf(itemsOf(refsUnder(part))).text
                      )
                    : [textOf(itemsOf(refsUnder(cell))).text]
                  return parts
                    .filter((part) => part.trim() !== '')
                    .join('\n')
                    .trim()
                })
            )
          } else rowsOf(kid)
        }
      }
      rowsOf(node)
      found.push({ block: { kind: 'table', rows }, lines: [], name: node.name })
      return
    }
    if (role === 'L') {
      for (const item of node.kids) {
        if ('mcid' in item) continue
        // The list item's body, not its bullet or number.
        const body = item.kids.filter((part): part is PdfStructElement => !('mcid' in part) && part.role !== 'Lbl')
        const refs = body.length ? body.flatMap((part) => (part.role === 'L' ? [] : refsUnder(part))) : refsUnder(item)
        const { lines, text } = textOf(itemsOf(refs))
        if (text.trim()) {
          found.push({
            block: { kind: 'p', style: 'list', styleName: item.name, text: text.replace(/^[•·▪◦‣-]\s*/, '') },
            lines,
            name: item.name
          })
        }
        for (const nested of body.filter((part) => part.role === 'L')) walk(nested)
      }
      return
    }
    const children = node.kids.filter((kid): kid is PdfStructElement => !('mcid' in kid))
    if (
      GROUPING.has(role) ||
      (!node.kids.some((kid) => 'mcid' in kid) && children.some((kid) => !INLINE.has(kid.role)))
    ) {
      for (const child of children) walk(child)
      return
    }
    const { lines, text } = textOf(itemsOf(refsUnder(node)))
    if (!text.trim()) return
    const heading = /^H([1-6])$/.exec(role)
    const name = node.name.toLowerCase()
    let style: DocxReadParagraph['style'] = 'normal'
    let level: number | undefined
    if (role === 'Title' || name === 'title') style = 'title'
    else if (heading) {
      style = 'heading'
      level = Number(heading[1])
    } else if (role === 'H') style = 'heading'
    else if (name === 'meta') style = 'meta'
    else if (name === 'quote' || name === 'intense quote' || name === 'citation') style = 'quote'
    found.push({
      block: { kind: 'p', style, styleName: node.name, text, ...(level ? { level } : {}) },
      lines,
      name: node.name
    })
  }
  walk(structure)

  // The tree must account for the text, or reading by it would drop what it left out.
  let total = 0
  let covered = 0
  for (const item of content.items) {
    if (item.artifact || !item.text.trim()) continue
    total += item.text.length
    if (item.mcid !== undefined && reached.has(`${item.page}:${item.mcid}`)) covered += item.text.length
  }
  if (!found.length || covered < total * 0.8) return null

  // What the tree does not say — a caption in small italics, a quote set in — is read
  // from the type, as for an untagged page.
  const paragraphs = found.filter((each) => each.block.kind === 'p' && each.lines.length)
  const body = bodySize(paragraphs.flatMap((each) => each.lines))
  const left = Math.min(...paragraphs.map((each) => each.lines[0].x))
  for (const each of paragraphs) {
    const block = each.block as DocxReadParagraph
    const line = each.lines[0]
    if (block.style !== 'normal') continue
    if (line.italic && line.size < body * 0.95) block.style = 'meta'
    else if (line.italic && line.x > left + 5) block.style = 'quote'
  }
  // A heading the tree gives no level: ranked by size among the others.
  const unleveled = found.filter(
    (each) => each.block.kind === 'p' && each.block.style === 'heading' && !each.block.level
  )
  const sizes = [...new Set(unleveled.map((each) => Math.round((each.lines[0]?.size ?? 0) * 2) / 2))].sort(
    (a, b) => b - a
  )
  for (const each of unleveled) {
    ;(each.block as DocxReadParagraph).level = sizes.indexOf(Math.round((each.lines[0]?.size ?? 0) * 2) / 2) + 1
  }
  return found.map((each) => each.block)
}

/** Inline roles: pieces of a paragraph, never paragraphs of their own. */
const INLINE = new Set([
  'Span',
  'Link',
  'Quote',
  'Note',
  'Reference',
  'BibEntry',
  'Code',
  'Annot',
  'Ruby',
  'Warichu',
  'Formula',
  'Figure'
])

function bodySize(lines: Line[]): number {
  const weight = new Map<number, number>()
  for (const line of lines) {
    const size = Math.round(line.size * 2) / 2
    weight.set(size, (weight.get(size) ?? 0) + line.text.length)
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10
}

/* ---- The document ----------------------------------------------------------------- */

/** Whether the file will be read by its structure tree rather than by where its text sits. */
export function readsByStructure(content: PdfContent): boolean {
  return content.structure !== undefined && structuredBlocks(content, content.structure) !== null
}

/**
 * The PDF's content as paragraphs and tables, in reading order. By its structure tree
 * where it has one that accounts for the text; otherwise page by page, top to bottom, a
 * table where it stands among the paragraphs.
 */
export function pdfBlocks(content: PdfContent, options: PdfBlockOptions = {}): DocxReadBlock[] {
  if (content.structure) {
    const tagged = structuredBlocks(content, content.structure)
    if (tagged) return tagged
  }
  const startsRow = options.startsRow ?? ((_header: string[], cells: string[]) => cells[0] !== '')
  const flowing: PdfTextItem[] = []
  const tables: Table[] = []
  for (let page = 1; page <= content.pages; page++) {
    const onPage = tablesOf(content.rects, page)
    tables.push(...onPage)
    for (const item of content.items.filter((each) => each.page === page && !each.artifact)) {
      const cell = onPage
        .flatMap((table) => table.rows.flatMap((row) => row.cells))
        .find((each) => inside(item, each.rect))
      if (cell) cell.items.push(item)
      else flowing.push(item)
    }
  }

  const all = linesOf(flowing)
  const dropped = furniture(all, content.pages)
  const lines = all.filter((line) => !dropped.has(line))
  const limits = new Map<number, number>()
  for (const line of lines) limits.set(line.page, Math.max(limits.get(line.page) ?? 0, line.right))
  const paragraphs = paragraphsOf(lines, (page) => limits.get(page) ?? 0)
  const classified = classify(paragraphs)

  // Reading order: paragraphs and tables by page, then from the top.
  type Placed = { page: number; top: number; block: DocxReadBlock; table?: Table }
  const placed: Placed[] = [
    ...classified.map((block, at) => ({ page: paragraphs[at].lines[0].page, top: paragraphs[at].lines[0].y, block })),
    ...tables.map((table) => ({ page: table.page, top: table.top, block: { kind: 'table' as const, rows: [] }, table }))
  ].sort((a, b) => a.page - b.page || b.top - a.top)

  const out: DocxReadBlock[] = []
  // A table carried over a page: its header drawn again, and a row cut in two.
  let open:
    | { header: string[]; rows: Line[][][]; block: { kind: 'table'; rows: string[][] }; limits: number[] }
    | undefined
  const finish = (): void => {
    if (!open) return
    const { limits: edges } = open
    open.block.rows = open.rows.map((row) => row.map((lines, at) => joinLines(lines, edges[at] ?? Infinity).trim()))
    open = undefined
  }
  for (const each of placed) {
    if (!each.table) {
      finish()
      out.push(each.block)
      continue
    }
    const rows = each.table.rows.map((row) => row.cells.map(cellLines))
    const edges = each.table.rows[0].cells.map((cell) => cell.rect.x + cell.rect.width - 4)
    const texts = (row: Line[][]): string[] => row.map((lines) => lines.map((line) => line.text).join(' '))
    const previous = out[out.length - 1]
    if (open && previous === open.block && rows.length && texts(rows[0]).join('|') === open.header.join('|')) {
      // The same table going on: its header again, then perhaps the rest of a row.
      let from = 1
      const first = rows[1]
      if (
        first &&
        !startsRow(
          open.header,
          first.map((lines, at) => joinLines(lines, open?.limits[at] ?? Infinity).trim())
        )
      ) {
        const last = open.rows[open.rows.length - 1]
        first.forEach((lines, at) => last[at]?.push(...lines))
        from = 2
      }
      open.rows.push(...rows.slice(from))
      continue
    }
    finish()
    const block = { kind: 'table' as const, rows: [] as string[][] }
    out.push(block)
    open = { header: rows.length ? texts(rows[0]) : [], rows, block, limits: edges }
  }
  finish()
  return out
}
