import type { DependencyType } from '../../types'
import { fold } from '../library/libraryDoc'
import { parseAmount } from '../YamlHydrator'
import type { XlsxReadSheet } from '../xlsxRead'
import type { Plan, PlanLine, PlanLink } from './plan'

/**
 * Reading a planning kept in a spreadsheet — one exported from MS Project, or made by
 * hand: a line per task under a header row whose columns are found by their names, in
 * French or English. Only the name is needed; the rest is read when it is there: the
 * line's number, its level in the outline (or its WBS code, or its indentation), its
 * start and finish, its predecessors as MS Project writes them (« 3;5FD+2 j »), its
 * progress, its resources, whether it is a milestone.
 */

type Column =
  | 'id'
  | 'name'
  | 'level'
  | 'wbs'
  | 'start'
  | 'finish'
  | 'duration'
  | 'predecessors'
  | 'progress'
  | 'people'
  | 'milestone'
  | 'notes'

const HEADERS: Record<Column, string[]> = {
  id: ['id', 'n', 'no', 'num', 'numero', 'n°', 'ligne'],
  name: [
    'nom',
    'nom de la tache',
    'tache',
    'taches',
    'libelle',
    'designation',
    'intitule',
    'task name',
    'name',
    'task',
    'activite',
    'activity'
  ],
  level: ['niveau hierarchique', 'niveau', 'outline level', 'level'],
  wbs: ['wbs', 'edt', 'n hierarchique', 'numero hierarchique', 'outline number', 'code'],
  start: ['debut', 'date de debut', 'start', 'start date', 'date debut'],
  finish: ['fin', 'date de fin', 'finish', 'end', 'end date', 'echeance', 'date fin', 'due'],
  duration: ['duree', 'duration'],
  predecessors: ['predecesseurs', 'predecessors', 'antecedents', 'depend de', 'dependances'],
  progress: ['% acheve', 'pourcentage acheve', '% complete', 'percent complete', 'avancement', 'progress', '%'],
  people: [
    'noms ressources',
    'ressources',
    'resource names',
    'resources',
    'responsable',
    'assigne a',
    'assigned to',
    'qui'
  ],
  milestone: ['jalon', 'milestone'],
  notes: ['notes', 'remarques', 'commentaire', 'commentaires', 'comments']
}

const key = (header: string): string => fold(header).replace(/[_.:]/g, ' ').replace(/\s+/g, ' ').trim()

/** The column each wanted field is in, from the first row that names a task column. */
function findHeader(rows: string[][]): { at: number; columns: Partial<Record<Column, number>> } | null {
  for (let at = 0; at < Math.min(rows.length, 15); at++) {
    const columns: Partial<Record<Column, number>> = {}
    rows[at].forEach((cell, index) => {
      const name = key(cell)
      for (const [column, words] of Object.entries(HEADERS) as [Column, string[]][]) {
        if (columns[column] === undefined && words.includes(name)) columns[column] = index
      }
    })
    if (columns.name !== undefined) return { at, columns }
  }
  return null
}

const MONTHS: Record<string, number> = {
  janv: 1,
  jan: 1,
  fevr: 2,
  fev: 2,
  feb: 2,
  mars: 3,
  mar: 3,
  avr: 4,
  apr: 4,
  mai: 5,
  may: 5,
  juin: 6,
  jun: 6,
  juil: 7,
  jul: 7,
  aout: 8,
  aug: 8,
  sept: 9,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

/**
 * A date as a sheet shows it: ISO, as Excel's own dates are read, « 05/10/2026 », « lun.
 * 05/10/26 » as MS Project exports it, « 5 oct. 2026 ». Day before month, as written in
 * French — unless the first number cannot be a month's day. '' when it is none.
 */
export function readSheetDate(raw: string): string {
  const value = fold(raw).trim()
  if (!value) return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const pad = (n: number): string => String(n).padStart(2, '0')
  const year = (y: number): number => (y < 100 ? 2000 + y : y)
  const numeric = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(value)
  if (numeric) {
    let [day, month] = [Number(numeric[1]), Number(numeric[2])]
    if (month > 12 && day <= 12) [day, month] = [month, day]
    if (month < 1 || month > 12 || day < 1 || day > 31) return ''
    return `${year(Number(numeric[3]))}-${pad(month)}-${pad(day)}`
  }
  const words = /(\d{1,2})\s+([a-z]+)\.?\s+(\d{2,4})/.exec(value)
  if (words) {
    const month = MONTHS[words[2]] ?? MONTHS[words[2].slice(0, 4)] ?? MONTHS[words[2].slice(0, 3)]
    if (month) return `${year(Number(words[3]))}-${pad(month)}-${pad(Number(words[1]))}`
  }
  return ''
}

const LINK_WORDS: Record<string, DependencyType> = {
  FS: 'FS',
  FD: 'FS',
  SS: 'SS',
  DD: 'SS',
  FF: 'FF',
  SF: 'SF',
  DF: 'SF'
}

/** Predecessors as MS Project writes them: « 3 », « 3;5 », « 4FD+2 j », « 7DD-1j », « 2FS+3 days ». */
export function readPredecessors(raw: string): PlanLink[] {
  return raw
    .split(/[;,]/)
    .map((part) => part.trim().toUpperCase())
    .flatMap((part): PlanLink[] => {
      const found = /^(\d+)\s*(FS|FD|SS|DD|FF|SF|DF)?\s*(?:([+-])\s*(\d+(?:[.,]\d+)?))?/.exec(part)
      if (!found) return []
      const lag = found[4] ? Number(found[4].replace(',', '.')) * (found[3] === '-' ? -1 : 1) : 0
      // A lag in weeks, as « +1 sem » or « +1w », is five working days.
      const weeks = /\d\s*(SEM|W|WK|WEEK)/.test(part)
      return [{ key: found[1], type: LINK_WORDS[found[2] ?? 'FS'] ?? 'FS', lag: Math.round(weeks ? lag * 5 : lag) }]
    })
}

const yes = (raw: string): boolean => ['oui', 'yes', 'y', 'o', 'x', '1', 'vrai', 'true'].includes(key(raw))

/** The planning in the first sheet that has a task column; null when none does. */
export function readPlanningSheet(sheets: XlsxReadSheet[], fileName: string): Plan | null {
  for (const sheet of sheets) {
    const header = findHeader(sheet.rows)
    if (!header) continue
    const { columns } = header
    const cell = (row: string[], column: Column): string => {
      const index = columns[column]
      return index === undefined ? '' : (row[index] ?? '').trim()
    }
    const lines: PlanLine[] = []
    const warnings: string[] = []
    sheet.rows.slice(header.at + 1).forEach((row, at) => {
      const raw = row[columns.name ?? 0] ?? ''
      const title = raw.trim()
      if (!title) return
      // The level: its column, else the depth of its WBS code, else its indentation.
      const wbs = cell(row, 'wbs')
      const level =
        Number(cell(row, 'level')) ||
        (/^\d+(\.\d+)*$/.test(wbs) ? wbs.split('.').length : 0) ||
        1 + Math.floor((raw.length - raw.trimStart().length) / 2)
      const start = readSheetDate(cell(row, 'start'))
      const due = readSheetDate(cell(row, 'finish'))
      if (cell(row, 'start') && !start) warnings.push(`${title}: ${cell(row, 'start')}`)
      if (cell(row, 'finish') && !due) warnings.push(`${title}: ${cell(row, 'finish')}`)
      const duration = cell(row, 'duration')
      const milestone = cell(row, 'milestone') ? yes(cell(row, 'milestone')) : /^0+([.,]0+)?\s*\D*$/.test(duration)
      lines.push({
        key: cell(row, 'id') || String(at + 1),
        title,
        level,
        start,
        due,
        milestone,
        progress: parseAmount(cell(row, 'progress').replace('%', '')) ?? 0,
        people: cell(row, 'people')
          .split(/[;,]/)
          .map((name) => name.replace(/\[.*?\]/g, '').trim())
          .filter(Boolean),
        notes: cell(row, 'notes'),
        links: readPredecessors(cell(row, 'predecessors'))
      })
    })
    // A progress written as a share, 0.4, is 40 %.
    if (lines.length && lines.every((line) => line.progress <= 1)) for (const line of lines) line.progress *= 100
    const keys = new Set(lines.map((line) => line.key))
    for (const line of lines) {
      const missing = line.links.filter((link) => !keys.has(link.key))
      if (missing.length) warnings.push(`${line.title}: ${missing.map((link) => link.key).join(', ')}`)
    }
    return { name: fileName.replace(/\.[^.]+$/, ''), lines, warnings }
  }
  return null
}
