import { stringifyYaml } from 'obsidian'
import type { DocState, DocVersion, Task } from '../types'
import type { DocxDocument } from './docx'
import { documentOf, isDocument } from './Document'
import { fold } from './library/libraryDoc'
import { markdownBlocks, noteBody } from './markdownBlocks'

/**
 * A delivery note — a bordereau de livraison —: the documents sent, in a table of their
 * reference, title, state and version, who sends them to whom and when, under a number of
 * its own, and the blocks the two sign.
 *
 * Written from a template: a note the reader can change, its fields between double
 * braces — `{{numero}}`, `{{destinataire}}` — filled in, and each line naming a field of a
 * document — the row `| {{reference}} | {{titre}} |` — written once for each document
 * sent. The same filled note makes the Word and the PDF, so the three say the same.
 */

export interface DeliveryRow {
  reference: string
  title: string
  state: DocState
  /** Its issue, as the register keeps it — « B », « 2-15 » —; else the number of its last deposit. */
  version: string
  issuer: string
  /** The project's lot it sits in; '' when none. */
  lot: string
  /** The design stage it belongs to — APS, PRO, EXE. */
  phase: string
  /** The name of its file, without the folders. */
  file: string
  /** The day its last file was deposited, YYYY-MM-DD; '' when none. */
  deposited: string
  /** The day it is due, YYYY-MM-DD; '' when none. */
  due: string
}

/** The documents among these tasks, as the note lists them: by reference, then by title. */
export function deliveryRows(tasks: Task[], lotOf: (task: Task) => string = () => ''): DeliveryRow[] {
  return tasks
    .filter(isDocument)
    .map((task) => {
      const meta = documentOf(task)
      const last: DocVersion | undefined = meta.versions[meta.versions.length - 1]
      const file = meta.file || last?.file || ''
      return {
        reference: meta.reference,
        title: task.title,
        state: meta.state,
        version: meta.issue || (last ? `v${last.version}` : ''),
        issuer: meta.issuer,
        lot: lotOf(task),
        phase: meta.phase,
        file: file.replace(/^\[\[|\]\]$/g, '').replace(/^.*\//, ''),
        deposited: last?.at.slice(0, 10) ?? '',
        due: task.due ?? ''
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
  countLabel: string
  stateLabel: (state: DocState) => string
  /** A day, YYYY-MM-DD, as it is read. */
  day: (iso: string) => string
  signatures: string
  sentBy: string
  receivedBy: string
  signHere: string
  /** The template's own instructions, in its comment: a line each. */
  help: string[]
}

/** The fields of the note itself, and those of each document, by their French names. */
export const NOTE_FIELDS = ['numero', 'date', 'projet', 'expediteur', 'destinataire', 'remarque', 'nombre'] as const
export const ROW_FIELDS = [
  'n',
  'reference',
  'titre',
  'etat',
  'version',
  'emetteur',
  'lot',
  'phase',
  'fichier',
  'depot',
  'echeance'
] as const
export type DeliveryField = (typeof NOTE_FIELDS)[number] | (typeof ROW_FIELDS)[number]

/** Their English names, which read the same. */
export const ENGLISH_FIELDS: Record<DeliveryField, string> = {
  numero: 'number',
  date: 'date',
  projet: 'project',
  expediteur: 'sender',
  destinataire: 'recipient',
  remarque: 'note',
  nombre: 'count',
  n: 'no',
  reference: 'reference',
  titre: 'title',
  etat: 'state',
  version: 'version',
  emetteur: 'issuer',
  lot: 'lot',
  phase: 'phase',
  fichier: 'file',
  depot: 'deposited',
  echeance: 'due'
}

const ALIASES: Record<string, DeliveryField> = {
  ...(Object.fromEntries(Object.entries(ENGLISH_FIELDS).map(([field, english]) => [english, field])) as Record<
    string,
    DeliveryField
  >),
  ...(Object.fromEntries([...NOTE_FIELDS, ...ROW_FIELDS].map((field) => [field, field])) as Record<
    string,
    DeliveryField
  >),
  ref: 'reference',
  remark: 'remarque',
  status: 'etat',
  issue: 'version',
  indice: 'version'
}

const ROW_SET = new Set<string>(ROW_FIELDS)

/** The field a name between braces stands for — accents, case and spaces aside —; null for none. */
export function fieldOf(name: string): DeliveryField | null {
  return (
    ALIASES[
      fold(name)
        .trim()
        .replace(/[\s-]+/g, '_')
    ] ?? null
  )
}

export function isRowField(field: DeliveryField): boolean {
  return ROW_SET.has(field)
}

/** A field between double braces: `{{ numero }}`. */
export const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g

export interface DeliveryValues {
  note: Record<string, string>
  rows: Record<string, string>[]
}

/** What each field says, for the note and for each of its documents. */
export function deliveryValues(rows: DeliveryRow[], context: DeliveryContext, words: DeliveryWords): DeliveryValues {
  return {
    note: {
      numero: context.number,
      date: context.date,
      projet: context.project,
      expediteur: context.sender,
      destinataire: context.recipient,
      remarque: context.note.trim(),
      nombre: String(rows.length)
    },
    rows: rows.map((row, at) => ({
      n: String(at + 1),
      reference: row.reference,
      titre: row.title,
      etat: words.stateLabel(row.state),
      version: row.version,
      emetteur: row.issuer,
      lot: row.lot,
      phase: row.phase,
      fichier: row.file,
      depot: row.deposited ? words.day(row.deposited) : '',
      echeance: row.due ? words.day(row.due) : ''
    }))
  }
}

/** The template the plugin ships: the one a reader starts from, in their language. */
export function defaultDeliveryTemplate(words: DeliveryWords, english = false): string {
  const f = (field: DeliveryField): string => `{{${english ? ENGLISH_FIELDS[field] : field}}}`
  const names = (fields: readonly DeliveryField[]): string => fields.map(f).join(' ')
  const space = '<br><br><br><br>'
  return [
    '%%',
    ...words.help,
    '',
    names(NOTE_FIELDS),
    names(ROW_FIELDS),
    '%%',
    '',
    `# ${words.title}`,
    '',
    `*${words.numberDate(f('numero'), f('date'))}*`,
    '',
    `### ${words.project} ${f('projet')}`,
    '',
    `${words.sender} ${f('expediteur')}`,
    `${words.recipient} ${f('destinataire')}`,
    '',
    `> ${f('remarque')}`,
    '',
    `| ${words.reference} | ${words.documentTitle} | ${words.state} | ${words.version} |`,
    '| --- | --- | --- | --- |',
    `| ${f('reference')} | ${f('titre')} | ${f('etat')} | ${f('version')} |`,
    '',
    `*${words.countLabel} ${f('nombre')}*`,
    '',
    `## ${words.signatures}`,
    '',
    `| ${words.sentBy} | ${words.receivedBy} |`,
    '| --- | --- |',
    `| ${words.signHere}${space} | ${words.signHere}${space} |`,
    ''
  ].join('\n')
}

/** A value made safe for where it goes: no pipe nor line break in a table, no mark taken for emphasis. */
function written(value: string, inTable: boolean, prefix: string): string {
  const escaped = value.replace(/([\\*_`[\]|])/g, '\\$1')
  return inTable ? escaped.replace(/\s*\n\s*/g, '<br>') : escaped.replace(/\n/g, `\n${prefix}`)
}

/**
 * The template filled in: each line naming a document's field written once for each
 * document, the note's fields put in, and a line left with nothing but its marks — a
 * quote with no remark — taken out. A name between braces that is no field is left as
 * it is, for the reader to see it.
 */
export function fillDeliveryTemplate(template: string, values: DeliveryValues): string {
  const out: string[] = []
  for (const line of noteBody(template).split('\n')) {
    const fields = [...line.matchAll(PLACEHOLDER)].map((match) => fieldOf(match[1]))
    if (!fields.length) {
      out.push(line)
      continue
    }
    const inTable = line.trim().startsWith('|')
    const prefix = /^\s*(>\s*)*/.exec(line)?.[0] ?? ''
    const perRow = fields.some((field) => field && isRowField(field))
    const fill = (row: Record<string, string> | null): void => {
      let empty = true
      const filled = line.replace(PLACEHOLDER, (whole, name: string) => {
        const field = fieldOf(name)
        if (!field) return whole
        const value = (isRowField(field) ? row?.[field] : values.note[field]) ?? ''
        if (value.trim()) empty = false
        return written(value || (inTable && isRowField(field) ? '—' : ''), inTable, prefix)
      })
      // A line whose fields all came empty, and that holds nothing else but marks.
      if (empty && !inTable && !/[\p{L}\p{N}]/u.test(filled)) return
      out.push(filled)
    }
    if (perRow) for (const row of values.rows) fill(row)
    else fill(null)
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The delivery note as a document, from its filled template: what Word and PDF are made from alike. */
export function deliveryDocument(filled: string, context: DeliveryContext, words: DeliveryWords): DocxDocument {
  return { title: `${words.title} ${context.number} — ${context.project}`, blocks: markdownBlocks(filled) }
}

/** The delivery note kept beside the project: its properties, its filled template, and its Word and PDF. */
export function deliveryNote(
  filled: string,
  context: DeliveryContext & { isoDate: string },
  count: number,
  files: string[]
): string {
  const properties = {
    type: 'delivery-note',
    number: context.number,
    project: context.project,
    date: context.isoDate,
    recipient: context.recipient,
    documents: count
  }
  const lines = ['---', stringifyYaml(properties).trimEnd(), '---', '', filled, '']
  if (files.length) lines.push(files.map((path) => `[[${path}]]`).join(' · '), '')
  return lines.join('\n')
}
