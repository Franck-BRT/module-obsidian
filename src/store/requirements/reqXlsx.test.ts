import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from './Requirement'
import { addAlias } from './reqAlias'
import { coverageOf } from './ReqCoverage'
import { libraryWorkbook, requirementsSheet, traceSheet, type XlsxWords } from './reqXlsx'

const words: XlsxWords = {
  columns: {
    id: 'Identifiant',
    title: 'Titre',
    category: 'Catégorie',
    type: 'Type',
    status: 'Statut',
    criticality: 'Criticité',
    verification: 'Vérification',
    source: 'Origine',
    rationale: 'Justification',
    owner: 'Responsable',
    tags: 'Étiquettes',
    aliases: 'Alias',
    sourceLang: 'Langue',
    rev: 'Rév.',
    links: 'Liens',
    rating: 'Note',
    citedIn: 'Cité dans',
    satisfiedBy: 'Satisfaite par',
    derivedBy: 'Dérivée en',
    gaps: 'Manques'
  },
  sheet: { requirements: 'Exigences', trace: 'Traçabilité' },
  glyph: (requirement, field) => (field === 'status' ? 'Approuvée' : requirement[field]),
  gap: (gap) => gap.toUpperCase(),
  note: (path) => path.split('/').pop() ?? path
}

const library = [
  addAlias(
    setText(
      makeRequirement({
        id: 'REQ-THERM-0001',
        title: 'Soute',
        category: 'THERM',
        type: 'performance',
        status: 'approved',
        verification: 'test',
        tags: ['soute', 'thermique'],
        links: [{ kind: 'derives-from', to: 'REQ-SYS-0001', suspect: true }]
      }),
      'fr',
      'Le système doit maintenir la soute entre 5 °C et 30 °C pendant tout le vol.',
      'franck'
    ),
    'OMLX-THERM-0001'
  )
]

describe('the requirements sheet', () => {
  const sheet = requirementsSheet(library, ['fr', 'en'], words)
  const row = sheet.rows[0]

  it('heads a column with every language the library is written in', () => {
    expect(sheet.columns.map((column) => column.label)).toContain('FR')
    expect(sheet.columns.map((column) => column.label)).toContain('EN')
  })

  // A rating written "4/5" sorts as text and puts 10 between 1 and 2.
  it('writes the rating as a number so the column sorts', () => {
    const at = sheet.columns.findIndex((column) => column.label === 'Note')
    expect(typeof row[at]).toBe('number')
  })

  it('shows a field as the reader sees it, not as it is stored', () => {
    const at = sheet.columns.findIndex((column) => column.label === 'Statut')
    expect(row[at]).toBe('Approuvée')
  })

  it('carries the other names the requirement answers to', () => {
    const at = sheet.columns.findIndex((column) => column.label === 'Alias')
    expect(row[at]).toBe('OMLX-THERM-0001')
  })

  // A link the far end moved under is the one thing in that cell worth reading.
  it('marks a suspect link in the cell rather than beside it', () => {
    const at = sheet.columns.findIndex((column) => column.label === 'Liens')
    expect(row[at]).toBe('derives-from: REQ-SYS-0001 (?)')
  })

  it('wraps the prose columns and leaves the short ones alone', () => {
    const wrapped = sheet.columns.filter((column) => column.wrap).map((column) => column.label)
    expect(wrapped).toContain('FR')
    expect(wrapped).not.toContain('Identifiant')
  })
})

describe('the traceability sheet', () => {
  it('says what covers what, and names the holes in the reader’s words', () => {
    const coverage = coverageOf({ library, usage: new Map(), languages: ['fr'] })
    const sheet = traceSheet(coverage, words)
    expect(sheet.name).toBe('Traçabilité')
    expect(sheet.rows[0][0]).toBe('REQ-THERM-0001')
    expect(String(sheet.rows[0][5])).toContain('UNCITED')
  })
})

describe('the workbook', () => {
  // Two questions asked by different people on different days.
  it('is the library and its holes, in that order', () => {
    const sheets = libraryWorkbook(library, coverageOf({ library, usage: new Map(), languages: ['fr'] }), words)
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Exigences', 'Traçabilité'])
  })
})
