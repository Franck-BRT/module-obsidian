import { describe, expect, it } from 'vitest'
import { buildPdf } from '../pdf'
import { readPdf } from '../pdfRead'
import { pdfBlocks } from '../pdfText'
import type { DocxReadBlock } from '../docxRead'
import { addLink, makeRequirement, setText, type Requirement } from './Requirement'
import { addAlias } from './reqAlias'
import { planCsvImport } from './reqCsv'
import { libraryDocx, noteDocx } from './reqDocx'
import {
  docxRequirements,
  settleLanguages,
  settleSpacing,
  startsRequirementRow,
  type DocxVocabulary
} from './reqDocxRead'
import type { ReqBlockField } from './reqBlockFields'

/** The words a French export uses, and the vocabulary that reads them back. */
const STATUS: Record<string, string> = { draft: 'Brouillon', approved: 'Approuvée' }
const TYPE: Record<string, string> = { functional: 'Fonctionnelle', performance: 'Performance' }
const CRITICALITY: Record<string, string> = { high: 'Haute', low: 'Basse' }
const VERIFICATION: Record<string, string> = { test: 'Essai', analysis: 'Analyse' }
const invert = (map: Record<string, string>) =>
  Object.fromEntries(Object.entries(map).map(([value, label]) => [label.toLowerCase(), value]))

const vocabulary: DocxVocabulary = {
  headers: { identifiant: 'id', titre: 'title', statut: 'status', type: 'type', criticité: 'criticality' },
  languages: ['fr', 'en'],
  computed: ['Note'],
  values: {
    type: invert(TYPE),
    status: invert(STATUS),
    criticality: invert(CRITICALITY),
    verification: invert(VERIFICATION)
  },
  sourceLabels: ['Origine', 'Source'],
  noCategory: ['Sans catégorie'],
  wording: ['Énoncé'],
  isMark: (line) => /^Affichée en [A-Z]+$|^Traductions en retard$|^Traduction automatique$/.test(line),
  fallbackLang: (line) => /^Affichée en ([A-Z]+)$/.exec(line)?.[1].toLowerCase()
}

const meta = (requirement: Requirement): string =>
  [
    STATUS[requirement.status],
    TYPE[requirement.type],
    CRITICALITY[requirement.criticality],
    VERIFICATION[requirement.verification]
  ]
    .filter(Boolean)
    .join(' · ')

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
    sourceLang: 'fr'
  })
  one = setText(one, 'fr', 'La soute doit rester entre 5 °C et 30 °C.\nEn toute saison.', 'franck')
  one = setText(one, 'en', 'The hold shall stay between 5 and 30 °C.', 'llm', 'machine')
  one = addAlias(one, 'OMLX-THERM-0001')
  let two = makeRequirement({
    id: 'REQ-THERM-0002',
    title: 'Mesure',
    category: 'THERM',
    status: 'draft',
    sourceLang: 'fr'
  })
  two = setText(two, 'fr', 'Le calculateur doit mesurer toutes les 10 s.', 'franck')
  two = addLink(two, 'derives-from', 'REQ-THERM-0001')
  // Written in English only: a French export shows it in English, in place of a French
  // wording nobody wrote.
  let three = makeRequirement({
    id: 'REQ-LOG-0001',
    title: 'Journal',
    category: 'LOG',
    status: 'draft',
    sourceLang: 'en'
  })
  three = setText(three, 'en', 'The computer shall log every reading.', 'franck')
  return [one, two, three]
}

const exportedLibrary = async (requirements: Requirement[]): Promise<DocxReadBlock[]> =>
  pdfBlocks(
    await readPdf(
      buildPdf(
        libraryDocx(requirements, {
          title: 'Bibliothèque',
          lang: 'fr',
          meta,
          sourceLabel: 'Origine',
          noCategory: 'Sans catégorie'
        })
      )
    ),
    { startsRow: startsRequirementRow(vocabulary) }
  )

const plan = (blocks: DocxReadBlock[], held: Requirement[]) =>
  planCsvImport(settleSpacing(settleLanguages(docxRequirements(blocks, vocabulary, 'fr').rows, held), held), held)

describe('reading requirements back out of the library’s own PDF', () => {
  it('reads it back as a library with nothing to change', async () => {
    const held = library()
    expect(plan(await exportedLibrary(held), held).map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'unchanged'],
      ['REQ-THERM-0002', 'unchanged'],
      ['REQ-LOG-0001', 'unchanged']
    ])
  })

  it('reads every field the export writes', async () => {
    const read = docxRequirements(await exportedLibrary(library()), vocabulary, 'fr')
    expect(read.rows[0]).toEqual({
      id: 'REQ-THERM-0001',
      title: 'Maintien',
      category: 'THERM',
      status: 'approved',
      type: 'performance',
      criticality: 'high',
      verification: 'test',
      'text.fr': 'La soute doit rester entre 5 °C et 30 °C.\nEn toute saison.',
      rationale: 'Les cartes décrochent au-delà.',
      source: 'CDC §4'
    })
  })

  // A wording longer than a line is wrapped by the layout; read back, the wrapping must
  // not show, or every long requirement would come home "changed".
  it('rejoins a wording the layout wrapped, and keeps the breaks the author wrote', async () => {
    const long =
      'Le calculateur doit enregistrer chaque relevé de température de soute avec son horodatage, ' +
      'sa source et son état de validité, pendant au moins trente jours glissants.\nLes relevés ' +
      'invalides sont conservés, marqués comme tels, et restitués sur demande de la maintenance.'
    const held = [setText(makeRequirement({ id: 'REQ-LOG-0009', category: 'LOG', sourceLang: 'fr' }), 'fr', long, 'a')]
    const read = docxRequirements(await exportedLibrary(held), vocabulary, 'fr')
    expect(read.rows[0]['text.fr']).toBe(long)
  })

  // "…de la maintenance." happens to end at the margin, so the break after it looks
  // exactly like the layout running out of room. Read alone, it cannot be told apart;
  // against the library, a wording that differs only there has not changed.
  it('takes a wording that differs only where a PDF cannot show it as unchanged', async () => {
    const long =
      'Le calculateur doit enregistrer chaque relevé de température de soute avec son horodatage, ' +
      'sa source et son état de validité, pendant au moins trente jours glissants, et les restituer ' +
      'sur demande de la maintenance.\nLes relevés invalides sont conservés, marqués comme tels.'
    const held = [setText(makeRequirement({ id: 'REQ-LOG-0009', category: 'LOG', sourceLang: 'fr' }), 'fr', long, 'a')]
    const blocks = await exportedLibrary(held)
    expect(docxRequirements(blocks, vocabulary, 'fr').rows[0]['text.fr']).not.toBe(long)
    expect(plan(blocks, held).map((row) => row.action)).toEqual(['unchanged'])
  })

  // Past a page, too: a library of forty requirements is several pages long.
  it('reads a library that runs over several pages', async () => {
    const held = Array.from({ length: 40 }, (_, at) =>
      setText(
        makeRequirement({
          id: `REQ-SYS-${String(at + 1).padStart(4, '0')}`,
          title: `Exigence ${at + 1}`,
          category: 'SYS',
          status: 'draft',
          sourceLang: 'fr'
        }),
        'fr',
        `Le système doit satisfaire la condition numéro ${at + 1}, qui est décrite ici assez longuement pour occuper plus d’une ligne de la page.`,
        'a'
      )
    )
    const rows = plan(await exportedLibrary(held), held)
    expect(rows).toHaveLength(40)
    expect(rows.every((row) => row.action === 'unchanged')).toBe(true)
  })
})

describe('reading requirements back out of a note’s PDF', () => {
  const words = {
    column: (field: ReqBlockField) =>
      ({ id: 'Identifiant', text: 'Énoncé', status: 'Statut', rating: 'Note', title: 'Titre' })[field as string] ??
      field,
    rating: () => '4/5',
    note: (kind: 'stale' | 'fallback' | 'unreviewed', lang: string) =>
      kind === 'fallback'
        ? `Affichée en ${lang.toUpperCase()}`
        : kind === 'stale'
          ? 'Traductions en retard'
          : 'Traduction automatique',
    missing: (id: string) => `${id} introuvable`,
    empty: 'rien'
  }
  const glyph = (requirement: Requirement, field: ReqBlockField) =>
    field === 'status' ? STATUS[requirement.status] : ''
  const exportedNote = async (held: Requirement[], block: string, lang = 'en') =>
    pdfBlocks(
      await readPdf(
        buildPdf(
          noteDocx(
            `# Spécification\n\nIntroduction du document.\n\n\`\`\`pm-req\n${block}\n\`\`\`\n`,
            { title: 'Spec', lang, library: held, fields: ['id', 'text', 'status', 'rating'], words },
            glyph
          )
        )
      ),
      { startsRow: startsRequirementRow(vocabulary) }
    )

  it('reads the block’s table back as nothing changed, notes under the words and all', async () => {
    const held = library()
    const blocks = await exportedNote(held, 'OMLX-THERM-0001, REQ-THERM-0002')
    expect(plan(blocks, held).map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'unchanged'],
      ['REQ-THERM-0002', 'unchanged']
    ])
  })

  // A table longer than a page is drawn again under its header on the next, and a row
  // can be cut in two across the break.
  it('reads a table carried over pages as one table', async () => {
    const held = Array.from({ length: 30 }, (_, at) =>
      setText(
        makeRequirement({
          id: `REQ-SYS-${String(at + 1).padStart(4, '0')}`,
          category: 'SYS',
          status: 'draft',
          sourceLang: 'fr'
        }),
        'fr',
        `Le système doit satisfaire la condition numéro ${at + 1}. `.repeat(1 + (at % 4)).trim(),
        'a'
      )
    )
    const blocks = await exportedNote(held, 'category: SYS', 'fr')
    expect(blocks.filter((block) => block.kind === 'table')).toHaveLength(1)
    const rows = plan(blocks, held)
    expect(rows).toHaveLength(30)
    expect(rows.filter((row) => row.action !== 'unchanged')).toEqual([])
  })
})
