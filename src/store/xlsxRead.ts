import { unzip } from './unzip'
import { childLocal, childrenLocal, parseXml, type XmlNode } from './xmlParse'

/**
 * Reading a spreadsheet, by hand.
 *
 * Only the values: which sheet, which row, which column, what it says. Not the styles,
 * not the formulas — a formula's last computed value is what the cell shows, and that is
 * what is read — not the charts. A `.xlsx` is a ZIP of XML parts, and the ones that carry
 * values are four: the workbook, its relationships, the shared strings and each sheet.
 *
 * Written against what spreadsheets actually save, not only against what this plugin
 * writes: its own export uses inline strings, but the same file opened and saved in Excel
 * or LibreOffice comes back with every string moved into a shared table, compressed, and
 * sometimes with its line breaks escaped as `_x000A_`.
 */

export class XlsxError extends Error {}

export interface XlsxReadSheet {
  name: string
  /** Rows as they are in the sheet, cells by column, every value as text. Empty rows dropped. */
  rows: string[][]
}

/** `_x000A_` and friends: how OOXML escapes a character XML itself cannot carry. */
function unescapeOoxml(raw: string): string {
  return raw
    .replace(/_x([0-9a-fA-F]{4})_/g, (_whole, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\r\n?/g, '\n')
}

/**
 * The text of a shared or inline string: a plain `<t>`, or runs of formatted text whose
 * `<t>`s join into one. The phonetic guide some locales add (`<rPh>`) is not the text.
 */
function richText(node: XmlNode | null): string {
  if (!node) return ''
  const plain = childLocal(node, 't')
  if (plain) return unescapeOoxml(plain.text)
  return unescapeOoxml(
    childrenLocal(node, 'r')
      .map((run) => childLocal(run, 't')?.text ?? '')
      .join('')
  )
}

/** `AB12` → 27, zero-based. */
export function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? ''
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

/** A relationship's target, as a path inside the archive. */
function resolve(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = from.split('/').slice(0, -1)
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop()
    else if (piece !== '.' && piece !== '') parts.push(piece)
  }
  return parts.join('/')
}

function relsPath(part: string): string {
  const at = part.lastIndexOf('/')
  return `${part.slice(0, at + 1)}_rels/${part.slice(at + 1)}.rels`
}

/** A part's relationships, by id, each with its type and where it points. */
function relationships(parts: Map<string, string>, part: string): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>()
  const source = parts.get(relsPath(part))
  if (!source) return out
  for (const each of childrenLocal(parseXml(source), 'Relationship')) {
    out.set(each.attrs.Id ?? '', { type: each.attrs.Type ?? '', target: resolve(part, each.attrs.Target ?? '') })
  }
  return out
}

function cellValue(cell: XmlNode, shared: string[]): string {
  const type = cell.attrs.t ?? 'n'
  if (type === 'inlineStr') return richText(childLocal(cell, 'is'))
  const value = childLocal(cell, 'v')?.text ?? ''
  if (type === 's') return shared[Number(value)] ?? ''
  if (type === 'b') return value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : ''
  // An error (#N/A, #REF!) says nothing a requirement could hold.
  if (type === 'e') return ''
  return type === 'str' ? unescapeOoxml(value) : value
}

function sheetRows(source: string, shared: string[]): string[][] {
  const data = childLocal(parseXml(source), 'sheetData')
  const rows: string[][] = []
  for (const row of childrenLocal(data, 'row')) {
    const cells: string[] = []
    let next = 0
    for (const cell of childrenLocal(row, 'c')) {
      // A cell may leave out its reference, and then it is the one after the last.
      const at = cell.attrs.r ? columnIndex(cell.attrs.r) : next
      next = at + 1
      const value = cellValue(cell, shared)
      if (value === '') continue
      while (cells.length < at) cells.push('')
      cells[at] = value
    }
    if (cells.some((value) => value.trim() !== '')) rows.push(cells)
  }
  return rows
}

/** Every sheet of the workbook, in the order its tabs are in. */
export async function readXlsx(bytes: Uint8Array): Promise<XlsxReadSheet[]> {
  // The XML parts only: a workbook with a hundred images in it is not unpacked to read text.
  const entries = await unzip(bytes, (name) => /\.(xml|rels)$/i.test(name))
  const decoder = new TextDecoder()
  const parts = new Map(entries.map((entry) => [entry.name, decoder.decode(entry.data)]))

  const root = [...relationships(parts, '').values()].find((rel) => rel.type.endsWith('/officeDocument'))
  const workbookPath = root?.target ?? 'xl/workbook.xml'
  const workbook = parts.get(workbookPath)
  if (!workbook) throw new XlsxError('no workbook in the archive')
  const rels = relationships(parts, workbookPath)

  const sharedPath = [...rels.values()].find((rel) => rel.type.endsWith('/sharedStrings'))?.target
  const sharedSource = sharedPath ? parts.get(sharedPath) : undefined
  const shared = sharedSource ? childrenLocal(parseXml(sharedSource), 'si').map((si) => richText(si)) : []

  const sheets: XlsxReadSheet[] = []
  for (const sheet of childrenLocal(childLocal(parseXml(workbook), 'sheets'), 'sheet')) {
    // `r:id`, under whatever prefix the relationships namespace was given.
    const id = Object.entries(sheet.attrs).find(([name]) => name.endsWith(':id'))?.[1] ?? ''
    const target = rels.get(id)?.target
    const source = target ? parts.get(target) : undefined
    if (!source) continue
    sheets.push({ name: sheet.attrs.name ?? '', rows: sheetRows(source, shared) })
  }
  return sheets
}
