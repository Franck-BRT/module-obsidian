import { describe, expect, it } from 'vitest'
import { buildPptx } from '../pptx'
import { readPptx, type PptxReadSlide } from '../pptxRead'
import { addLink, makeRequirement, setText, type Requirement } from './Requirement'
import { addAlias } from './reqAlias'
import { planCsvImport } from './reqCsv'
import { libraryDeck, type PptxWords } from './reqPptx'
import { settleLanguages, settleSpacing, type DocxVocabulary } from './reqDocxRead'
import { pptxRequirements, type PptxVocabulary } from './reqPptxRead'

/** The words a French export uses, and the vocabulary that reads them back. */
const STATUS: Record<string, string> = { draft: 'Brouillon', approved: 'Approuvée' }
const TYPE: Record<string, string> = { functional: 'Fonctionnelle', performance: 'Performance' }
const CRITICALITY: Record<string, string> = { high: 'Haute', low: 'Basse' }
const VERIFICATION: Record<string, string> = { test: 'Essai', analysis: 'Analyse' }
const invert = (map: Record<string, string>) =>
  Object.fromEntries(Object.entries(map).map(([value, label]) => [label.toLowerCase(), value]))

const docx: DocxVocabulary = {
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

const vocabulary: PptxVocabulary = {
  ...docx,
  // As the plugin's own vocabulary has it: what other people title the wording column.
  wording: [...docx.wording, 'Exigence'],
  rationaleLabels: ['Justification'],
  sectionLabels: ['Catégorie'],
  noWording: ['Pas encore d’énoncé']
}

const words: PptxWords = {
  title: 'Revue des exigences',
  subtitle: (count) => `${count} exigences`,
  glyph: (requirement, field) =>
    field === 'status'
      ? (STATUS[requirement.status] ?? '')
      : field === 'type'
        ? (TYPE[requirement.type] ?? '')
        : field === 'criticality'
          ? (CRITICALITY[requirement.criticality] ?? '')
          : (VERIFICATION[requirement.verification] ?? ''),
  rating: () => '4/5 · 90 %',
  rationale: 'Justification',
  source: 'Origine',
  noWording: 'Pas encore d’énoncé',
  noCategory: 'Sans catégorie',
  section: 'Catégorie'
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

const deck = async (requirements: Requirement[]): Promise<PptxReadSlide[]> =>
  readPptx(buildPptx(libraryDeck(requirements, 'fr', words)))

const plan = (slides: PptxReadSlide[], held: Requirement[]) =>
  planCsvImport(settleSpacing(settleLanguages(pptxRequirements(slides, vocabulary, 'fr').rows, held), held), held)

describe('pptxRequirements, on the library’s own review deck', () => {
  // The test that matters most: the deck, read back, changes nothing.
  it('reads it back as a library with nothing to change', async () => {
    const held = library()
    expect(plan(await deck(held), held).map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'unchanged'],
      ['REQ-THERM-0002', 'unchanged'],
      ['REQ-LOG-0001', 'unchanged']
    ])
  })

  it('reads every field a slide holds, its other names and its category included', async () => {
    const read = pptxRequirements(await deck(library()), vocabulary, 'fr')
    expect(read.rows[0]).toEqual({
      id: 'REQ-THERM-0001',
      aliases: 'OMLX-THERM-0001',
      category: 'THERM',
      title: 'Maintien',
      'text.fr': 'La soute doit rester entre 5 °C et 30 °C.\nEn toute saison.',
      rationale: 'Les cartes décrochent au-delà.',
      source: 'CDC §4',
      status: 'approved',
      type: 'performance',
      criticality: 'high',
      verification: 'test'
    })
    // The rating along the bottom is worked out, and is neither read nor called unknown.
    expect(read).toMatchObject({ fromText: 3, fromTables: 0, unmatched: [] })
  })

  it('sees an edit made on a slide as a change, and only there', async () => {
    const held = library()
    const edited = held.map((each) =>
      each.id === 'REQ-THERM-0002' ? { ...each, status: 'approved', title: 'Mesure revue' } : each
    )
    const rows = plan(await deck(edited), held)
    expect(rows.map((row) => row.action)).toEqual(['unchanged', 'update', 'unchanged'])
    expect(rows[1].values).toMatchObject({ status: 'approved', title: 'Mesure revue' })
  })

  // PowerPoint adds a slide number to the slides somebody edits; it is not the wording.
  it('leaves alone the slide number PowerPoint puts on a slide of its own', async () => {
    const held = library()
    const slides = await deck(held)
    for (const slide of slides) {
      slide.shapes.push({
        kind: 'text',
        name: 'Numéro de diapositive',
        placeholder: 'sldNum',
        y: 10,
        paragraphs: [{ text: '7', bullet: false }]
      })
    }
    expect(plan(slides, held).map((row) => row.action)).toEqual(['unchanged', 'unchanged', 'unchanged'])
  })

  it('reads a requirement with no title and no wording without inventing either', async () => {
    const bare = [makeRequirement({ id: 'REQ-A-0001', title: '', category: 'A', status: 'draft', sourceLang: 'fr' })]
    const read = pptxRequirements(await deck(bare), vocabulary, 'fr')
    expect(read.rows).toEqual([{ id: 'REQ-A-0001', category: 'A', status: 'draft' }])
  })
})

describe('pptxRequirements, on a deck somebody made', () => {
  const text = (name: string, lines: string[], placeholder?: string, y?: number) => ({
    kind: 'text' as const,
    name,
    ...(placeholder ? { placeholder } : {}),
    ...(y === undefined ? {} : { y }),
    // A line written with "• " in front is a bullet on the slide.
    paragraphs: lines.map((line) => ({ text: line.replace(/^• /, ''), bullet: line.startsWith('• ') }))
  })
  const slides: PptxReadSlide[] = [
    { shapes: [text('Titre 1', ['Revue fournisseur'], 'ctrTitle'), text('Sous-titre', ['Septembre'], 'subTitle')] },
    { shapes: [text('Titre 1', ['ALIM'], 'title')] },
    {
      shapes: [
        text('Titre 1', ['SYS-ALIM-01 — Tension d’entrée'], 'title'),
        text('Contenu', ['Le boîtier doit accepter 18 V à 32 V :', '• en continu ;', '• sans réglage.'], 'body', 150),
        text('Numéro', ['3'], 'sldNum', 500)
      ]
    },
    {
      shapes: [
        text('Titre 1', ['Récapitulatif'], 'title'),
        {
          kind: 'table',
          y: 120,
          rows: [
            ['ID', 'Exigence', 'Statut'],
            ['SYS-ALIM-02', 'La consommation doit rester sous 12 W.', 'Brouillon']
          ]
        }
      ]
    }
  ]
  const read = pptxRequirements(slides, vocabulary, 'fr')

  it('reads a slide titled by an identifier, with its bullets, and a title-only slide as its category', () => {
    expect(read.rows[0]).toEqual({
      id: 'SYS-ALIM-01',
      title: 'Tension d’entrée',
      category: 'ALIM',
      'text.fr': 'Le boîtier doit accepter 18 V à 32 V :\n\n- en continu ;\n- sans réglage.'
    })
  })

  it('reads a table on a slide as a table, and leaves the slide number alone', () => {
    expect(read.rows[1]).toEqual({
      id: 'SYS-ALIM-02',
      'text.fr': 'La consommation doit rester sous 12 W.',
      status: 'draft'
    })
    expect(read).toMatchObject({ fromText: 1, fromTables: 1 })
  })
})
