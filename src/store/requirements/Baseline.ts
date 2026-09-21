import { makeId } from '../../types'
import type { Requirement } from './Requirement'
import { diffWords, isMeaningfulDiff, type DiffPart } from './reqDiff'

/**
 * The library as it stood on a day somebody signed for it.
 *
 * A requirement moves; a review does not. "What did we agree to at the preliminary design
 * review" is a question the live library cannot answer, and it is the question every
 * argument six months later turns on. So a baseline is a copy — of the words, not of a
 * reference to the words — because a copy that points back at the library would say
 * whatever the library says today, which is precisely what is in dispute.
 *
 * It is written into the body of a note rather than its frontmatter. Five hundred
 * requirements in two languages is two hundred kilobytes of YAML that Obsidian would
 * reparse on every keystroke in that note; as a body it is a document somebody can read,
 * and one git shows a sensible diff of.
 */

export const BASELINE_FRONTMATTER_KEY = 'pm-req-baseline'

export const BASELINE_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  BASELINE_FRONTMATTER_KEY,
  'id',
  'name',
  'at',
  'by',
  'scope',
  'note',
  'count'
])

export interface BaselineEntry {
  id: string
  rev: number
  status: string
  title: string
  /** The wording as it stood, per language. Copied, never referenced. */
  text: Record<string, string>
}

export interface Baseline {
  id: string
  name: string
  at: string
  by: string
  /** How the set was chosen, in words, so the choice can be read back years later. */
  scope: string
  note: string
  entries: BaselineEntry[]
  filePath?: string
}

export function entryOf(requirement: Requirement): BaselineEntry {
  return {
    id: requirement.id,
    rev: requirement.rev,
    status: requirement.status,
    title: requirement.title,
    text: Object.fromEntries(Object.entries(requirement.text).map(([lang, held]) => [lang, held.body]))
  }
}

export function makeBaseline(
  name: string,
  requirements: Requirement[],
  over: Partial<Omit<Baseline, 'entries'>> = {}
): Baseline {
  return {
    id: `base-${makeId().slice(0, 8)}`,
    name,
    at: new Date().toISOString(),
    by: '',
    scope: '',
    note: '',
    ...over,
    // Sorted, so two baselines of the same set are the same document and git has nothing
    // to show between them but what actually changed.
    entries: [...requirements]
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .map((requirement) => entryOf(requirement))
  }
}

/* ---- The note ------------------------------------------------------------- */

const HEADING = /^## (\S+)(?: — (.*))?$/
const META = /^rev (\d+)(?: · (.*))?$/
const LANGUAGE = /^### (\S+)$/

/**
 * Every wording line is quoted.
 *
 * Which is what makes the format safe rather than merely tidy: a requirement whose text
 * contains a line reading `### EN` would otherwise end the wording it is part of. Quoted,
 * it is `> ### EN` and cannot be mistaken for anything. It also renders as what it is —
 * a quotation from somewhere else.
 */
function quote(body: string): string[] {
  return body.split('\n').map((line) => (line === '' ? '>' : `> ${line}`))
}

function orderedLanguages(entry: BaselineEntry): string[] {
  return Object.keys(entry.text).sort((a, b) => a.localeCompare(b))
}

export function serializeBaselineBody(baseline: Baseline): string {
  const lines: string[] = [`# ${baseline.name}`, '']
  if (baseline.note.trim()) lines.push(baseline.note.trim(), '')
  for (const entry of baseline.entries) {
    lines.push(entry.title ? `## ${entry.id} — ${entry.title}` : `## ${entry.id}`)
    lines.push(entry.status ? `rev ${entry.rev} · ${entry.status}` : `rev ${entry.rev}`)
    for (const lang of orderedLanguages(entry)) {
      lines.push('', `### ${lang.toUpperCase()}`, ...quote(entry.text[lang]))
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Reads the entries back out of the body.
 *
 * Forgiving about everything the format does not depend on — blank lines, prose the
 * reader added between entries — and exact about the four shapes it does: the heading,
 * the revision line, the language heading and the quoted wording.
 */
export function parseBaselineBody(body: string): BaselineEntry[] {
  const entries: BaselineEntry[] = []
  let current: BaselineEntry | null = null
  let lang = ''
  let buffer: string[] = []

  const flush = (): void => {
    if (current && lang) current.text[lang] = buffer.join('\n').replace(/\n+$/, '')
    lang = ''
    buffer = []
  }

  for (const line of body.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      if (current) entries.push(current)
      current = { id: heading[1], rev: 1, status: '', title: heading[2] ?? '', text: {} }
      continue
    }
    if (!current) continue

    const meta = !lang && META.exec(line)
    if (meta) {
      current.rev = Number(meta[1])
      current.status = meta[2] ?? ''
      continue
    }
    const language = LANGUAGE.exec(line)
    if (language) {
      flush()
      lang = language[1].toLowerCase()
      continue
    }
    if (lang && line.startsWith('>')) buffer.push(line.replace(/^> ?/, ''))
  }
  flush()
  if (current) entries.push(current)
  return entries
}

export function baselineFrontmatter(baseline: Baseline): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    [BASELINE_FRONTMATTER_KEY]: true,
    id: baseline.id,
    name: baseline.name,
    at: baseline.at,
    count: baseline.entries.length
  }
  if (baseline.by) fm.by = baseline.by
  if (baseline.scope) fm.scope = baseline.scope
  if (baseline.note) fm.note = baseline.note
  return fm
}

function str(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw : fallback
}

export function hydrateBaseline(frontmatter: Record<string, unknown>, body: string, filePath: string): Baseline | null {
  if (frontmatter[BASELINE_FRONTMATTER_KEY] !== true) return null
  return {
    id: str(frontmatter.id, filePath),
    name: str(frontmatter.name, filePath.slice(filePath.lastIndexOf('/') + 1).replace(/\.md$/, '')),
    at: str(frontmatter.at),
    by: str(frontmatter.by),
    scope: str(frontmatter.scope),
    note: str(frontmatter.note),
    entries: parseBaselineBody(body),
    filePath
  }
}

/* ---- Comparison ------------------------------------------------------------ */

export type BaselineChangeKind = 'added' | 'removed' | 'changed' | 'unchanged'

export interface BaselineFieldChange {
  field: 'status' | 'title'
  was: string
  now: string
}

export interface BaselineChange {
  kind: BaselineChangeKind
  id: string
  was: BaselineEntry | null
  now: Requirement | null
  /** Only the languages whose words actually moved. */
  wordings: { lang: string; diff: DiffPart[] }[]
  fields: BaselineFieldChange[]
}

/**
 * What the library has done since the baseline was taken.
 *
 * The revision number is not consulted. It is a good signal and a bad proof: a wording
 * restored by hand to what it said sits at a higher revision saying the same thing, and
 * an import can carry any number at all. The words are compared.
 */
export function compareToBaseline(baseline: Baseline, library: Requirement[]): BaselineChange[] {
  const now = new Map(library.map((requirement) => [requirement.id.toUpperCase(), requirement]))
  const changes: BaselineChange[] = []

  for (const was of baseline.entries) {
    const current = now.get(was.id.toUpperCase()) ?? null
    if (!current) {
      changes.push({ kind: 'removed', id: was.id, was, now: null, wordings: [], fields: [] })
      continue
    }
    const languages = [...new Set([...Object.keys(was.text), ...Object.keys(current.text)])].sort((a, b) =>
      a.localeCompare(b)
    )
    const wordings = languages
      .map((lang) => ({ lang, diff: diffWords(was.text[lang] ?? '', current.text[lang]?.body ?? '') }))
      .filter((entry) => isMeaningfulDiff(entry.diff))
    const fields: BaselineFieldChange[] = []
    if (was.status !== current.status) fields.push({ field: 'status', was: was.status, now: current.status })
    if (was.title !== current.title) fields.push({ field: 'title', was: was.title, now: current.title })

    changes.push({
      kind: wordings.length || fields.length ? 'changed' : 'unchanged',
      id: was.id,
      was,
      now: current,
      wordings,
      fields
    })
  }

  const held = new Set(baseline.entries.map((entry) => entry.id.toUpperCase()))
  for (const requirement of library) {
    if (held.has(requirement.id.toUpperCase())) continue
    changes.push({ kind: 'added', id: requirement.id, was: null, now: requirement, wordings: [], fields: [] })
  }

  return changes.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

export function countChanges(changes: BaselineChange[]): Record<BaselineChangeKind, number> {
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 }
  for (const change of changes) counts[change.kind] += 1
  return counts
}
