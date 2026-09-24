import { unzip } from './unzip'
import { unescapeOoxml } from './xlsxRead'
import { childLocal, childrenLocal, localName, parseXml, type XmlNode } from './xmlParse'

/**
 * Reading a PowerPoint deck, by hand.
 *
 * The slides in the order the deck shows them, and on each slide its text: shape by shape,
 * paragraph by paragraph, with what a reader of requirements needs to know about each —
 * whether the shape is the slide's title, what the author called it, where it sits, and
 * whether a paragraph is a bullet. Tables come out as rows of cells. Pictures, charts,
 * animations and the speaker's notes are not the deck's words and are left.
 */

export class PptxError extends Error {}

export interface PptxReadParagraph {
  text: string
  /** Marked with a bullet or a number in the slide itself. */
  bullet: boolean
}

export interface PptxReadText {
  kind: 'text'
  /** The name the shape carries: what the author, or the program, called it. */
  name: string
  /** The placeholder it fills — `title`, `ctrTitle`, `body`, `subTitle` — if any. */
  placeholder?: string
  /** Its top and left edges in points, when the slide says; a placeholder may not. */
  y?: number
  x?: number
  paragraphs: PptxReadParagraph[]
}

export interface PptxReadTable {
  kind: 'table'
  y?: number
  x?: number
  rows: string[][]
}

export type PptxReadShape = PptxReadText | PptxReadTable

export interface PptxReadSlide {
  shapes: PptxReadShape[]
}

const EMU = 12700

function position(node: XmlNode | null): { x?: number; y?: number } {
  const offset = childLocal(childLocal(node, 'xfrm'), 'off')
  if (!offset) return {}
  return { x: Number(offset.attrs.x ?? 0) / EMU, y: Number(offset.attrs.y ?? 0) / EMU }
}

function paragraphText(paragraph: XmlNode): string {
  let out = ''
  for (const part of paragraph.children) {
    const name = localName(part)
    if (name === 'r' || name === 'fld') out += childLocal(part, 't')?.text ?? ''
    else if (name === 'br') out += '\n'
  }
  // PowerPoint writes a soft return inside a run as a vertical tab.
  return unescapeOoxml(out).replace(/\v/g, '\n')
}

function paragraphsOf(body: XmlNode | null): PptxReadParagraph[] {
  return childrenLocal(body, 'p').map((paragraph) => {
    const properties = childLocal(paragraph, 'pPr')
    return {
      text: paragraphText(paragraph),
      bullet: childLocal(properties, 'buChar') !== null || childLocal(properties, 'buAutoNum') !== null
    }
  })
}

function tableOf(frame: XmlNode): PptxReadTable | null {
  const table = childLocal(childLocal(childLocal(frame, 'graphic'), 'graphicData'), 'tbl')
  if (!table) return null
  return {
    kind: 'table',
    ...position(frame),
    rows: childrenLocal(table, 'tr').map((row) =>
      childrenLocal(row, 'tc').map((cell) =>
        // A cell merged into its neighbour holds nothing of its own.
        cell.attrs.hMerge === '1' || cell.attrs.vMerge === '1'
          ? ''
          : paragraphsOf(childLocal(cell, 'txBody'))
              .map((paragraph) => paragraph.text)
              .join('\n')
              .trim()
      )
    )
  }
}

function shapesOf(tree: XmlNode | null, out: PptxReadShape[]): void {
  for (const node of tree?.children ?? []) {
    const name = localName(node)
    if (name === 'sp') {
      const properties = childLocal(node, 'nvSpPr')
      const placeholder = childLocal(childLocal(properties, 'nvPr'), 'ph')
      out.push({
        kind: 'text',
        name: childLocal(properties, 'cNvPr')?.attrs.name ?? '',
        ...(placeholder ? { placeholder: placeholder.attrs.type ?? 'body' } : {}),
        ...position(childLocal(node, 'spPr')),
        paragraphs: paragraphsOf(childLocal(node, 'txBody'))
      })
    } else if (name === 'graphicFrame') {
      const table = tableOf(node)
      if (table) out.push(table)
    } else if (name === 'grpSp') shapesOf(node, out)
    // Content a newer PowerPoint wraps for older readers: the first choice is the shape.
    else if (name === 'AlternateContent') shapesOf(childLocal(node, 'Choice'), out)
  }
}

function resolve(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = from.split('/').slice(0, -1)
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop()
    else if (piece !== '.' && piece !== '') parts.push(piece)
  }
  return parts.join('/')
}

/** The deck's slides, in the order it shows them. */
export async function readPptx(bytes: Uint8Array): Promise<PptxReadSlide[]> {
  const entries = await unzip(bytes, (name) =>
    /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml)$/.test(name)
  )
  const decoder = new TextDecoder()
  const parts = new Map(entries.map((entry) => [entry.name, decoder.decode(entry.data)]))
  const presentation = parts.get('ppt/presentation.xml')
  if (!presentation) throw new PptxError('no ppt/presentation.xml in the archive')

  const targets = new Map<string, string>()
  const rels = parts.get('ppt/_rels/presentation.xml.rels')
  if (rels) {
    for (const rel of childrenLocal(parseXml(rels), 'Relationship')) {
      targets.set(rel.attrs.Id ?? '', resolve('ppt/presentation.xml', rel.attrs.Target ?? ''))
    }
  }
  const slides: PptxReadSlide[] = []
  for (const id of childrenLocal(childLocal(parseXml(presentation), 'sldIdLst'), 'sldId')) {
    const rel = Object.entries(id.attrs).find(([key]) => key.endsWith(':id'))?.[1] ?? ''
    const source = parts.get(targets.get(rel) ?? '')
    if (!source) continue
    const shapes: PptxReadShape[] = []
    shapesOf(childLocal(childLocal(parseXml(source), 'cSld'), 'spTree'), shapes)
    slides.push({ shapes })
  }
  return slides
}
