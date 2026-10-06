import { stringifyYaml } from 'obsidian'
import type { DocState, DocVersion, Task } from '../types'
import { DOCX_TEXT_WIDTH, para, type DocxBlock, type DocxCell, type DocxDocument } from './docx'
import { documentOf, isDocument } from './Document'

/**
 * A delivery note — a bordereau de livraison —: the documents sent, in a table of their
 * reference, title, state and version, who sends them to whom and when, under a number of
 * its own, and the blocks the two sign. For Word and PDF alike, and as a note to keep.
 */

export interface DeliveryRow {
  reference: string
  title: string
  state: DocState
  /** Its issue, as the register keeps it — « B », « 2-15 » —; else the number of its last deposit. */
  version: string
}

/** The documents among these tasks, as the note lists them: by reference, then by title. */
export function deliveryRows(tasks: Task[]): DeliveryRow[] {
  return tasks
    .filter(isDocument)
    .map((task) => {
      const meta = documentOf(task)
      const last: DocVersion | undefined = meta.versions[meta.versions.length - 1]
      return {
        reference: meta.reference,
        title: task.title,
        state: meta.state,
        version: meta.issue || (last ? `v${last.version}` : '')
      }
    })
    .sort((a, b) => byReference(a, b))
}

/** By reference, those without one last; then by title. */
export function byReference(a: { reference: string; title: string }, b: { reference: string; title: string }): number {
  return (
    Number(!a.reference) - Number(!b.reference) ||
    a.reference.localeCompare(b.reference) ||
    a.title.localeCompare(b.title)
  )
}

/** The next number in a year's run, past those already given: « BL-2026-004 » after « BL-2026-003 ». */
export function nextDeliveryNumber(given: string[], year: string): string {
  const prefix = `BL-${year}-`
  const last = given
    .filter((one) => one.startsWith(prefix))
    .map((one) => Number(one.slice(prefix.length)))
    .filter(Number.isFinite)
  return `${prefix}${String(Math.max(0, ...last) + 1).padStart(3, '0')}`
}

export interface DeliveryContext {
  project: string
  number: string
  /** As it is to be read: « 6 octobre 2026 ». */
  date: string
  sender: string
  recipient: string
  note: string
}

export interface DeliveryWords {
  title: string
  numberDate: (number: string, date: string) => string
  project: string
  sender: string
  recipient: string
  reference: string
  documentTitle: string
  state: string
  version: string
  count: (count: number) => string
  stateLabel: (state: DocState) => string
  signatures: string
  sentBy: string
  receivedBy: string
  signHere: string
}

/** The delivery note as a document: what Word and PDF are made from alike. */
export function deliveryDocument(rows: DeliveryRow[], context: DeliveryContext, words: DeliveryWords): DocxDocument {
  const cell = (text: string, width: number, bold = false): DocxCell => ({
    runs: [{ text, ...(bold ? { bold: true } : {}) }],
    width
  })
  // Twentieths of a point: the title takes what the other three leave.
  const widths = [2200, 0, 1800, 1300]
  widths[1] = DOCX_TEXT_WIDTH - widths[0] - widths[2] - widths[3]
  const parties = [`${words.sender} ${context.sender || '—'}`, `${words.recipient} ${context.recipient || '—'}`]
  const blocks: DocxBlock[] = [
    para('Title', words.title),
    para('Meta', words.numberDate(context.number, context.date)),
    para('Heading2', `${words.project} ${context.project}`),
    ...parties.map((line) => para('Normal', line)),
    ...(context.note.trim() ? [para('Quote', context.note.trim())] : []),
    {
      kind: 'table',
      header: [words.reference, words.documentTitle, words.state, words.version].map((text, at) =>
        cell(text, widths[at], true)
      ),
      rows: rows.map((row) => [
        cell(row.reference || '—', widths[0]),
        cell(row.title, widths[1]),
        cell(words.stateLabel(row.state), widths[2]),
        cell(row.version || '—', widths[3])
      ])
    },
    para('Meta', words.count(rows.length)),
    para('Heading1', words.signatures)
  ]
  const half = Math.floor(DOCX_TEXT_WIDTH / 2)
  const space = `${words.signHere}\n\n\n\n`
  blocks.push({
    kind: 'table',
    header: [cell(words.sentBy, half, true), cell(words.receivedBy, half, true)],
    rows: [[cell(space, half), cell(space, half)]]
  })
  return { title: `${words.title} ${context.number} — ${context.project}`, blocks }
}

/** A table cell of a Markdown note: no pipe nor line break to break its row. */
function mdCell(text: string): string {
  return (
    text
      .replace(/\|/g, '/')
      .replace(/\s*\n\s*/g, ' ')
      .trim() || '—'
  )
}

/** The delivery note kept beside the project: its properties, its table, and its Word and PDF. */
export function deliveryNote(
  rows: DeliveryRow[],
  context: DeliveryContext & { isoDate: string },
  words: DeliveryWords,
  files: string[]
): string {
  const properties = {
    type: 'delivery-note',
    number: context.number,
    project: context.project,
    date: context.isoDate,
    recipient: context.recipient,
    documents: rows.length
  }
  const lines = [
    '---',
    stringifyYaml(properties).trimEnd(),
    '---',
    '',
    `# ${words.title} ${context.number}`,
    '',
    `${words.numberDate(context.number, context.date)}  `,
    `${words.project} ${context.project}  `,
    `${words.sender} ${context.sender || '—'}  `,
    `${words.recipient} ${context.recipient || '—'}`,
    ''
  ]
  if (context.note.trim()) lines.push(`> ${context.note.trim().replace(/\n/g, '\n> ')}`, '')
  lines.push(
    `| ${words.reference} | ${words.documentTitle} | ${words.state} | ${words.version} |`,
    '| --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${mdCell(row.reference)} | ${mdCell(row.title)} | ${mdCell(words.stateLabel(row.state))} | ${mdCell(row.version)} |`
    ),
    '',
    words.count(rows.length),
    ''
  )
  if (files.length) lines.push(files.map((path) => `[[${path}]]`).join(' · '), '')
  return lines.join('\n')
}
