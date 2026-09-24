import { describe, expect, it } from 'vitest'
import { buildXlsx } from '../xlsx'
import { readXlsx } from '../xlsxRead'
import { coverageOf } from './ReqCoverage'
import { addLink, makeRequirement, setText, type Requirement } from './Requirement'
import { addAlias } from './reqAlias'
import { planCsvImport } from './reqCsv'
import { libraryWorkbook, type XlsxWords } from './reqXlsx'
import { xlsxTable, type XlsxVocabulary } from './reqXlsxRead'

/** The words an export in French would use, and the vocabulary that reads them back. */
const STATUS: Record<string, string> = { draft: 'Brouillon', approved: 'Approuvée' }
const TYPE: Record<string, string> = { functional: 'Fonctionnelle', performance: 'Performance' }
const CRITICALITY: Record<string, string> = { high: 'Haute', low: 'Basse' }
const VERIFICATION: Record<string, string> = { test: 'Essai', analysis: 'Analyse' }

const words: XlsxWords = {
  columns: {
    id: 'Identifiant',
    title: 'Titre',
    category: 'Catégorie',
    type: 'Type',
    status: 'Statut',
    criticality: 'Criticité',
    verification: 'Vérification',
    source: 'Source',
    rationale: 'Justification',
    owner: 'Responsable',
    tags: 'Étiquettes',
    aliases: 'Alias',
    sourceLang: 'Langue source',
    rev: 'Révision',
    links: 'Liens',
    rating: 'Note',
    citedIn: 'Cité dans',
    satisfiedBy: 'Satisfaite par',
    derivedBy: 'Dérivées',
    gaps: 'État'
  },
  sheet: { requirements: 'Bibliothèque', trace: 'Traçabilité' },
  glyph: (requirement, field) => {
    if (field === 'type') return TYPE[requirement.type] ?? requirement.type
    if (field === 'status') return STATUS[requirement.status] ?? requirement.status
    if (field === 'criticality') return CRITICALITY[requirement.criticality] ?? requirement.criticality
    return requirement.verification === 'none' ? '' : (VERIFICATION[requirement.verification] ?? '')
  },
  gap: (gap) => gap,
  note: (path) => path
}

const invert = (map: Record<string, string>) =>
  Object.fromEntries(Object.entries(map).map(([value, label]) => [label.toLowerCase(), value]))

const vocabulary: XlsxVocabulary = {
  headers: Object.fromEntries(
    Object.entries(words.columns)
      .filter(([key]) => !['rating', 'citedIn', 'satisfiedBy', 'derivedBy', 'gaps'].includes(key))
      .map(([key, label]) => [label.toLowerCase(), key])
  ),
  languages: ['fr', 'en'],
  computed: ['Note'],
  values: {
    type: invert(TYPE),
    status: invert(STATUS),
    criticality: invert(CRITICALITY),
    verification: invert(VERIFICATION)
  }
}

const library = (): Requirement[] => {
  let one = makeRequirement({
    id: 'REQ-THERM-0001',
    title: 'Maintien',
    category: 'THERM',
    type: 'performance',
    status: 'approved',
    criticality: 'high',
    verification: 'test',
    source: 'CDC §4',
    rationale: 'Les cartes décrochent au-delà.',
    owner: 'franck',
    tags: ['soute', 'hiver'],
    sourceLang: 'fr'
  })
  one = setText(one, 'fr', 'La soute doit rester entre 5 °C et 30 °C.\nEn toute saison.', 'franck')
  one = setText(one, 'en', 'The hold shall stay between 5 and 30 °C.\nIn every season.', 'sidonie')
  one = addAlias(one, 'OMLX-THERM-0001')
  let two = makeRequirement({ id: 'REQ-THERM-0002', title: 'Mesure', category: 'THERM', sourceLang: 'fr' })
  two = setText(two, 'fr', 'Le calculateur doit mesurer toutes les 10 s.', 'franck')
  two = addLink(two, 'derives-from', 'REQ-THERM-0001')
  // Suspect, so the export writes "(?)" after it.
  return [one, { ...two, links: two.links.map((link) => ({ ...link, suspect: true })) }]
}

const exported = async (requirements: Requirement[]) => {
  const coverage = coverageOf({ library: requirements, usage: new Map(), languages: ['fr', 'en'] })
  return readXlsx(buildXlsx(libraryWorkbook(requirements, coverage, words)))
}

describe('xlsxTable, on the plugin’s own export', () => {
  // The test that matters most: the library's own spreadsheet, read back, changes nothing.
  it('reads its own export back as a library with nothing to change', async () => {
    const held = library()
    const table = xlsxTable(await exported(held), vocabulary)!
    expect(table.sheet).toBe('Bibliothèque')
    expect(table.unknown).toEqual([])
    expect(table.unmatched).toEqual([])
    expect(planCsvImport(table.rows, held).map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'unchanged'],
      ['REQ-THERM-0002', 'unchanged']
    ])
  })

  it('reads every field back as the value behind the word on the badge', async () => {
    const table = xlsxTable(await exported(library()), vocabulary)!
    expect(table.rows[0]).toEqual({
      id: 'REQ-THERM-0001',
      title: 'Maintien',
      category: 'THERM',
      type: 'performance',
      status: 'approved',
      criticality: 'high',
      verification: 'test',
      source: 'CDC §4',
      rationale: 'Les cartes décrochent au-delà.',
      owner: 'franck',
      tags: 'soute, hiver',
      aliases: 'OMLX-THERM-0001',
      sourceLang: 'fr',
      rev: '1',
      'text.en': 'The hold shall stay between 5 and 30 °C.\nIn every season.',
      'text.fr': 'La soute doit rester entre 5 °C et 30 °C.\nEn toute saison.'
    })
  })

  // The "(?)" is the library's verdict on a link, not part of what it points at.
  it('reads a link marked as suspect as the link, not as a link to "REQ (?)"', async () => {
    const table = xlsxTable(await exported(library()), vocabulary)!
    expect(table.rows[1].links).toBe('derives-from: REQ-THERM-0001')
  })

  it('sees an edit made in the spreadsheet as a change', async () => {
    const held = library()
    const sheets = await exported(held)
    const row = sheets[0].rows[1]
    // The status typed as the badge's word, the English wording rewritten.
    row[sheets[0].rows[0].indexOf('Statut')] = 'Brouillon'
    row[sheets[0].rows[0].indexOf('EN')] = 'The hold shall stay between 5 and 28 °C.'
    const plan = planCsvImport(xlsxTable(sheets, vocabulary)!.rows, held)
    expect(plan.map((each) => each.action)).toEqual(['update', 'unchanged'])
    expect(plan[0].values).toMatchObject({ status: 'draft', text: { en: 'The hold shall stay between 5 and 28 °C.' } })
  })

  // Worked out from the library, so a number typed into it means nothing to write back.
  it('leaves the rating alone without calling it unknown', async () => {
    const table = xlsxTable(await exported(library()), vocabulary)!
    expect(table.headers).not.toContain('rating')
    expect(table.unknown).not.toContain('Note')
  })
})

describe('xlsxTable, on a sheet somebody laid out by hand', () => {
  const sheets = [
    { name: 'Couverture', rows: [['Revue fournisseur'], ['Version 3']] },
    {
      name: 'Exigences',
      rows: [
        ['Spécification SYS — revue du 12/09'],
        ['ID', 'title', 'Statut', 'Priorité client', 'text.fr'],
        ['SYS-12', 'Démarrage', 'approved', 'P1', 'Le système doit démarrer en 3 s.'],
        ['SYS-13', '', 'Approuvée', 'P2', 'Le système doit s’arrêter proprement.']
      ]
    }
  ]

  it('finds the table under a title, on whichever sheet holds it', () => {
    const table = xlsxTable(sheets, vocabulary)!
    expect(table.sheet).toBe('Exigences')
    expect(table.rows.map((row) => row.id)).toEqual(['SYS-12', 'SYS-13'])
  })

  it('reads the CSV’s own column names, and a stored value typed as itself', () => {
    const table = xlsxTable(sheets, vocabulary)!
    expect(table.rows.map((row) => row.status)).toEqual(['approved', 'approved'])
    expect(table.rows[0]['text.fr']).toBe('Le système doit démarrer en 3 s.')
  })

  // Named, so a reader who thinks their priorities came across knows they did not.
  it('names the columns it has no place for', () => {
    expect(xlsxTable(sheets, vocabulary)!.unknown).toEqual(['Priorité client'])
  })

  // A typo typed into Excel must not become a status nobody defined without anybody
  // being told.
  it('names a badge value that matches nothing the palettes hold', () => {
    const typo = [
      {
        name: 'S',
        rows: [
          ['id', 'Statut', 'text.fr'],
          ['SYS-1', 'Aprouvée', 'Texte.'],
          ['SYS-2', 'draft', 'Texte.']
        ]
      }
    ]
    const table = xlsxTable(typo, vocabulary)!
    expect(table.unmatched).toEqual(['Statut : Aprouvée'])
    expect(xlsxTable(sheets, vocabulary)!.unmatched).toEqual([])
  })

  it('finds nothing in a workbook with no requirements in it', () => {
    expect(xlsxTable([sheets[0]], vocabulary)).toBeNull()
  })
})
