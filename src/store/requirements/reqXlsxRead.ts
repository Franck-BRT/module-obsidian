import type { XlsxReadSheet } from '../xlsxRead'
import { CSV_COLUMNS, type CsvTable } from './reqCsv'

/**
 * A spreadsheet read back into the table a CSV import reads.
 *
 * The export writes for a person: headers in the reader's language, a status as the word
 * on its badge, a language's wording under its code. So reading it back is mostly
 * translation — header to column, badge word to stored value — and from there the plan,
 * the preview and the writing are the CSV import's, already trusted.
 *
 * A sheet that did not come from this plugin reads too, as long as its headers say what
 * they hold: the CSV's own column names, or the words the export would have used.
 */

export type XlsxEnumField = 'type' | 'status' | 'criticality' | 'verification'

export interface XlsxVocabulary {
  /** A header, lowercased, to the CSV column it fills. */
  headers: Record<string, string>
  /** Languages a column titled with its code — `FR`, `EN` — is read as the wording in. */
  languages: string[]
  /** Headers of columns worked out rather than stored, recognised and left alone. */
  computed: string[]
  /** For each field written as a word on a badge, that word lowercased to the stored value. */
  values: Record<XlsxEnumField, Record<string, string>>
}

export interface XlsxTable extends CsvTable {
  /** Which sheet the requirements were read from. */
  sheet: string
  /**
   * Badge values matching nothing the palettes hold — a typo typed into Excel, or a
   * status deleted since the export — as `Header : value`, in the sheet's own words. Written as typed, and named, so
   * a requirement does not quietly acquire a status nobody defined.
   */
  unmatched: string[]
}

const ENUM_FIELDS = new Set<string>(['type', 'status', 'criticality', 'verification'])

/** What a header holds: a column, `null` for one left alone on purpose, `undefined` for one not known. */
function columnOf(header: string, vocabulary: XlsxVocabulary): string | null | undefined {
  const name = header.trim().toLowerCase()
  if (name === '') return null
  const csv = CSV_COLUMNS.find((column) => column.toLowerCase() === name)
  if (csv) return csv
  if (name.startsWith('text.') && name.length > 5) return name
  const worded = vocabulary.headers[name]
  if (worded) return worded
  if (vocabulary.languages.some((lang) => lang.toLowerCase() === name)) return `text.${name}`
  if (vocabulary.computed.some((computed) => computed.toLowerCase() === name)) return null
  return undefined
}

/** Whether a row of headers is one this can read requirements under. */
function isHeader(row: string[], vocabulary: XlsxVocabulary): boolean {
  return row.some((cell) => {
    const column = columnOf(cell, vocabulary)
    return column === 'id' || (typeof column === 'string' && column.startsWith('text.'))
  })
}

/** A cell as the CSV column expects it. */
function valueOf(
  column: string,
  raw: string,
  vocabulary: XlsxVocabulary,
  unmatched: Set<string>,
  header: string
): string {
  const value = raw.trim()
  if (ENUM_FIELDS.has(column)) {
    // The badge's word back to the value behind it; a value typed as the value itself
    // — `approved` rather than `Approuvée` — is already what the column wants.
    const words = vocabulary.values[column as XlsxEnumField]
    const found = words[value.toLowerCase()]
    if (found !== undefined) return found
    if (value !== '' && !Object.values(words).includes(value)) unmatched.add(`${header} : ${value}`)
    return value
  }
  // The export marks a link the far end moved under with "(?)". The mark is the
  // library's to decide, never the file's, so it is read off rather than into the target.
  if (column === 'links') return value.replace(/\s*\(\?\)\s*$/gm, '')
  // A wording keeps its inner lines as written; only the edges are trimmed.
  return column.startsWith('text.') ? raw.replace(/^\s+|\s+$/g, '') : value
}

/**
 * The requirements in a workbook, as a table.
 *
 * From the first sheet whose header row names an identifier or a wording, which in the
 * plugin's own export is the requirements sheet — the traceability sheet beside it is
 * worked out, and nothing in it is read back. The header is looked for in the first few
 * rows, since a sheet laid out by hand often has a title above its table.
 */
export function xlsxTable(sheets: XlsxReadSheet[], vocabulary: XlsxVocabulary): XlsxTable | null {
  for (const sheet of sheets) {
    const at = sheet.rows.slice(0, 5).findIndex((row) => isHeader(row, vocabulary))
    if (at === -1) continue
    const header = sheet.rows[at]
    const columns = header.map((cell) => columnOf(cell, vocabulary))
    const unknown = header.filter((cell, index) => columns[index] === undefined && cell.trim() !== '')

    const unmatched = new Set<string>()
    const rows = sheet.rows.slice(at + 1).map((cells) => {
      const row: Record<string, string> = {}
      columns.forEach((column, index) => {
        if (!column) return
        const value = valueOf(column, cells[index] ?? '', vocabulary, unmatched, header[index].trim())
        // Two headers naming one column — `id` and `Identifiant` — keep the first that
        // says something.
        if (value !== '' && row[column] === undefined) row[column] = value
      })
      return row
    })
    return {
      sheet: sheet.name,
      headers: columns.filter((column): column is string => typeof column === 'string'),
      rows,
      unknown,
      unmatched: [...unmatched]
    }
  }
  return null
}
