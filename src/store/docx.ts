import { escapeXml } from './xml'
import { utf8, zip, type ZipEntry } from './zip'

/**
 * A Word document, written by hand.
 *
 * `.docx` is a ZIP of XML parts, and the subset a requirements document needs is small:
 * headings, paragraphs, quotes and a table. Written out directly rather than through a
 * library, for the same reason the ReqIF is — this plugin carries no runtime dependency,
 * and what leaves the building has to be something we can explain byte by byte.
 *
 * The model is deliberately thin. It is not a word processor: it is the shapes a
 * specification is made of, and anything a document needs beyond them is a sign it
 * should have been written in Word to begin with.
 */

export type DocxStyle = 'Title' | 'Heading1' | 'Heading2' | 'Heading3' | 'Normal' | 'Quote' | 'Meta' | 'Bullet'

export interface DocxRun {
  text: string
  bold?: boolean
  italic?: boolean
}

export interface DocxParagraph {
  kind: 'p'
  style?: DocxStyle
  runs: DocxRun[]
}

export interface DocxCell {
  runs: DocxRun[]
  /** How wide, in twentieths of a point. The columns of a row must add up to the table. */
  width: number
}

export interface DocxTable {
  kind: 'table'
  /** Repeated at the top of every page it spills onto, which is why it is marked as one. */
  header: DocxCell[]
  rows: DocxCell[][]
}

export type DocxBlock = DocxParagraph | DocxTable

export interface DocxDocument {
  title: string
  blocks: DocxBlock[]
}

/** A4 portrait with 2 cm margins, in twentieths of a point: what a table has to fit in. */
export const DOCX_TEXT_WIDTH = 11906 - 2 * 1134

export function para(style: DocxStyle, text: string): DocxParagraph {
  return { kind: 'p', style, runs: text ? [{ text }] : [] }
}

function runXml(run: DocxRun): string {
  const marks = `${run.bold ? '<w:b/>' : ''}${run.italic ? '<w:i/>' : ''}`
  // A line break inside a run is a break, not a paragraph: a requirement written on
  // three lines means something by being on three lines.
  const pieces = run.text.split('\n')
  const text = pieces.map((piece) => `<w:t xml:space="preserve">${escapeXml(piece)}</w:t>`).join('<w:br/>')
  return `<w:r>${marks ? `<w:rPr>${marks}</w:rPr>` : ''}${text}</w:r>`
}

function paraXml(paragraph: DocxParagraph): string {
  const style = paragraph.style && paragraph.style !== 'Normal' ? `<w:pStyle w:val="${paragraph.style}"/>` : ''
  const bullet = paragraph.style === 'Bullet' ? '<w:r><w:t xml:space="preserve">• </w:t></w:r>' : ''
  return `<w:p>${style ? `<w:pPr>${style}</w:pPr>` : ''}${bullet}${paragraph.runs.map(runXml).join('')}</w:p>`
}

function cellXml(cell: DocxCell, bold: boolean): string {
  const runs = cell.runs.length ? cell.runs : [{ text: '' }]
  const body = paraXml({ kind: 'p', style: 'Normal', runs: runs.map((run) => ({ ...run, bold: bold || run.bold })) })
  return `<w:tc><w:tcPr><w:tcW w:w="${cell.width}" w:type="dxa"/></w:tcPr>${body}</w:tc>`
}

function tableXml(table: DocxTable): string {
  const grid = table.header.map((cell) => `<w:gridCol w:w="${cell.width}"/>`).join('')
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${table.header.map((cell) => cellXml(cell, true)).join('')}</w:tr>`
  const rows = table.rows.map((row) => `<w:tr>${row.map((cell) => cellXml(cell, false)).join('')}</w:tr>`).join('')
  return [
    '<w:tbl>',
    '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr>',
    `<w:tblGrid>${grid}</w:tblGrid>`,
    head,
    rows,
    '</w:tbl>',
    // Word wants a paragraph after a table, and two tables with nothing between them are
    // read as one.
    '<w:p/>'
  ].join('')
}

function bodyXml(blocks: DocxBlock[]): string {
  return blocks.map((block) => (block.kind === 'table' ? tableXml(block) : paraXml(block))).join('')
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function documentXml(doc: DocxDocument): string {
  return [
    HEAD,
    `<w:document xmlns:w="${W}"><w:body>`,
    bodyXml(doc.blocks),
    // A4 portrait, 2 cm all round.
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>',
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>',
    '</w:sectPr></w:body></w:document>'
  ].join('')
}

function styleXml(id: string, name: string, definition: string): string {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${definition}</w:style>`
}

/**
 * The look of the thing.
 *
 * Sober on purpose: this is a document somebody will paste their own template over, and
 * a plugin that arrived with opinions about fonts would be a plugin whose exports are
 * reformatted before they are sent. The one thing it insists on is that the styles are
 * Word's own names, so a house template restyles the whole document by itself.
 */
function stylesXml(): string {
  const heading = (id: string, size: number, before: number): string =>
    `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr>`
  return [
    HEAD,
    `<w:styles xmlns:w="${W}">`,
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>',
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>',
    styleXml('Normal', 'Normal', ''),
    styleXml('Title', 'Title', '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr>'),
    styleXml('Heading1', 'heading 1', heading('Heading1', 32, 360)),
    styleXml('Heading2', 'heading 2', heading('Heading2', 26, 280)),
    styleXml('Heading3', 'heading 3', heading('Heading3', 24, 240)),
    styleXml('Quote', 'Quote', '<w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr>'),
    styleXml('Meta', 'Meta', '<w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr>'),
    styleXml('Bullet', 'List Paragraph', '<w:pPr><w:ind w:left="567"/><w:spacing w:after="60"/></w:pPr>'),
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>',
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
      .join(''),
    '</w:tblBorders><w:tblCellMar><w:top w:w="72" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>',
    '<w:bottom w:w="72" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>',
    '</w:styles>'
  ].join('')
}

function coreXml(title: string, at: Date): string {
  const stamp = at.toISOString().replace(/\.\d+Z$/, 'Z')
  return [
    HEAD,
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"',
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `<dc:title>${escapeXml(title)}</dc:title>`,
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>`,
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>`,
    '</cp:coreProperties>'
  ].join('')
}

const CONTENT_TYPES = [
  HEAD,
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  '<Override PartName="/word/document.xml"',
  ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  '<Override PartName="/word/styles.xml"',
  ' ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
  '<Override PartName="/docProps/core.xml"',
  ' ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
  '</Types>'
].join('')

const ROOT_RELS = [
  HEAD,
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1"',
  ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"',
  ' Target="word/document.xml"/>',
  '<Relationship Id="rId2"',
  ' Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"',
  ' Target="docProps/core.xml"/>',
  '</Relationships>'
].join('')

const DOC_RELS = [
  HEAD,
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1"',
  ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"',
  ' Target="styles.xml"/>',
  '</Relationships>'
].join('')

/** The parts, in the order a reader expects to meet them. */
export function docxParts(doc: DocxDocument, at = new Date()): ZipEntry[] {
  return [
    { name: '[Content_Types].xml', data: utf8(CONTENT_TYPES) },
    { name: '_rels/.rels', data: utf8(ROOT_RELS) },
    { name: 'docProps/core.xml', data: utf8(coreXml(doc.title, at)) },
    { name: 'word/_rels/document.xml.rels', data: utf8(DOC_RELS) },
    { name: 'word/document.xml', data: utf8(documentXml(doc)) },
    { name: 'word/styles.xml', data: utf8(stylesXml()) }
  ]
}

export function buildDocx(doc: DocxDocument, at = new Date()): Uint8Array {
  return zip(docxParts(doc, at), at)
}
