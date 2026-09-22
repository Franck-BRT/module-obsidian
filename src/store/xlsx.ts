import { escapeXml } from './xml'
import { utf8, zip, type ZipEntry } from './zip'

/**
 * A spreadsheet, written by hand.
 *
 * The third format that is a ZIP of XML, after Word and — in spirit — ReqIF, and the
 * third written without a dependency. What it adds over the CSV that already exists is
 * everything a person does to a CSV the moment they open it: freeze the header, turn on
 * the filters, widen the columns and wrap the long one. Doing it here means the file is
 * usable in the state it arrives.
 *
 * Strings are written inline rather than through a shared table. The table is the format's
 * way of not storing "Approuvée" four hundred times; a requirements library is a few
 * thousand rows of mostly distinct prose, so the saving is small and the indirection is
 * one more thing to get wrong.
 */

export type XlsxValue = string | number | null

export interface XlsxColumn {
  label: string
  /** Width in characters, as Excel counts them. */
  width: number
  /** Long prose: wrapped and aligned to the top, or the row is one very long line. */
  wrap?: boolean
}

export interface XlsxSheet {
  name: string
  columns: XlsxColumn[]
  rows: XlsxValue[][]
}

/** A1, Z1, AA1: the column's name in the spreadsheet's own alphabet. */
export function columnName(index: number): string {
  let name = ''
  let left = index
  do {
    name = String.fromCharCode(65 + (left % 26)) + name
    left = Math.floor(left / 26) - 1
  } while (left >= 0)
  return name
}

/**
 * A sheet name Excel will accept.
 *
 * It refuses the five characters it uses for addressing, will not take more than
 * thirty-one, and will not open a file whose sheet is named nothing at all.
 */
export function sheetName(raw: string): string {
  const clean = raw
    .replace(/[:\\/?*[\]]/g, ' ')
    .trim()
    .slice(0, 31)
  return clean || 'Feuille'
}

function cellXml(value: XlsxValue, reference: string, style: number): string {
  if (value === null || value === '') return ''
  const attrs = `r="${reference}"${style ? ` s="${style}"` : ''}`
  if (typeof value === 'number') {
    // Never a number the spreadsheet cannot hold: an infinity or a NaN makes the file
    // unopenable rather than merely wrong.
    if (!Number.isFinite(value)) return ''
    return `<c ${attrs}><v>${value}</v></c>`
  }
  return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

function sheetXml(sheet: XlsxSheet): string {
  const last = columnName(Math.max(0, sheet.columns.length - 1))
  const rows: string[] = []
  rows.push(
    `<row r="1">${sheet.columns.map((column, at) => cellXml(column.label, `${columnName(at)}1`, 1)).join('')}</row>`
  )
  sheet.rows.forEach((row, at) => {
    const number = at + 2
    const cells = row
      .map((value, column) => cellXml(value, `${columnName(column)}${number}`, sheet.columns[column]?.wrap ? 2 : 0))
      .join('')
    rows.push(`<row r="${number}">${cells}</row>`)
  })
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<dimension ref="A1:${last}${sheet.rows.length + 1}"/>`,
    // The header stays put and the filters are on: the two things anybody does to a
    // table of four hundred requirements before reading any of it.
    '<sheetViews><sheetView workbookViewId="0">',
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    '</sheetView></sheetViews>',
    '<sheetFormatPr defaultRowHeight="15"/>',
    `<cols>${sheet.columns
      .map((column, at) => `<col min="${at + 1}" max="${at + 1}" width="${column.width}" customWidth="1"/>`)
      .join('')}</cols>`,
    `<sheetData>${rows.join('')}</sheetData>`,
    `<autoFilter ref="A1:${last}${sheet.rows.length + 1}"/>`,
    '</worksheet>'
  ].join('')
}

const STYLES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>',
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>',
  '<fills count="3"><fill><patternFill patternType="none"/></fill>',
  '<fill><patternFill patternType="gray125"/></fill>',
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>',
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>',
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>',
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
  '<cellXfs count="3">',
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>',
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">',
  '<alignment vertical="top" wrapText="1"/></xf>',
  '</cellXfs>',
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
  '</styleSheet>'
].join('')

function workbookXml(sheets: XlsxSheet[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheets>',
    sheets
      .map((sheet, at) => `<sheet name="${escapeXml(sheetName(sheet.name))}" sheetId="${at + 1}" r:id="rId${at + 1}"/>`)
      .join(''),
    '</sheets></workbook>'
  ].join('')
}

function contentTypes(sheets: XlsxSheet[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml"',
    ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    sheets
      .map(
        (_, at) =>
          `<Override PartName="/xl/worksheets/sheet${at + 1}.xml"` +
          ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      )
      .join(''),
    '<Override PartName="/xl/styles.xml"',
    ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '</Types>'
  ].join('')
}

const ROOT_RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1"',
  ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"',
  ' Target="xl/workbook.xml"/>',
  '</Relationships>'
].join('')

function workbookRels(sheets: XlsxSheet[]): string {
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    sheets
      .map(
        (_, at) => `<Relationship Id="rId${at + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${at + 1}.xml"/>`
      )
      .join(''),
    `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/>`,
    '</Relationships>'
  ].join('')
}

export function xlsxParts(sheets: XlsxSheet[]): ZipEntry[] {
  return [
    { name: '[Content_Types].xml', data: utf8(contentTypes(sheets)) },
    { name: '_rels/.rels', data: utf8(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: utf8(workbookXml(sheets)) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRels(sheets)) },
    ...sheets.map((sheet, at) => ({ name: `xl/worksheets/sheet${at + 1}.xml`, data: utf8(sheetXml(sheet)) })),
    { name: 'xl/styles.xml', data: utf8(STYLES) }
  ]
}

export function buildXlsx(sheets: XlsxSheet[], at = new Date()): Uint8Array {
  return zip(xlsxParts(sheets), at)
}
