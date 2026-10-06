import { CfbError, isCfb, readCfb } from './cfb'
import { DATE_FORMAT_IDS, isDateFormat, readXlsx, serialDate, type XlsxReadSheet } from './xlsxRead'
import { decipherWorkbook } from './xlsCrypt'

/**
 * A workbook of Excel 97–2003 — the `.xls` of before 2007 —, read by hand, as the `.xlsx`
 * one is: the values, sheet by sheet, row by row, every value as text, dates as dates.
 *
 * The file is a compound file (`cfb`) whose `Workbook` stream is a run of records, each a
 * type, a length and its bytes: first the workbook's own — the sheets and where they
 * start, the table of shared strings, the number formats and the cell styles that use
 * them —, then each sheet's, whose cells are records too: a shared string, a number, a
 * compact number, a row of them, a formula with its last result.
 *
 * Read too: Excel 5 and 95's `Book` stream, whose strings are one byte a character in the
 * workbook's code page, and a workbook protected against changes only, which Excel enciphers
 * with its own password (`xlsCrypt`). Not read: workbooks that need a password to open
 * (refused, by name).
 */

export class XlsError extends Error {}

const BOF = 0x0809
const EOF = 0x000a
const BOUNDSHEET = 0x0085
const SST = 0x00fc
const CONTINUE = 0x003c
const LABELSST = 0x00fd
const LABEL = 0x0204
const RSTRING = 0x00d6
const NUMBER = 0x0203
const RK = 0x027e
const MULRK = 0x00bd
const FORMULA = 0x0006
const STRING = 0x0207
const BOOLERR = 0x0205
const FORMAT = 0x041e
const FORMAT_OLD = 0x001e
const XF = 0x00e0
const DATEMODE = 0x0022
const CODEPAGE = 0x0042
const FILEPASS = 0x002f

interface BiffRecord {
  type: number
  at: number
  data: Uint8Array
}

/** The records from an offset to the end of their substream, those nested in it passed over. */
function* records(stream: Uint8Array, from: number): Generator<BiffRecord> {
  let at = from
  let depth = 0
  while (at + 4 <= stream.length) {
    const type = stream[at] | (stream[at + 1] << 8)
    const length = stream[at + 2] | (stream[at + 3] << 8)
    const data = stream.subarray(at + 4, at + 4 + length)
    yield { type, at, data }
    at += 4 + length
    if (type === BOF) depth++
    else if (type === EOF && --depth <= 0) return
  }
}

const u16 = (data: Uint8Array, at: number): number => data[at] | (data[at + 1] << 8)
const u32 = (data: Uint8Array, at: number): number =>
  (data[at] | (data[at + 1] << 8) | (data[at + 2] << 16)) + data[at + 3] * 0x1000000

function f64(data: Uint8Array, at: number): number {
  return new DataView(data.buffer, data.byteOffset + at, 8).getFloat64(0, true)
}

/** A compact number: an integer or the high half of a float, either perhaps a hundredth. */
function rk(value: number): number {
  let out: number
  if (value & 2) out = (value | 0) >> 2
  else {
    const bytes = new DataView(new ArrayBuffer(8))
    bytes.setUint32(4, value & 0xfffffffc, true)
    out = bytes.getFloat64(0, true)
  }
  return value & 1 ? out / 100 : out
}

function latin(bytes: Uint8Array, decoder: TextDecoder): string {
  return decoder.decode(bytes)
}

function utf16(data: Uint8Array, at: number, chars: number): string {
  let out = ''
  for (let char = 0; char < chars && at + char * 2 + 1 < data.length; char++) {
    out += String.fromCharCode(data[at + char * 2] | (data[at + char * 2 + 1] << 8))
  }
  return out
}

/**
 * A string of a record, Excel 97's way: its length, a byte of flags, its characters one
 * or two bytes each. `lengthBytes` is 1 for a sheet's name, 2 elsewhere.
 */
function biffString(data: Uint8Array, at: number, lengthBytes: 1 | 2, biff8: boolean, decoder: TextDecoder): string {
  const chars = lengthBytes === 1 ? data[at] : u16(data, at)
  let pos = at + lengthBytes
  if (!biff8) return latin(data.subarray(pos, pos + chars), decoder)
  const flags = data[pos++]
  if (flags & 0x08) pos += 2
  if (flags & 0x04) pos += 4
  return flags & 0x01 ? utf16(data, pos, chars) : latin(data.subarray(pos, pos + chars), LATIN1)
}

const LATIN1 = new TextDecoder('latin1')

/**
 * The table of shared strings, which runs over as many CONTINUE records as it needs — and a
 * string's characters may be cut between two of them, the second saying again, in a byte
 * of its own, whether they are one byte or two.
 */
function sharedStrings(parts: Uint8Array[]): string[] {
  let part = 0
  let pos = 0
  const ensure = (): boolean => {
    while (part < parts.length && pos >= parts[part].length) {
      part++
      pos = 0
    }
    return part < parts.length
  }
  const byte = (): number => {
    if (!ensure()) throw new XlsError('table of strings cut short')
    return parts[part][pos++]
  }
  const word = (): number => byte() | (byte() << 8)
  const long = (): number => word() + word() * 0x10000
  const skip = (count: number): void => {
    for (let left = count; left > 0;) {
      if (!ensure()) return
      const take = Math.min(left, parts[part].length - pos)
      pos += take
      left -= take
    }
  }
  const first = parts[0]
  const unique = first.length >= 8 ? u32(first, 4) : 0
  pos = 8
  const out: string[] = []
  try {
    for (let n = 0; n < unique; n++) {
      const chars = word()
      const flags = byte()
      let wide = (flags & 0x01) !== 0
      const runs = flags & 0x08 ? word() : 0
      const extra = flags & 0x04 ? long() : 0
      let text = ''
      for (let char = 0; char < chars; char++) {
        // Cut here: the next record says again how wide the characters are.
        if (pos >= (parts[part]?.length ?? 0)) {
          part++
          pos = 0
          if (part >= parts.length) break
          wide = (parts[part][pos++] & 0x01) !== 0
        }
        text += String.fromCharCode(wide ? word() : byte())
      }
      skip(runs * 4 + extra)
      out.push(text)
    }
  } catch {
    // A table cut short: the strings read so far are the strings there are.
  }
  return out
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) return ''
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)))
}

/** Every sheet of the workbook, in the order its tabs are in. `password` is for tests: Excel's own is tried. */
export async function readXls(bytes: Uint8Array, password?: string): Promise<XlsxReadSheet[]> {
  let file
  try {
    file = readCfb(bytes)
  } catch (error) {
    throw new XlsError(error instanceof CfbError ? error.message : 'unreadable compound file')
  }
  let stream = file.stream('Workbook') ?? file.stream('Book')
  if (!stream) throw new XlsError('not an Excel workbook')
  // Enciphered: opened with Excel's own password, if that is the one.
  for (const record of records(stream, 0)) {
    if (record.type !== FILEPASS) continue
    const plain = await decipherWorkbook(stream, record.at, password)
    if (!plain) throw new XlsError('the workbook is protected by a password')
    stream = plain
    break
  }

  // The workbook's own records: its sheets, strings, formats and styles.
  let biff8 = true
  let decoder = new TextDecoder('windows-1252')
  const sheets: { name: string; at: number }[] = []
  const sstParts: Uint8Array[] = []
  let inSst = false
  const formats = new Map<number, string>()
  const xfFormats: number[] = []
  let from1904 = false
  for (const record of records(stream, 0)) {
    const { type, data } = record
    if (type !== CONTINUE) inSst = false
    if (type === BOF) biff8 = u16(data, 0) === 0x0600
    else if (type === CODEPAGE) {
      const page = u16(data, 0)
      if (page !== 1200) {
        try {
          decoder = new TextDecoder(page === 10000 ? 'macintosh' : `windows-${page}`)
        } catch {
          // A code page the browser does not know: the Western one, as before.
        }
      }
    } else if (type === BOUNDSHEET) {
      // Worksheets only: not the charts, nor the macro sheets.
      if ((data[5] ?? 0) === 0) sheets.push({ at: u32(data, 0), name: biffString(data, 6, 1, biff8, decoder) })
    } else if (type === SST) {
      sstParts.push(data)
      inSst = true
    } else if (type === CONTINUE && inSst) sstParts.push(data)
    else if (type === FORMAT) formats.set(u16(data, 0), biffString(data, 2, 2, biff8, decoder))
    else if (type === FORMAT_OLD) formats.set(u16(data, 0), biffString(data, 2, 1, false, decoder))
    else if (type === XF) xfFormats.push(u16(data, 2))
    else if (type === DATEMODE) from1904 = u16(data, 0) === 1
  }
  const shared = sstParts.length ? sharedStrings(sstParts) : []
  const dateStyle = (xf: number): boolean => {
    const id = xfFormats[xf]
    if (id === undefined) return false
    const code = formats.get(id)
    return code !== undefined ? isDateFormat(code) : DATE_FORMAT_IDS.has(id)
  }
  const number = (value: number, xf: number): string =>
    dateStyle(xf) && Number.isFinite(value) && value >= 0 ? serialDate(value, from1904) : numberText(value)

  return sheets.map(({ name, at }) => {
    const grid: string[][] = []
    const put = (row: number, col: number, value: string): void => {
      if (value === '') return
      const line = (grid[row] ??= [])
      while (line.length < col) line.push('')
      line[col] = value
    }
    // A formula whose result is text: the text comes in the record after it.
    let awaiting: [number, number] | null = null
    for (const { type, data } of records(stream, at)) {
      const text = type === LABEL || type === RSTRING ? biffString(data, 6, 2, biff8, decoder) : ''
      if (type === LABELSST) put(u16(data, 0), u16(data, 2), shared[u32(data, 6)] ?? '')
      else if (text) put(u16(data, 0), u16(data, 2), text)
      else if (type === NUMBER) put(u16(data, 0), u16(data, 2), number(f64(data, 6), u16(data, 4)))
      else if (type === RK) put(u16(data, 0), u16(data, 2), number(rk(u32(data, 6)), u16(data, 4)))
      else if (type === MULRK) {
        const row = u16(data, 0)
        const first = u16(data, 2)
        for (let col = first, pos = 4; pos + 6 <= data.length - 2; col++, pos += 6) {
          put(row, col, number(rk(u32(data, pos + 2)), u16(data, pos)))
        }
      } else if (type === FORMULA) {
        const row = u16(data, 0)
        const col = u16(data, 2)
        if (data[12] === 0xff && data[13] === 0xff) {
          // Not a number: text (in the next record), a truth value, an error, or nothing.
          if (data[6] === 0) awaiting = [row, col]
          else if (data[6] === 1) put(row, col, data[8] ? 'TRUE' : 'FALSE')
        } else put(row, col, number(f64(data, 6), u16(data, 4)))
      } else if (type === STRING && awaiting) {
        put(awaiting[0], awaiting[1], biffString(data, 0, 2, biff8, decoder))
        awaiting = null
      } else if (type === BOOLERR && data[7] === 0) put(u16(data, 0), u16(data, 2), data[6] ? 'TRUE' : 'FALSE')
    }
    const rows = grid.filter((line): line is string[] => !!line && line.some((value) => value.trim() !== ''))
    return { name, rows }
  })
}

/** A workbook, whichever of Excel's formats it is in: the binary one of before 2007, or the newer. */
export async function readSpreadsheet(bytes: Uint8Array): Promise<XlsxReadSheet[]> {
  return isCfb(bytes) ? readXls(bytes) : readXlsx(bytes)
}
