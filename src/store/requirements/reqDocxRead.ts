import type { DocxReadBlock, DocxReadParagraph } from '../docxRead'
import type { Requirement } from './Requirement'
import { findByName } from './reqAlias'
import { xlsxTable, type XlsxEnumField, type XlsxVocabulary } from './reqXlsxRead'

/**
 * The requirements in a Word document, as the rows a CSV import reads.
 *
 * Two shapes, because requirements arrive in Word in two:
 *
 * - **Tables** whose header names an identifier or a wording — what a `pm-req` block
 *   exports as, and how many specifications lay requirements out. Read exactly as a
 *   spreadsheet's sheet is.
 * - **Paragraphs** that open with an identifier — `REQ-SYS-0001 — Title` as a heading,
 *   which is how the library exports, or `[SYS-12] The system shall…` inline, which is how
 *   a great many specifications are written. A heading's requirement runs until the next
 *   heading or identifier; an inline one is its own paragraph.
 *
 * Everything else in the document is prose, and prose is left alone: a document is not a
 * library, and guessing which sentence is a requirement is how an import invents some.
 */

export interface DocxVocabulary extends XlsxVocabulary {
  /** The label the library export puts before the source: `Origine : CDC §4`. */
  sourceLabels: string[]
  /** The heading the export gives requirements with no category. */
  noCategory: string[]
  /** Headers of a block's wording column, which carries no language of its own. */
  wording: string[]
  /**
   * The notes the export writes under a wording in a table — a translation behind its
   * source, a machine wording nobody read. Commentary on the words, not words.
   */
  isMark: (line: string) => boolean
  /** The language a "shown in place of a missing translation" note names, if the line is one. */
  fallbackLang: (line: string) => string | undefined
}

export interface DocxRequirements {
  rows: Record<string, string>[]
  /** Table headers with no place in a requirement. */
  unknown: string[]
  unmatched: string[]
  /** How many came from tables and how many from paragraphs, for the reader to check. */
  fromTables: number
  fromText: number
}

// An identifier: letters, then segments, the last one digits — `REQ-THERM-0001`,
// `SYS-12`, `SRS_042`. Upper case only, so an ordinary word followed by a number is not one.
const ID = /^\s*[[(]?([A-Z][A-Z0-9]*(?:[-_.][A-Z0-9]+)*[-_.]\d+)[\])]?(?=$|[\s:–—-])\s*(?:[:–—-]\s*)?(.*)$/s

/** A paragraph that opens with an identifier: the identifier, and what follows it. */
export function leadingId(text: string): { id: string; rest: string } | null {
  const found = ID.exec(text.replace(/^[•·▪–-]\s+/, ''))
  return found ? { id: found[1], rest: found[2].trim() } : null
}

/** Paragraphs apart by a blank line, the items of one list under each other. */
function joinBody(body: string[]): string {
  return body
    .map((line, at) => {
      if (at === 0) return line
      const sameList = line.startsWith('- ') && body[at - 1].startsWith('- ')
      return `${sameList ? '\n' : '\n\n'}${line}`
    })
    .join('')
    .trim()
}

interface Section {
  row: Record<string, string>
  body: string[]
  /** Whether following paragraphs belong to it: a heading's do, an inline one's do not. */
  open: boolean
}

/**
 * The badge line under a requirement's heading — `Approuvée · Fonctionnelle · Haute ·
 * Essai` — back into fields. Each word is given to the first field, in the order the
 * export writes them, that knows it; a word nobody knows is named rather than guessed.
 */
export function readMeta(
  line: string,
  vocabulary: DocxVocabulary,
  row: Record<string, string>,
  unmatched: Set<string>
): void {
  const order: XlsxEnumField[] = ['status', 'type', 'criticality', 'verification']
  // The word on the badge, or the stored value itself: the Markdown export writes the
  // second, being a text for anybody rather than a document for a reader of this plugin.
  const valueOf = (field: XlsxEnumField, bit: string): string | undefined =>
    vocabulary.values[field][bit.toLowerCase()] ??
    Object.values(vocabulary.values[field]).find((value) => value === bit)
  let from = 0
  for (const bit of line
    .split('·')
    .map((piece) => piece.trim())
    .filter(Boolean)) {
    const at = order.findIndex((field, index) => index >= from && valueOf(field, bit) !== undefined)
    if (at === -1) {
      unmatched.add(bit)
      continue
    }
    row[order[at]] ??= valueOf(order[at], bit) ?? bit
    from = at + 1
  }
}

function sourceOf(line: string, vocabulary: DocxVocabulary): string | undefined {
  for (const label of vocabulary.sourceLabels) {
    const found = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`, 'is').exec(line.trim())
    if (found) return found[1].trim()
  }
  return undefined
}

/** A category heading is a short code, as the library's are; `1 Introduction` is not one. */
function categoryOf(heading: string, vocabulary: DocxVocabulary): string | undefined {
  const text = heading.trim()
  if (vocabulary.noCategory.some((label) => label.toLowerCase() === text.toLowerCase())) return ''
  return /^[A-Z][A-Z0-9_]{1,15}$/.test(text) ? text : undefined
}

/** A wording cell: the notes under it taken off, and the language a fallback note names. */
function cleanWording(cell: string, vocabulary: DocxVocabulary): { body: string; lang?: string } {
  const lines = cell.split('\n')
  let lang: string | undefined
  while (lines.length > 1) {
    const last = lines[lines.length - 1].trim()
    const pieces = last.split(' · ').map((piece) => piece.trim())
    if (!pieces.every((piece) => vocabulary.isMark(piece))) break
    for (const piece of pieces) lang ??= vocabulary.fallbackLang(piece)
    lines.pop()
  }
  const body = lines.join('\n').trim()
  return { body: body === '—' ? '' : body, lang }
}

function tableRows(
  rows: string[][],
  vocabulary: DocxVocabulary,
  lang: string,
  unknown: Set<string>,
  unmatched: Set<string>
): Record<string, string>[] {
  // The block's wording column says no language; it is in the one the document is read as.
  const headers = { ...vocabulary.headers }
  for (const label of vocabulary.wording) headers[label.trim().toLowerCase()] = `text.${lang}`
  const table = xlsxTable([{ name: '', rows }], { ...vocabulary, headers })
  if (!table) return []
  for (const header of table.unknown) unknown.add(header)
  for (const value of table.unmatched) unmatched.add(value)
  return table.rows.flatMap((row) => {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) {
      if (!key.startsWith('text.')) {
        out[key] = value
        continue
      }
      const cleaned = cleanWording(value, vocabulary)
      if (cleaned.body) out[`text.${cleaned.lang ?? key.slice(5)}`] = cleaned.body
    }
    // A row that names no requirement and says nothing — a total, a remark, a rule —
    // is the document's, not the library's. One that names a requirement stays, to be
    // shown refused if it has nothing to write.
    const named = leadingId(out.id ?? '')
    const says = Object.keys(out).some((key) => key.startsWith('text.')) || out.title
    return says || (named && named.rest === '') ? [out] : []
  })
}

/**
 * The requirements a document holds, read as `lang` where it does not say otherwise.
 */
export function docxRequirements(blocks: DocxReadBlock[], vocabulary: DocxVocabulary, lang: string): DocxRequirements {
  const unknown = new Set<string>()
  const unmatched = new Set<string>()
  const rows: Record<string, string>[] = []
  let fromTables = 0
  let fromText = 0
  let category: string | undefined
  let section: Section | null = null

  const close = (): void => {
    if (!section) return
    const text = joinBody(section.body)
    if (text) section.row[`text.${lang}`] = text
    if (section.row.id && (text || section.row.title)) {
      rows.push(section.row)
      fromText += 1
    }
    section = null
  }

  const paragraph = (block: DocxReadParagraph): void => {
    const text = block.text.trim()
    // Not from a note: the line an export writes for an identifier the library does not
    // hold — "REQ-X-0404 : introuvable" — names a requirement that is missing, not one
    // to create.
    const found = block.style === 'meta' ? null : leadingId(text)
    if (found && found.id) {
      close()
      const row: Record<string, string> = { id: found.id }
      // Under a category's heading, whichever way the requirement is written.
      if (category !== undefined) row.category = category
      if (block.style === 'heading' || block.style === 'title') {
        if (found.rest) row.title = found.rest
        section = { row, body: [], open: true }
      } else if (found.rest) {
        // Inline: the paragraph is the requirement, and the next one is not.
        section = { row, body: [found.rest], open: false }
      } else section = { row, body: [], open: true }
      return
    }
    if (block.style === 'heading' || block.style === 'title') {
      close()
      // Only a top-level heading can be a category, and only one that looks like one.
      if (block.style === 'heading' && block.level === 1) category = categoryOf(text, vocabulary)
      return
    }
    if (!section || !section.open || !text) return
    const current: Section = section
    // The export writes "—" for a requirement with no wording in the language asked for.
    if (text === '—') return
    if (block.style === 'meta') {
      const source = sourceOf(text, vocabulary)
      if (source !== undefined) current.row.source ??= source
      else if (!current.body.length) readMeta(text, vocabulary, current.row, unmatched)
      return
    }
    if (block.style === 'quote') {
      current.row.rationale = current.row.rationale ? `${current.row.rationale}\n\n${text}` : text
      return
    }
    current.body.push(block.style === 'list' ? `- ${text.replace(/^[•·▪]\s*/, '')}` : text)
  }

  for (const block of blocks) {
    if (block.kind === 'table') {
      close()
      const read = tableRows(block.rows, vocabulary, lang, unknown, unmatched)
      rows.push(...read)
      fromTables += read.length
    } else paragraph(block)
  }
  close()
  return { rows, unknown: [...unknown], unmatched: [...unmatched], fromTables, fromText }
}

/**
 * A wording that is word for word one the library already holds, filed under that
 * language.
 *
 * A Word document says nothing about which language each wording is in, and the export
 * shows a requirement nobody translated in its source language. Read as the document's
 * language, that source wording would come home as a new translation of itself. Matched
 * exactly, it is recognised for what it is and changes nothing.
 */
export function settleLanguages(rows: Record<string, string>[], library: Requirement[]): Record<string, string>[] {
  return rows.map((row) => {
    const held = row.id ? findByName(library, row.id) : null
    if (!held) return row
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) {
      const lang = key.startsWith('text.') ? key.slice(5) : ''
      const same =
        lang && held.text[lang]?.body !== value
          ? Object.entries(held.text).find(([other, text]) => other !== lang && text.body === value)
          : undefined
      const target = same && row[`text.${same[0]}`] === undefined ? `text.${same[0]}` : key
      out[target] = value
    }
    return out
  })
}

/**
 * A wording that differs from the one held only in where its lines break, taken as the
 * one held.
 *
 * For a PDF, which draws lines and does not record why each one ended: a break the author
 * wrote at the very end of a full line looks exactly like the layout running out of room.
 * A difference a PDF cannot express is not a change somebody made.
 */
export function settleSpacing(rows: Record<string, string>[], library: Requirement[]): Record<string, string>[] {
  const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()
  return rows.map((row) => {
    const held = row.id ? findByName(library, row.id) : null
    if (!held) return row
    const out: Record<string, string> = { ...row }
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith('text.')) {
        const body = held.text[key.slice(5)]?.body
        if (body !== undefined && flat(body) === flat(value)) out[key] = body
      } else if (key === 'rationale' && flat(held.rationale) === flat(value)) out[key] = held.rationale
    }
    return out
  })
}

/**
 * Whether a table row starts a requirement of its own: it does when the column the
 * header names as the identifier holds a whole one. For a PDF, where a row cut by a page
 * break goes on under the header repeated on the next page.
 */
export function startsRequirementRow(vocabulary: DocxVocabulary): (header: string[], cells: string[]) => boolean {
  return (header, cells) => {
    const at = header.findIndex((name) => {
      const key = name.trim().toLowerCase()
      return key === 'id' || vocabulary.headers[key] === 'id'
    })
    if (at === -1) return cells[0] !== ''
    const found = leadingId(cells[at] ?? '')
    return found !== null && found.rest === ''
  }
}
