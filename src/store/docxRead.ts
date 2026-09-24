import { unzip } from './unzip'
import { childLocal, childrenLocal, localName, parseXml, type XmlNode } from './xmlParse'

/**
 * Reading a Word document, by hand.
 *
 * Only its text and its shape: which paragraphs are headings, which are quotes or lists,
 * and what the tables hold. Not the fonts, not the page, not the pictures. Read from
 * `word/document.xml`, with `word/styles.xml` to tell a heading from a paragraph — which
 * takes the style's name and not its identifier, because a French Word names its heading
 * style `Titre2` and only its name says `heading 2`.
 *
 * What a person reads is what is read: a tracked insertion is text, a tracked deletion is
 * not; a field's result is text, its instruction is not; a text box is somebody's aside,
 * not the paragraph it floats beside.
 */

export class DocxError extends Error {}

export type DocxReadStyle = 'title' | 'heading' | 'quote' | 'list' | 'meta' | 'normal'

export interface DocxReadParagraph {
  kind: 'p'
  style: DocxReadStyle
  /** 1 for a top-level heading. Only set on headings. */
  level?: number
  /** The style as the document names it, for a reader looking for one of its own. */
  styleName: string
  text: string
}

export interface DocxReadTable {
  kind: 'table'
  /** Rows of cells, each cell's paragraphs joined by line breaks. */
  rows: string[][]
}

export type DocxReadBlock = DocxReadParagraph | DocxReadTable

/**
 * Elements whose text is not the paragraph's: an aside in a text box, the fallback copy of
 * it for older readers. A tracked deletion and a field's code need no entry: their text
 * is held in `delText` and `instrText`, never in the `t` that is read.
 */
const SKIPPED = new Set(['pPr', 'rPr', 'txbxContent', 'Fallback', 'footnoteReference'])

function textInto(node: XmlNode, out: string[]): void {
  for (const part of node.children) {
    const name = localName(part)
    if (SKIPPED.has(name)) continue
    if (name === 't') out.push(part.text)
    else if (name === 'tab') out.push('\t')
    else if (name === 'br' || name === 'cr') out.push('\n')
    else if (name === 'noBreakHyphen') out.push('-')
    else textInto(part, out)
  }
}

export function paragraphText(paragraph: XmlNode): string {
  const out: string[] = []
  textInto(paragraph, out)
  return out.join('')
}

interface StyleInfo {
  name: string
  outline?: number
  basedOn?: string
}

function readStyles(source: string | undefined): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>()
  if (!source) return styles
  for (const style of childrenLocal(parseXml(source), 'style')) {
    const id = style.attrs['w:styleId'] ?? ''
    const outline = childLocal(childLocal(style, 'pPr'), 'outlineLvl')?.attrs['w:val']
    styles.set(id, {
      name: (childLocal(style, 'name')?.attrs['w:val'] ?? id).toLowerCase(),
      outline: outline === undefined ? undefined : Number(outline),
      basedOn: childLocal(style, 'basedOn')?.attrs['w:val']
    })
  }
  return styles
}

/**
 * What a style is, by its name, then by the style it is based on — a company template's
 * `Exigence titre` is often a heading 2 underneath.
 */
function classify(
  styleId: string,
  styles: Map<string, StyleInfo>
): { style: DocxReadStyle; level?: number; name: string } {
  let id: string | undefined = styleId
  const name = styles.get(styleId)?.name ?? styleId.toLowerCase()
  for (let depth = 0; id && depth < 8; depth++) {
    const info = styles.get(id)
    const own = info?.name ?? id.toLowerCase()
    const heading = /^heading\s*(\d)$/.exec(own) ?? /^(?:heading|titre)\s*(\d)$/i.exec(id)
    if (heading) return { style: 'heading', level: Number(heading[1]), name }
    if (info?.outline !== undefined && info.outline < 9) return { style: 'heading', level: info.outline + 1, name }
    if (own === 'title' || id === 'Title') return { style: 'title', name }
    if (own === 'quote' || own === 'intense quote') return { style: 'quote', name }
    if (own === 'meta') return { style: 'meta', name }
    if (own.startsWith('list')) return { style: 'list', name }
    id = info?.basedOn
  }
  return { style: 'normal', name }
}

function paragraphOf(node: XmlNode, styles: Map<string, StyleInfo>): DocxReadParagraph {
  const properties = childLocal(node, 'pPr')
  const styleId = childLocal(properties, 'pStyle')?.attrs['w:val'] ?? ''
  const found = classify(styleId, styles)
  // A heading can also be made by hand, with an outline level on the paragraph itself.
  const outline = childLocal(properties, 'outlineLvl')?.attrs['w:val']
  const numbered = childLocal(properties, 'numPr') !== null
  const paragraph: DocxReadParagraph = {
    kind: 'p',
    style: found.style,
    styleName: found.name,
    text: paragraphText(node)
  }
  if (found.style === 'normal' && outline !== undefined && Number(outline) < 9) {
    paragraph.style = 'heading'
    paragraph.level = Number(outline) + 1
  } else if (found.level !== undefined) paragraph.level = found.level
  if (paragraph.style === 'normal' && numbered) paragraph.style = 'list'
  return paragraph
}

function cellText(cell: XmlNode): string {
  const lines: string[] = []
  const walk = (node: XmlNode): void => {
    for (const part of node.children) {
      const name = localName(part)
      if (name === 'p') lines.push(paragraphText(part))
      else if (name === 'tbl' || name === 'tr' || name === 'tc' || name === 'sdt' || name === 'sdtContent') walk(part)
    }
  }
  walk(cell)
  return lines.join('\n').trim()
}

function tableOf(node: XmlNode): DocxReadTable {
  return {
    kind: 'table',
    rows: childrenLocal(node, 'tr').map((row) =>
      // A content control can wrap a cell; what it holds is the cell.
      row.children
        .flatMap((part) => (localName(part) === 'sdt' ? childrenLocal(childLocal(part, 'sdtContent'), 'tc') : [part]))
        .filter((part) => localName(part) === 'tc')
        .map(cellText)
    )
  }
}

function blocksOf(node: XmlNode | null, styles: Map<string, StyleInfo>, out: DocxReadBlock[]): void {
  for (const part of node?.children ?? []) {
    const name = localName(part)
    if (name === 'p') out.push(paragraphOf(part, styles))
    else if (name === 'tbl') out.push(tableOf(part))
    // A content control around paragraphs or a table: what it holds is the document.
    else if (name === 'sdt') blocksOf(childLocal(part, 'sdtContent'), styles, out)
  }
}

/** The document body, as paragraphs and tables in reading order. */
export async function readDocx(bytes: Uint8Array): Promise<DocxReadBlock[]> {
  const entries = await unzip(bytes, (name) => name === 'word/document.xml' || name === 'word/styles.xml')
  const decoder = new TextDecoder()
  const part = (name: string) => {
    const found = entries.find((entry) => entry.name === name)
    return found ? decoder.decode(found.data) : undefined
  }
  const document = part('word/document.xml')
  if (!document) throw new DocxError('no word/document.xml in the archive')
  const styles = readStyles(part('word/styles.xml'))
  const out: DocxReadBlock[] = []
  blocksOf(childLocal(parseXml(document), 'body'), styles, out)
  return out
}
