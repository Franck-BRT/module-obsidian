import type { DocxBlock, DocxCell, DocxDocument, DocxParagraph, DocxRun } from '../docx'
import { DOCX_TEXT_WIDTH, para } from '../docx'
import type { Requirement } from './Requirement'
import { textOf } from './Requirement'
import { isEmptySpec, parseReqBlock, quotedWording, selectRequirements, type ReqBlockField } from './reqBlock'
import { blockBody, reqBlockRanges } from './reqFence'
import { resolveBlockFields } from './reqBlockFields'

/**
 * A note, and the requirements it quotes, as a Word document.
 *
 * A `pm-req` block is the right thing inside the vault and nothing at all outside it: a
 * supplier opening the exported file must read the requirements, not a fenced instruction
 * for fetching them. So each block becomes the table it draws on screen, with the columns
 * the block asked for, and the prose around it comes across as prose.
 *
 * It is a snapshot and says so where it matters: a wording that has fallen behind its
 * source, or that stands in for a translation nobody wrote, is marked in the cell rather
 * than quietly exported as though it were current. That mark is the whole reason the
 * library exists, and it is worth more in the file that leaves the building than in the
 * one that stays.
 */

export interface DocxWords {
  column: (field: ReqBlockField) => string
  rating: (requirement: Requirement) => string
  /** What to say under a wording that is not simply current. */
  note: (kind: 'stale' | 'fallback' | 'unreviewed', lang: string) => string
  missing: (id: string) => string
  empty: string
}

export interface NoteDocxOptions {
  title: string
  lang: string
  library: Requirement[]
  /** The columns a block that named none of its own is drawn with. */
  fields: ReqBlockField[]
  words: DocxWords
}

/* ---- Prose ----------------------------------------------------------------- */

const BOLD = /\*\*(.+?)\*\*/
const ITALIC = /(?:\*|_)(.+?)(?:\*|_)/

/**
 * A line of markdown as runs.
 *
 * Bold and italic, and everything else reduced to the words it was wrapping: a link in a
 * specification is read for its text, and a document that printed the URL in the middle
 * of a sentence would be harder to read than one that dropped it.
 */
export function inlineRuns(text: string): DocxRun[] {
  const plain = text
    .replace(/!\[\[([^\]]+)\]\]/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
  const runs: DocxRun[] = []
  let rest = plain
  while (rest) {
    const bold = BOLD.exec(rest)
    const italic = ITALIC.exec(rest)
    const first = bold && italic ? (bold.index <= italic.index ? bold : italic) : (bold ?? italic)
    if (!first) break
    if (first.index > 0) runs.push({ text: rest.slice(0, first.index) })
    runs.push(first === bold ? { text: first[1], bold: true } : { text: first[1], italic: true })
    rest = rest.slice(first.index + first[0].length)
  }
  if (rest) runs.push({ text: rest })
  return runs.length ? runs : [{ text: '' }]
}

/**
 * One line of the note.
 *
 * `lift` is one when the note's own first heading became the document's title: everything
 * under it then moves up a level, so a `##` section is the first level of the document
 * rather than the second. Without it the exported document skips a level, which a reader
 * sees immediately in Markdown and an outline sees everywhere.
 */
function proseBlock(line: string, lift = 0): DocxParagraph | null {
  const trimmed = line.trim()
  if (!trimmed || /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return null
  const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
  if (heading) {
    const level = Math.min(3, Math.max(1, heading[1].length - lift))
    return { kind: 'p', style: `Heading${level}` as DocxParagraph['style'], runs: inlineRuns(heading[2]) }
  }
  if (trimmed.startsWith('>')) return { kind: 'p', style: 'Quote', runs: inlineRuns(trimmed.replace(/^>\s?/, '')) }
  const bullet = /^([-*+]|\d+\.)\s+(.*)$/.exec(trimmed)
  if (bullet) return { kind: 'p', style: 'Bullet', runs: inlineRuns(bullet[2]) }
  return { kind: 'p', style: 'Normal', runs: inlineRuns(trimmed) }
}

/**
 * Where the note's own frontmatter ends.
 *
 * Exported documents do not carry the vault's bookkeeping: a reader who opens the file
 * wants the specification, not the tags it was filed under.
 */
function bodyStart(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i + 1
  }
  return 0
}

/* ---- The quoted requirements ------------------------------------------------ */

const COLUMN_WIDTH: Partial<Record<ReqBlockField, number>> = {
  id: 1500,
  title: 2200,
  type: 1300,
  status: 1300,
  criticality: 1300,
  verification: 1400,
  rating: 1200
}

/** The widths, with the wording taking whatever the named columns left. */
export function columnWidths(fields: ReqBlockField[]): number[] {
  const named = fields.filter((field) => field !== 'break')
  const fixed = named.reduce((total, field) => total + (COLUMN_WIDTH[field] ?? 0), 0)
  const text = named.filter((field) => field === 'text').length
  // Never below a width a sentence can be read in: a table that does not fit the page is
  // Word's problem to shrink, not a reason to hand it a two-centimetre column.
  const share = text ? Math.max(2400, Math.floor((DOCX_TEXT_WIDTH - fixed) / text)) : 0
  return named.map((field) => (field === 'text' ? share : (COLUMN_WIDTH[field] ?? 1200)))
}

function cellRuns(
  requirement: Requirement,
  field: ReqBlockField,
  lang: string,
  words: DocxWords,
  glyph: (requirement: Requirement, field: ReqBlockField) => string
): DocxRun[] {
  if (field === 'rating') return [{ text: words.rating(requirement) }]
  if (field === 'id') return [{ text: requirement.id, bold: true }]
  if (field === 'title') return [{ text: requirement.title }]
  if (field !== 'text') return [{ text: glyph(requirement, field) }]

  const quoted = quotedWording(requirement, lang)
  if (!quoted) return [{ text: '—' }]
  const runs: DocxRun[] = [{ text: quoted.body }]
  // Said in the cell, under the words it is about. A specification that exported a
  // translation which has fallen behind its source, without saying so, is the exact
  // failure this library exists to prevent.
  const marks: string[] = []
  if (quoted.fallback) marks.push(words.note('fallback', quoted.lang))
  if (quoted.stale) marks.push(words.note('stale', quoted.lang))
  if (quoted.unreviewed) marks.push(words.note('unreviewed', quoted.lang))
  if (marks.length) runs.push({ text: `\n${marks.join(' · ')}`, italic: true })
  return runs
}

/**
 * One `pm-req` block, as the table it draws on screen.
 *
 * An identifier the library does not hold is written out as a line of its own rather than
 * skipped: a requirement deleted under a document has to leave a hole in the document,
 * not a document that quietly got shorter.
 */
export function blockDocxBlocks(
  source: string,
  options: NoteDocxOptions,
  glyph: (requirement: Requirement, field: ReqBlockField) => string
): DocxBlock[] {
  const spec = parseReqBlock(source)
  if (isEmptySpec(spec)) return []
  const { rows, missing } = selectRequirements(spec, options.library)
  const fields = resolveBlockFields(spec.fields, options.fields).filter((field) => field !== 'break')
  const widths = columnWidths(fields)
  const out: DocxBlock[] = []
  if (rows.length) {
    out.push({
      kind: 'table',
      header: fields.map((field, at) => ({ runs: [{ text: options.words.column(field) }], width: widths[at] })),
      rows: rows.map((row) =>
        fields.map((field, at): DocxCell => ({
          runs:
            field === 'id'
              ? [{ text: row.citedAs, bold: true }]
              : cellRuns(row.requirement, field, spec.lang || options.lang, options.words, glyph),
          width: widths[at]
        }))
      )
    })
  }
  for (const id of missing) out.push(para('Meta', options.words.missing(id)))
  if (!rows.length && !missing.length) out.push(para('Meta', options.words.empty))
  return out
}

/**
 * The note's own first heading, where it has one.
 *
 * A specification usually opens with its own title, and a document that printed the file
 * name above it would say the same thing twice. So that heading becomes the title, and
 * the file name is only used by a note that never gave itself one.
 */
function titleLine(lines: string[], from: number): { title: string; at: number } | null {
  for (let i = from; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    const heading = /^#\s+(.*)$/.exec(trimmed)
    return heading ? { title: heading[1], at: i + 1 } : null
  }
  return null
}

export function noteDocx(
  content: string,
  options: NoteDocxOptions,
  glyph: (requirement: Requirement, field: ReqBlockField) => string
): DocxDocument {
  const lines = content.split('\n')
  const blocks = reqBlockRanges(lines)
  const start = bodyStart(lines)
  const own = titleLine(lines, start)
  const title = own ? own.title : options.title
  const lift = own ? 1 : 0
  const out: DocxBlock[] = [para('Title', title)]

  let at = own ? own.at : start
  for (const block of blocks) {
    if (block.open < at) continue
    for (const line of lines.slice(at, block.open)) {
      const made = proseBlock(line, lift)
      if (made) out.push(made)
    }
    out.push(...blockDocxBlocks(blockBody(lines, block), options, glyph))
    at = block.closed ? block.close + 1 : lines.length
  }
  for (const line of lines.slice(at)) {
    const made = proseBlock(line, lift)
    if (made) out.push(made)
  }
  return { title, blocks: out }
}

/* ---- The library as a document ---------------------------------------------- */

export interface LibraryDocxOptions {
  title: string
  lang: string
  meta: (requirement: Requirement) => string
  sourceLabel: string
  noCategory: string
}

/**
 * The library written out, the same shape as the markdown export.
 *
 * Two exports of the same thing that disagreed about its shape would be two documents to
 * explain rather than one in two formats.
 */
export function libraryDocx(requirements: Requirement[], options: LibraryDocxOptions): DocxDocument {
  const blocks: DocxBlock[] = [para('Title', options.title)]
  let category = '\u0000'
  for (const requirement of requirements) {
    if (requirement.category !== category) {
      category = requirement.category
      blocks.push(para('Heading1', category || options.noCategory))
    }
    blocks.push(para('Heading2', `${requirement.id}${requirement.title ? ` — ${requirement.title}` : ''}`))
    const meta = options.meta(requirement)
    if (meta) blocks.push(para('Meta', meta))
    const held = textOf(requirement, options.lang) ?? textOf(requirement, requirement.sourceLang)
    blocks.push(para('Normal', held ? held.body : '—'))
    if (requirement.rationale) blocks.push(para('Quote', requirement.rationale))
    if (requirement.source) blocks.push(para('Meta', `${options.sourceLabel} : ${requirement.source}`))
  }
  return { title: options.title, blocks }
}
