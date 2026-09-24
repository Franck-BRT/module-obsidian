import type { DocxReadBlock } from '../docxRead'
import type { PptxReadSlide, PptxReadText } from '../pptxRead'
import { docxRequirements, leadingId, readMeta, type DocxRequirements, type DocxVocabulary } from './reqDocxRead'

/**
 * The requirements in a deck, as the rows a CSV import reads.
 *
 * Two kinds of slide. The library's own review deck puts one requirement on a slide in
 * known places — its names above the title, its statement, rationale and source in the
 * body, its status and the rest along the bottom — and each place is read back as the
 * field it holds, category slides included. Any other slide is read as a page of a
 * document: its title as a heading, its text as paragraphs, its tables as tables, and the
 * requirements found in it by the rules a Word document is read with.
 */

export interface PptxVocabulary extends DocxVocabulary {
  /** The label the deck puts before a rationale: `Justification : …`. */
  rationaleLabels: string[]
  /** What a category slide says above the category's name. */
  sectionLabels: string[]
  /** What the deck says where a requirement has no wording. */
  noWording: string[]
}

const TITLES = new Set(['title', 'ctrTitle'])
/** Placeholders that are the slide's furniture: its number, its date, its footer. */
const FURNITURE = new Set(['sldNum', 'dt', 'ftr', 'hdr'])

function textOf(shape: PptxReadText): string {
  return shape.paragraphs
    .map((paragraph) => paragraph.text)
    .join('\n')
    .trim()
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** `REQ-X-0001  ·  OMLX-X-0001`: the names a requirement slide opens with, or null. */
function namesLine(text: string): string[] | null {
  const pieces = text
    .split('·')
    .map((piece) => piece.trim())
    .filter(Boolean)
  if (!pieces.length) return null
  return pieces.every((piece) => {
    const found = leadingId(piece)
    return found !== null && found.rest === '' && found.id === piece
  })
    ? pieces
    : null
}

function labelled(line: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const at = line.indexOf(':')
    if (at !== -1 && same(line.slice(0, at), label)) return line.slice(at + 1).trim()
  }
  return undefined
}

/** The rating the deck writes along the bottom — `4/5 · 90 %` — which is worked out, not stored. */
const RATING = /^(\d(?:[.,]\d)?\/5|\d{1,3}\s?%)$/

function textShapes(slide: PptxReadSlide): PptxReadText[] {
  return slide.shapes.filter(
    (shape): shape is PptxReadText => shape.kind === 'text' && !FURNITURE.has(shape.placeholder ?? '')
  )
}

function titleOf(slide: PptxReadSlide): PptxReadText | undefined {
  const texts = textShapes(slide)
  return (
    texts.find((shape) => shape.name === 'Title' || TITLES.has(shape.placeholder ?? '')) ??
    [...texts].sort((a, b) => (a.y ?? 0) - (b.y ?? 0))[0]
  )
}

/**
 * A slide of the library's own deck, back into a row: null when the slide is not one.
 */
function ownSlide(
  slide: PptxReadSlide,
  vocabulary: PptxVocabulary,
  lang: string,
  category: string | undefined,
  unmatched: Set<string>
): Record<string, string> | null {
  const texts = textShapes(slide)
  const eyebrow = texts.find((shape) => shape.name === 'Eyebrow')
  const names = eyebrow ? namesLine(textOf(eyebrow)) : null
  if (!eyebrow || !names) return null
  const title = titleOf(slide)
  const row: Record<string, string> = { id: names[0] }
  if (names.length > 1) row.aliases = names.slice(1).join(', ')
  if (category !== undefined) row.category = category
  const heading = title && title !== eyebrow ? textOf(title) : ''
  // The deck shows the identifier where there is no title, so that is not a title.
  if (heading && heading !== row.id) row.title = heading

  const body: string[] = []
  for (const shape of texts) {
    if (shape === eyebrow || shape === title || shape.name === 'Footer') continue
    for (const paragraph of shape.paragraphs) {
      const line = paragraph.text.trim()
      if (!line) continue
      const rationale = labelled(line, vocabulary.rationaleLabels)
      const source = labelled(line, vocabulary.sourceLabels)
      if (rationale !== undefined) row.rationale = rationale
      else if (source !== undefined) row.source = source
      else if (!vocabulary.noWording.some((label) => same(label, line))) {
        body.push(paragraph.bullet ? `- ${paragraph.text.trim()}` : paragraph.text.replace(/^\s+|\s+$/g, ''))
      }
    }
  }
  if (body.length) row[`text.${lang}`] = body.join('\n')

  const footer = texts.find((shape) => shape.name === 'Footer')
  if (footer) {
    const bits = textOf(footer)
      .split('·')
      .map((bit) => bit.trim())
      .filter((bit) => bit !== '' && !RATING.test(bit))
    readMeta(bits.join(' · '), vocabulary, row, unmatched)
  }
  return row
}

/** A slide as a page of a document: its title a heading, its text paragraphs, its tables tables. */
function slideBlocks(slide: PptxReadSlide): DocxReadBlock[] {
  const title = titleOf(slide)
  const rest = slide.shapes
    .filter((shape) => shape !== title && !(shape.kind === 'text' && FURNITURE.has(shape.placeholder ?? '')))
    .sort((a, b) => (a.y ?? Infinity) - (b.y ?? Infinity) || (a.x ?? 0) - (b.x ?? 0))
  const blocks: DocxReadBlock[] = []
  const content = rest.some((shape) => (shape.kind === 'table' ? shape.rows.length : textOf(shape) !== ''))
  if (title && textOf(title)) {
    // A slide that is only a title announces a part — a category, in a requirements deck.
    blocks.push({ kind: 'p', style: 'heading', level: content ? 2 : 1, styleName: title.name, text: textOf(title) })
  }
  for (const shape of rest) {
    if (shape.kind === 'table') {
      blocks.push({ kind: 'table', rows: shape.rows })
      continue
    }
    for (const paragraph of shape.paragraphs) {
      if (!paragraph.text.trim()) continue
      blocks.push({
        kind: 'p',
        style: paragraph.bullet ? 'list' : 'normal',
        styleName: shape.name,
        text: paragraph.text.trim()
      })
    }
  }
  return blocks
}

export function pptxRequirements(slides: PptxReadSlide[], vocabulary: PptxVocabulary, lang: string): DocxRequirements {
  const rows: Record<string, string>[] = []
  const unknown = new Set<string>()
  const unmatched = new Set<string>()
  let fromText = 0
  let fromTables = 0
  let category: string | undefined
  let pages: DocxReadBlock[] = []

  const flush = (): void => {
    if (!pages.length) return
    const read = docxRequirements(pages, vocabulary, lang)
    rows.push(...read.rows)
    for (const each of read.unknown) unknown.add(each)
    for (const each of read.unmatched) unmatched.add(each)
    fromText += read.fromText
    fromTables += read.fromTables
    pages = []
  }

  for (const slide of slides) {
    const eyebrow = textShapes(slide).find((shape) => shape.name === 'Eyebrow')
    // A category slide of the library's own deck: the category's name under its label.
    if (eyebrow && vocabulary.sectionLabels.some((label) => same(label, textOf(eyebrow)))) {
      flush()
      const title = titleOf(slide)
      const name = title && title !== eyebrow ? textOf(title) : ''
      category = vocabulary.noCategory.some((label) => same(label, name)) ? '' : name
      continue
    }
    const own = ownSlide(slide, vocabulary, lang, category, unmatched)
    if (own) {
      flush()
      rows.push(own)
      fromText += 1
    } else pages.push(...slideBlocks(slide))
  }
  flush()
  return { rows, unknown: [...unknown], unmatched: [...unmatched], fromTables, fromText }
}
