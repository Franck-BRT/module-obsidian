import { normalizeAlias } from './reqAlias'
import {
  REQ_LINK_KINDS,
  VERIFICATION_METHODS,
  type ReqLinkKind,
  type Requirement,
  type VerificationMethod
} from './Requirement'

/**
 * Requirements in and out as a table.
 *
 * The format everyone can open, which is the whole reason to support it: a supplier who
 * will not install a plugin, a customer who works in Excel, a review that happens in a
 * spreadsheet because that is where the review has always happened. Written by hand
 * rather than with a library — the plugin carries no runtime dependencies, and what is
 * needed is a quoting rule and a state machine.
 */

/* ---- Writing -------------------------------------------------------------- */

/**
 * One field, quoted only when it has to be.
 *
 * A quote that is not needed is not wrong, but a file full of them is one nobody can read
 * in a text editor, and being readable outside a spreadsheet is half of why this format
 * is worth having.
 */
export function csvField(value: string, separator: string): string {
  if (value === '') return ''
  const needsQuotes = value.includes(separator) || value.includes('"') || /[\r\n]/.test(value)
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value
}

export function csvRow(values: string[], separator: string): string {
  return values.map((value) => csvField(value, separator)).join(separator)
}

/** The columns a requirement occupies, in a fixed order, plus one per language. */
export const CSV_COLUMNS = [
  'id',
  'title',
  'category',
  'type',
  'status',
  'criticality',
  'verification',
  'source',
  'rationale',
  'owner',
  'tags',
  'aliases',
  'sourceLang',
  'rev',
  'links'
] as const

export function csvLanguages(requirements: Requirement[]): string[] {
  const langs = new Set<string>()
  for (const requirement of requirements) {
    langs.add(requirement.sourceLang)
    for (const lang of Object.keys(requirement.text)) langs.add(lang)
  }
  return [...langs].sort((a, b) => a.localeCompare(b))
}

function linksField(requirement: Requirement): string {
  return requirement.links.map((link) => `${link.kind}:${link.to}`).join('; ')
}

/**
 * The whole library as one table.
 *
 * A semicolon by default, because the spreadsheets this will be opened in are set to a
 * French locale where a comma is a decimal separator — and a requirement that reads
 * "moins de 3,5 s" split across two columns is the kind of failure nobody notices until
 * the supplier quotes it back.
 */
export function toCsv(requirements: Requirement[], separator = ';'): string {
  const langs = csvLanguages(requirements)
  const header = [...CSV_COLUMNS, ...langs.map((lang) => `text.${lang}`)]
  const lines = [csvRow(header, separator)]
  for (const requirement of requirements) {
    lines.push(
      csvRow(
        [
          requirement.id,
          requirement.title,
          requirement.category,
          requirement.type,
          requirement.status,
          requirement.criticality,
          requirement.verification,
          requirement.source,
          requirement.rationale,
          requirement.owner,
          requirement.tags.join('; '),
          requirement.aliases.join('; '),
          requirement.sourceLang,
          String(requirement.rev),
          linksField(requirement),
          ...langs.map((lang) => requirement.text[lang]?.body ?? '')
        ],
        separator
      )
    )
  }
  // A trailing newline, because a file without one is a file some tools silently truncate.
  return `${lines.join('\r\n')}\r\n`
}

/* ---- Reading -------------------------------------------------------------- */

/**
 * Which character separates the columns.
 *
 * Guessed from the header rather than demanded of the reader: the same library exported
 * by a French Excel and an English one differ in exactly this, and asking somebody to
 * know which one they have is asking them to open the file in a text editor first.
 */
export function detectSeparator(text: string): string {
  const header = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/))
  const counts = [';', ',', '\t'].map((candidate) => ({
    candidate,
    // Counted outside quotes, or a single field holding "a, b, c" decides the whole file.
    count: countOutsideQuotes(header, candidate)
  }))
  counts.sort((a, b) => b.count - a.count)
  return counts[0].count > 0 ? counts[0].candidate : ';'
}

function countOutsideQuotes(line: string, character: string): number {
  let inQuotes = false
  let count = 0
  for (const at of line) {
    if (at === '"') inQuotes = !inQuotes
    else if (!inQuotes && at === character) count += 1
  }
  return count
}

/**
 * The rows of a CSV, quotes and embedded newlines and all.
 *
 * A state machine rather than a split, because a requirement is prose: it contains the
 * separator, it contains quotation marks, and it contains line breaks, and every one of
 * those breaks a naive reader in a way that silently truncates a requirement rather than
 * failing.
 */
export function parseCsv(text: string, separator = detectSeparator(text)): string[][] {
  // A byte-order mark leads the first header, which then matches no column name at all.
  // Compared by code point: written as an escape, the formatter turns it into the
  // character itself, and an invisible one in the source is a defect waiting to happen.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < body.length; i++) {
    const at = body[i]
    if (inQuotes) {
      if (at !== '"') {
        field += at
        continue
      }
      if (body[i + 1] === '"') {
        field += '"'
        i += 1
        continue
      }
      inQuotes = false
      continue
    }
    if (at === '"') {
      inQuotes = true
      continue
    }
    if (at === separator) {
      row.push(field)
      field = ''
      continue
    }
    if (at === '\r') continue
    if (at === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += at
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  // A row of nothing but empty fields is a blank line a spreadsheet left behind.
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''))
}

export interface CsvTable {
  headers: string[]
  rows: Record<string, string>[]
  /** Columns the reader does not know, named so an import can say what it ignored. */
  unknown: string[]
}

const KNOWN = new Set<string>(CSV_COLUMNS)

export function readCsvTable(text: string): CsvTable {
  const separator = detectSeparator(text)
  const [header, ...body] = parseCsv(text, separator)
  if (!header) return { headers: [], rows: [], unknown: [] }
  const headers = header.map((name) => name.trim())
  const rows = body.map((values) =>
    Object.fromEntries(headers.map((name, index) => [name, (values[index] ?? '').trim()]))
  )
  const unknown = headers.filter((name) => name !== '' && !KNOWN.has(name) && !name.startsWith('text.'))
  return { headers, rows, unknown }
}

/* ---- What an import would do ----------------------------------------------- */

export type CsvAction = 'create' | 'update' | 'unchanged' | 'invalid'

export interface CsvPlanRow {
  action: CsvAction
  /** Empty on a row carrying no identifier: one will be minted when it is written. */
  id: string
  title: string
  /** The fields the row carries, ready to apply. Absent fields are left as they were. */
  values: CsvValues
  /** Why a row cannot be used. */
  reason?: 'no-wording' | 'duplicate-id'
}

export interface CsvValues {
  title?: string
  category?: string
  type?: string
  status?: string
  criticality?: string
  verification?: VerificationMethod
  source?: string
  rationale?: string
  owner?: string
  tags?: string[]
  aliases?: string[]
  sourceLang?: string
  text: Record<string, string>
  links?: { kind: ReqLinkKind; to: string }[]
}

function splitList(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')
}

function readLinks(raw: string): { kind: ReqLinkKind; to: string }[] {
  const out: { kind: ReqLinkKind; to: string }[] = []
  for (const piece of raw.split(/[;\n]/)) {
    const at = piece.indexOf(':')
    if (at === -1) continue
    const kind = piece.slice(0, at).trim()
    const to = piece.slice(at + 1).trim()
    if (to && REQ_LINK_KINDS.includes(kind as ReqLinkKind)) out.push({ kind: kind as ReqLinkKind, to })
  }
  return out
}

function valuesOf(row: Record<string, string>): CsvValues {
  const values: CsvValues = { text: {} }
  for (const [key, raw] of Object.entries(row)) {
    if (!key.startsWith('text.')) continue
    const lang = key.slice('text.'.length).trim().toLowerCase()
    if (lang && raw) values.text[lang] = raw
  }
  const set = <K extends keyof CsvValues>(key: K, value: CsvValues[K]): void => {
    if (value !== undefined && value !== '') values[key] = value
  }
  set('title', row.title)
  set('category', row.category)
  set('type', row.type)
  set('status', row.status)
  set('criticality', row.criticality)
  set('source', row.source)
  set('rationale', row.rationale)
  set('owner', row.owner)
  if (row.sourceLang) values.sourceLang = row.sourceLang.toLowerCase()
  if (row.tags) values.tags = splitList(row.tags)
  if (row.aliases) values.aliases = splitList(row.aliases).map((alias) => normalizeAlias(alias))
  if (row.links) values.links = readLinks(row.links)
  if (row.verification && VERIFICATION_METHODS.includes(row.verification as VerificationMethod)) {
    values.verification = row.verification as VerificationMethod
  }
  return values
}

/** Whether applying these values would change anything the requirement already says. */
function wouldChange(values: CsvValues, requirement: Requirement): boolean {
  for (const [lang, body] of Object.entries(values.text)) {
    if ((requirement.text[lang]?.body ?? '') !== body) return true
  }
  const scalars: (keyof CsvValues & keyof Requirement)[] = [
    'title',
    'category',
    'type',
    'status',
    'criticality',
    'verification',
    'source',
    'rationale',
    'owner',
    'sourceLang'
  ]
  for (const key of scalars) {
    const incoming = values[key]
    if (typeof incoming === 'string' && incoming !== requirement[key]) return true
  }
  if (values.tags && values.tags.join('|') !== requirement.tags.join('|')) return true
  if (values.aliases && values.aliases.join('|') !== requirement.aliases.join('|')) return true
  if (values.links) {
    const held = new Set(requirement.links.map((link) => `${link.kind}:${link.to.toUpperCase()}`))
    if (values.links.some((link) => !held.has(`${link.kind}:${link.to.toUpperCase()}`))) return true
  }
  return false
}

/**
 * What an import would do, before it does any of it.
 *
 * Every import of anything is a moment where a file nobody has read overwrites work
 * somebody did, so this answers "what would change" as a list a person can look at and
 * refuse. Nothing here writes.
 *
 * An identifier the file carries is kept, never re-minted: importing a supplier's
 * requirements and renumbering them would break every reference in their documents,
 * which is the one thing an identifier exists to prevent.
 */
export function planCsvImport(rows: Record<string, string>[], library: Requirement[]): CsvPlanRow[] {
  // Every name a requirement answers to, identifiers first: a file written in a project's
  // own numbering updates the requirement it names rather than creating a twin under the
  // alias — which would then collide with the alias it was named by.
  const byName = new Map<string, Requirement>()
  for (const requirement of library) byName.set(requirement.id.toUpperCase(), requirement)
  for (const requirement of library) {
    for (const alias of requirement.aliases) {
      if (!byName.has(alias.toUpperCase())) byName.set(alias.toUpperCase(), requirement)
    }
  }
  const seen = new Set<string>()
  return rows.map((row) => {
    const named = (row.id ?? '').trim()
    const values = valuesOf(row)
    const title = values.title ?? ''
    const existing = named ? byName.get(named.toUpperCase()) : undefined
    const id = existing?.id ?? named

    // A row with no words in it is a row that would create a requirement saying nothing.
    if (Object.keys(values.text).length === 0 && !title) {
      return { action: 'invalid', id, title, values, reason: 'no-wording' }
    }
    if (id && seen.has(id.toUpperCase())) {
      return { action: 'invalid', id, title, values, reason: 'duplicate-id' }
    }
    if (id) seen.add(id.toUpperCase())

    if (!existing) {
      // Written in one language and not saying which is its source: that one is. Left to
      // the default, an English row would become a French requirement with no French.
      const langs = Object.keys(values.text)
      const created =
        values.sourceLang === undefined && langs.length === 1 ? { ...values, sourceLang: langs[0] } : values
      return { action: 'create', id, title, values: created }
    }
    return { action: wouldChange(values, existing) ? 'update' : 'unchanged', id, title, values }
  })
}

export function countPlan(plan: CsvPlanRow[]): Record<CsvAction, number> {
  const counts = { create: 0, update: 0, unchanged: 0, invalid: 0 }
  for (const row of plan) counts[row.action] += 1
  return counts
}
