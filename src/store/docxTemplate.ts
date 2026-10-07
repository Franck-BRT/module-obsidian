import { decodeXml } from './translate/docxTranslate'
import { unzip } from './unzip'
import { escapeXml } from './xml'
import { zip } from './zip'

/**
 * A Word document of the reader's own — their letterhead, their logo, their styles —
 * filled in: its fields between double braces, `{{numero}}`, given their values, and each
 * table row, or paragraph, naming a field of a document written once for each document.
 *
 * Word cuts a paragraph's text into runs as it pleases — a correction, a change of
 * language —, and a field typed in one go can come out split over three. So the fields
 * are put back together first, each in the run it starts in; then the rows are repeated,
 * and the values written. Everything else is left as Word wrote it.
 */

export class DocxTemplateError extends Error {}

export interface DocxFields {
  /** The field a name between braces stands for; null when it is none, and left as it is. */
  fieldOf: (name: string) => string | null
  /** Whether a field is a document's, its row repeated. */
  isRowField: (field: string) => boolean
  note: Record<string, string>
  rows: Record<string, string>[]
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g
const TEXT = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g

/** The parts whose text is filled in: the body, the headers and footers, the notes. */
function isFilled(name: string): boolean {
  return /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)
}

/**
 * Each field gathered in the text node it starts in, taken from those it ran over — within
 * a paragraph, as a field never runs over two.
 */
export function joinSplitFields(xml: string): string {
  // The text nodes, and where each paragraph ends.
  const nodes: { start: number; end: number; attrs: string; text: string; paragraph: number }[] = []
  const ends: number[] = []
  for (const match of xml.matchAll(/<\/w:p>/g)) ends.push(match.index)
  let paragraph = 0
  for (const match of xml.matchAll(TEXT)) {
    while (paragraph < ends.length && ends[paragraph] < match.index) paragraph++
    nodes.push({
      start: match.index,
      end: match.index + match[0].length,
      attrs: match[1] ?? '',
      text: decodeXml(match[2]),
      paragraph
    })
  }
  let changed = false
  for (let first = 0; first < nodes.length;) {
    let last = first
    while (last + 1 < nodes.length && nodes[last + 1].paragraph === nodes[first].paragraph) last++
    const group = nodes.slice(first, last + 1)
    const joined = group.map((node) => node.text).join('')
    if (joined.includes('{{')) {
      // Where each node's text starts in the paragraph's.
      const offsets: number[] = []
      let at = 0
      for (const node of group) {
        offsets.push(at)
        at += node.text.length
      }
      const nodeAt = (position: number): number => {
        let index = 0
        while (index + 1 < group.length && offsets[index + 1] <= position) index++
        return index
      }
      const matches = [...joined.matchAll(PLACEHOLDER)].reverse()
      for (const match of matches) {
        const from = match.index
        const to = from + match[0].length
        const head = nodeAt(from)
        const tail = nodeAt(to - 1)
        if (head === tail) continue
        changed = true
        const headNode = group[head]
        const local = from - offsets[head]
        headNode.text = headNode.text.slice(0, local) + match[0]
        for (let index = head + 1; index < tail; index++) group[index].text = ''
        group[tail].text = group[tail].text.slice(to - offsets[tail])
      }
    }
    first = last + 1
  }
  if (!changed) return xml
  let out = ''
  let cursor = 0
  for (const node of nodes) {
    out += xml.slice(cursor, node.start)
    out += `<w:t xml:space="preserve">${escapeXml(node.text)}</w:t>`
    cursor = node.end
  }
  return out + xml.slice(cursor)
}

/** Where the elements of a tag are, the innermost first found, by their opening and closing. */
function elements(xml: string, tag: string): { start: number; end: number }[] {
  const open = new RegExp(`<${tag}[\\s>]`, 'g')
  const close = `</${tag}>`
  const found: { start: number; end: number }[] = []
  const stack: number[] = []
  const marks: { at: number; opening: boolean }[] = []
  for (const match of xml.matchAll(open)) marks.push({ at: match.index, opening: true })
  for (let at = xml.indexOf(close); at >= 0; at = xml.indexOf(close, at + 1)) marks.push({ at, opening: false })
  marks.sort((a, b) => a.at - b.at)
  for (const mark of marks) {
    if (mark.opening) stack.push(mark.at)
    else {
      const start = stack.pop()
      if (start !== undefined) found.push({ start, end: mark.at + close.length })
    }
  }
  return found
}

/** The values put in the text nodes; a line break in a value made Word's. */
function fillText(xml: string, value: (name: string) => string | null): string {
  return xml.replace(TEXT, (whole, attrs: string | undefined, raw: string) => {
    const text = decodeXml(raw)
    if (!text.includes('{{')) return whole
    const filled = text.replace(PLACEHOLDER, (field, name: string) => value(name) ?? field)
    const lines = filled.split('\n').map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
    void attrs
    return lines.join('<w:br/>')
  })
}

/** One part filled: rows and paragraphs naming a document's field repeated, then every field. */
export function fillDocxPart(source: string, fields: DocxFields): string {
  let xml = joinSplitFields(source)
  const namesIn = (part: string): string[] =>
    [...part.matchAll(TEXT)].flatMap((match) => [...decodeXml(match[2]).matchAll(PLACEHOLDER)].map((field) => field[1]))
  const perRow = (part: string): boolean =>
    namesIn(part).some((name) => {
      const field = fields.fieldOf(name)
      return !!field && fields.isRowField(field)
    })
  const value = (row: Record<string, string> | null) => (name: string) => {
    const field = fields.fieldOf(name)
    if (!field) return null
    // A document's field it has no value for: a dash, as the note's table has.
    return fields.isRowField(field) ? row?.[field] || '—' : (fields.note[field] ?? '')
  }
  // Table rows first, then paragraphs left outside them: the innermost holding a document's field.
  for (const tag of ['w:tr', 'w:p']) {
    const repeated = elements(xml, tag)
      .filter((range) => perRow(xml.slice(range.start, range.end)))
      .filter(
        (range, _, all) => !all.some((other) => other !== range && other.start >= range.start && other.end <= range.end)
      )
      .sort((a, b) => b.start - a.start)
    for (const range of repeated) {
      const part = xml.slice(range.start, range.end)
      const copies = fields.rows.map((row) => fillText(part, value(row))).join('')
      xml = xml.slice(0, range.start) + copies + xml.slice(range.end)
    }
  }
  // A paragraph made only of the note's fields, all empty — a remark not given —, taken
  // out; not in a table's cell, which Word wants a paragraph in.
  const cells = elements(xml, 'w:tc')
  const empties = elements(xml, 'w:p')
    .filter((range) => !cells.some((cell) => cell.start < range.start && cell.end > range.end))
    .filter((range) => {
      const text = [...xml.slice(range.start, range.end).matchAll(TEXT)].map((match) => decodeXml(match[2])).join('')
      if (!/^\s*(\{\{[^{}]+\}\}\s*)+$/.test(text)) return false
      return [...text.matchAll(PLACEHOLDER)].every((match) => {
        const field = fields.fieldOf(match[1])
        return !!field && !(fields.note[field] ?? '').trim()
      })
    })
    .sort((a, b) => b.start - a.start)
  for (const range of empties) xml = xml.slice(0, range.start) + xml.slice(range.end)
  return fillText(xml, value(null))
}

/** The reader's Word document, filled. */
export async function fillDocxTemplate(bytes: Uint8Array, fields: DocxFields): Promise<Uint8Array> {
  let entries
  try {
    entries = await unzip(bytes)
  } catch {
    throw new DocxTemplateError('not a Word document')
  }
  if (!entries.some((entry) => entry.name === 'word/document.xml')) throw new DocxTemplateError('not a Word document')
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  return zip(
    entries.map((entry) =>
      isFilled(entry.name)
        ? { name: entry.name, data: encoder.encode(fillDocxPart(decoder.decode(entry.data), fields)) }
        : { name: entry.name, data: entry.data }
    )
  )
}
