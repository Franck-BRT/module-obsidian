import { describe, expect, it } from 'vitest'
import { readMarkdown } from '../markdownRead'
import { toMarkdown } from '../markdownDoc'
import { addLink, makeRequirement, setText, type Requirement } from './Requirement'
import { addAlias } from './reqAlias'
import { planCsvImport } from './reqCsv'
import { noteDocx } from './reqDocx'
import { toMarkdownDocument } from './reqMarkdown'
import { docxRequirements, settleLanguages, settleSpacing, type DocxVocabulary } from './reqDocxRead'
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
  // With what other people title the wording column, as the plugin's own vocabulary has it.
  wording: ['Énoncé', 'Exigence'],
  isMark: (line) => /^Affichée en [A-Z]+$|^Traductions en retard$|^Traduction automatique$/.test(line),
  fallbackLang: (line) => /^Affichée en ([A-Z]+)$/.exec(line)?.[1].toLowerCase()
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

const read = (markdown: string, lang = 'fr') => {
  const { blocks, front } = readMarkdown(markdown, { notePrefixes: vocabulary.sourceLabels })
  return docxRequirements(blocks, vocabulary, front.language || lang)
}

const plan = (markdown: string, held: Requirement[]) =>
  planCsvImport(settleSpacing(settleLanguages(read(markdown).rows, held), held), held)

const exported = (requirements: Requirement[], lang = 'fr') =>
  toMarkdownDocument(requirements, {
    title: 'Bibliothèque',
    lang,
    noCategory: 'Sans catégorie',
    at: '2026-09-24T10:00:00Z'
  })

describe('reading requirements back out of the library’s Markdown', () => {
  // The test that matters most: the library's own document, read back, changes nothing.
  it('reads it back as a library with nothing to change', () => {
    const held = library()
    expect(plan(exported(held), held).map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'unchanged'],
      ['REQ-THERM-0002', 'unchanged'],
      ['REQ-LOG-0001', 'unchanged']
    ])
  })

  it('reads every field the export writes, the stored values of the badge line included', () => {
    expect(read(exported(library())).rows[0]).toEqual({
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

  // The front matter says which language the wordings are in; a guess is not needed.
  it('reads the wordings in the language the front matter names', () => {
    const translated = library().map((each) => setText(each, 'en', `English ${each.id}.`, 'a'))
    const rows = read(exported(translated, 'en'), 'fr').rows
    expect(rows.map((row) => row['text.en'])).toEqual([
      'English REQ-THERM-0001.',
      'English REQ-THERM-0002.',
      'English REQ-LOG-0001.'
    ])
  })

  it('sees an edit made in the text as a change, and only there', () => {
    const held = library()
    const edited = exported(held).replace(
      'Le calculateur doit mesurer toutes les 10 s.',
      'Le calculateur doit mesurer toutes les 5 s.'
    )
    const rows = plan(edited, held)
    expect(rows.map((row) => row.action)).toEqual(['unchanged', 'update', 'unchanged'])
    expect(rows[1].values.text).toEqual({ fr: 'Le calculateur doit mesurer toutes les 5 s.' })
  })
})

describe('reading requirements back out of a note’s Markdown', () => {
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

  // The block's table, cited by an alias, bold identifiers, a machine wording and a
  // fallback noted in italics after a <br>: all read back as nothing changed.
  it('reads the block’s table back as nothing changed', () => {
    const held = library()
    const markdown = toMarkdown(
      noteDocx(
        '# Spécification\n\nIntroduction.\n\n```pm-req\nOMLX-THERM-0001, REQ-THERM-0002\n```\n',
        { title: 'Spec', lang: 'en', library: held, fields: ['id', 'text', 'status', 'rating'], words },
        glyph
      ),
      { exported: '2026-09-24T10:00:00Z', source: 'Spec.md' }
    )
    const rows = planCsvImport(settleSpacing(settleLanguages(read(markdown, 'en').rows, held), held), held)
    expect(rows.map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'unchanged'],
      ['REQ-THERM-0002', 'unchanged']
    ])
  })

  // The export notes an identifier the library does not hold under the table. That note
  // names a hole in the document, not a requirement to create.
  it('does not take the note of a missing identifier for a requirement', () => {
    const held = library()
    const markdown = toMarkdown(
      noteDocx(
        '```pm-req\nREQ-THERM-0001, REQ-THERM-0404\n```\n',
        { title: 'Spec', lang: 'fr', library: held, fields: ['id', 'text', 'status'], words },
        glyph
      )
    )
    expect(markdown).toContain('*REQ-THERM-0404 introuvable*')
    expect(read(markdown).rows.map((row) => row.id)).toEqual(['REQ-THERM-0001'])
  })
})

describe('reading requirements out of Markdown somebody wrote', () => {
  const note = [
    '# Spécification du boîtier',
    '',
    'Ce document décrit le boîtier; le *système* doit être beau.',
    '',
    '## ALIM',
    '',
    '- **[SYS-ALIM-01]** Le boîtier doit accepter 18 V à 32 V.',
    '- Une remarque en liste.',
    '',
    '### SYS-ALIM-02 : Protection',
    '',
    'Au-delà de 32 V, le boîtier doit se protéger (voir [annexe](annexe.md)) :',
    '',
    '- sans dommage ;',
    '- sans perte des journaux.',
    '',
    '```pm-req',
    'SYS-ALIM-99 — dans un bloc de code, ce n’est pas une exigence',
    '```',
    '',
    '| ID | Exigence | Statut |',
    '|:---|---|---:|',
    '| SYS-ALIM-03 | La consommation doit rester \\| sous 12 W. | Brouillon |'
  ].join('\n')
  const found = read(note)

  it('finds the requirements a list, a heading and a table hold, and nothing in code', () => {
    expect(found.rows.map((row) => row.id)).toEqual(['SYS-ALIM-01', 'SYS-ALIM-02', 'SYS-ALIM-03'])
  })

  it('reads the words, emphasis and links taken off', () => {
    expect(found.rows[0]).toEqual({
      id: 'SYS-ALIM-01',
      category: 'ALIM',
      'text.fr': 'Le boîtier doit accepter 18 V à 32 V.'
    })
    expect(found.rows[1]).toMatchObject({
      title: 'Protection',
      category: 'ALIM',
      'text.fr':
        'Au-delà de 32 V, le boîtier doit se protéger (voir annexe) :\n\n- sans dommage ;\n- sans perte des journaux.'
    })
    expect(found.rows[2]).toEqual({
      id: 'SYS-ALIM-03',
      'text.fr': 'La consommation doit rester | sous 12 W.',
      status: 'draft'
    })
  })
})

describe('readMarkdown', () => {
  it('reads the front matter', () => {
    expect(readMarkdown('---\ntitle: "Bibli"\nlanguage: "en"\ncount: 3\n---\n\n# T\n').front).toEqual({
      title: 'Bibli',
      language: 'en',
      count: '3'
    })
  })

  it('keeps a lone star between numbers, and snake_case words, as written', () => {
    const { blocks } = readMarkdown('Le débit vaut 5 * 3 l/s pour le_mode_nominal.')
    expect(blocks).toEqual([
      { kind: 'p', style: 'normal', styleName: '', text: 'Le débit vaut 5 * 3 l/s pour le_mode_nominal.' }
    ])
  })
})
