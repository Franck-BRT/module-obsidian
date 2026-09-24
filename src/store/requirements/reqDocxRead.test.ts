import { describe, expect, it } from 'vitest'
import { buildDocx } from '../docx'
import { readDocx, type DocxReadBlock, type DocxReadParagraph } from '../docxRead'
import { addLink, makeRequirement, setText, type Requirement } from './Requirement'
import { addAlias } from './reqAlias'
import { planCsvImport } from './reqCsv'
import { libraryDocx, noteDocx } from './reqDocx'
import { docxRequirements, leadingId, settleLanguages, type DocxVocabulary } from './reqDocxRead'
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
  readDocx(
    buildDocx(
      libraryDocx(requirements, {
        title: 'Bibliothèque',
        lang: 'fr',
        meta,
        sourceLabel: 'Origine',
        noCategory: 'Sans catégorie'
      })
    )
  )

const plan = (blocks: DocxReadBlock[], held: Requirement[]) =>
  planCsvImport(settleLanguages(docxRequirements(blocks, vocabulary, 'fr').rows, held), held)

describe('docxRequirements, on the library’s own Word export', () => {
  // The test that matters most: the library's own document, read back, changes nothing.
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
    expect(read).toMatchObject({ fromText: 3, fromTables: 0, unmatched: [] })
  })

  // Read as French, the English source would come home as a French "translation" of itself.
  it('files a wording shown in place of a missing translation under its own language', async () => {
    const held = library()
    const rows = settleLanguages(docxRequirements(await exportedLibrary(held), vocabulary, 'fr').rows, held)
    expect(rows[2]['text.en']).toBe('The computer shall log every reading.')
    expect(rows[2]['text.fr']).toBeUndefined()
  })

  it('sees an edit made in Word as a change, and only there', async () => {
    const held = library()
    const edited = held.map((each) =>
      each.id === 'REQ-THERM-0002'
        ? { ...each, status: 'approved', text: { ...each.text, fr: { ...each.text.fr, body: 'Toutes les 5 s.' } } }
        : each
    )
    const rows = plan(await exportedLibrary(edited), held)
    expect(rows.map((row) => row.action)).toEqual(['unchanged', 'update', 'unchanged'])
    expect(rows[1].values).toMatchObject({ status: 'approved', text: { fr: 'Toutes les 5 s.' } })
  })
})

describe('docxRequirements, on a note exported with its pm-req block', () => {
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

  const exportedNote = async (held: Requirement[], block: string) =>
    readDocx(
      buildDocx(
        noteDocx(
          `# Spécification\n\nIntroduction du document.\n\n\`\`\`pm-req\n${block}\n\`\`\`\n`,
          { title: 'Spec', lang: 'en', library: held, fields: ['id', 'text', 'status', 'rating'], words },
          glyph
        )
      )
    )

  // The block's own table, cited by an alias, with a machine wording and a fallback
  // noted under the words: all read back as nothing changed.
  it('reads the block’s table back as nothing changed', async () => {
    const held = library()
    const blocks = await exportedNote(held, 'OMLX-THERM-0001, REQ-THERM-0002')
    expect(plan(blocks, held).map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'unchanged'],
      ['REQ-THERM-0002', 'unchanged']
    ])
  })

  it('takes the notes under a wording off the words', async () => {
    const read = docxRequirements(await exportedNote(library(), 'REQ-THERM-0001, REQ-THERM-0002'), vocabulary, 'en')
    // English asked for: the machine English, its note taken off; and the French shown in
    // place of an English wording nobody wrote, filed as French because the note says so.
    expect(read.rows.map((row) => Object.entries(row).filter(([key]) => key.startsWith('text.')))).toEqual([
      [['text.en', 'The hold shall stay between 5 and 30 °C.']],
      [['text.fr', 'Le calculateur doit mesurer toutes les 10 s.']]
    ])
    expect(read).toMatchObject({ fromTables: 2, fromText: 0, unknown: [] })
  })
})

describe('docxRequirements, on a specification somebody wrote', () => {
  const para = (style: DocxReadParagraph['style'], text: string, level?: number): DocxReadBlock => ({
    kind: 'p',
    style,
    text,
    styleName: style,
    ...(level ? { level } : {})
  })
  const blocks: DocxReadBlock[] = [
    para('title', 'Spécification du boîtier'),
    para('heading', '1 Introduction', 1),
    para('normal', 'Ce document décrit le boîtier. Le système doit être beau, mais ce n’est pas une exigence.'),
    para('heading', '2 Alimentation', 1),
    para('normal', '[SYS-ALIM-01] Le boîtier doit accepter 18 V à 32 V.'),
    para('normal', 'Note : la plage couvre les réseaux 24 V.'),
    para('heading', 'SYS-ALIM-02 : Protection', 2),
    para('normal', 'Au-delà de 32 V, le boîtier doit se protéger :'),
    para('list', 'sans dommage ;'),
    para('list', 'sans perte des journaux.'),
    para('heading', '3 Annexes', 1),
    para('normal', 'Figure 12 : schéma.')
  ]
  const read = docxRequirements(blocks, vocabulary, 'fr')

  it('finds a requirement written inline, and stops at its own paragraph', () => {
    expect(read.rows[0]).toEqual({ id: 'SYS-ALIM-01', 'text.fr': 'Le boîtier doit accepter 18 V à 32 V.' })
  })

  it('finds a requirement under its heading, running to the next heading, lists and all', () => {
    expect(read.rows[1]).toEqual({
      id: 'SYS-ALIM-02',
      title: 'Protection',
      'text.fr': 'Au-delà de 32 V, le boîtier doit se protéger :\n\n- sans dommage ;\n- sans perte des journaux.'
    })
  })

  // A document is not a library: guessing which sentence is a requirement invents some.
  it('leaves prose alone, and a chapter heading is not a category', () => {
    expect(read.rows).toHaveLength(2)
    expect(read.fromText).toBe(2)
  })
})

describe('leadingId', () => {
  it('knows the ways a paragraph opens with an identifier', () => {
    expect(
      ['REQ-THERM-0001 — Maintien', '[SYS-12] Le système', 'SRS_042: The system', '(A-1) texte', 'REQ-SYS-0001'].map(
        (text) => leadingId(text)
      )
    ).toEqual([
      { id: 'REQ-THERM-0001', rest: 'Maintien' },
      { id: 'SYS-12', rest: 'Le système' },
      { id: 'SRS_042', rest: 'The system' },
      { id: 'A-1', rest: 'texte' },
      { id: 'REQ-SYS-0001', rest: '' }
    ])
  })

  it('does not take an ordinary sentence for one', () => {
    expect(['Figure 12 : schéma', 'ISO 9001 impose', 'Le REQ-A-1 dit', 'REQ-A texte'].map(leadingId)).toEqual([
      null,
      null,
      null,
      null
    ])
  })
})
