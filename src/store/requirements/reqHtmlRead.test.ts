import { describe, expect, it } from 'vitest'
import { decodeHtml, readHtml } from '../htmlRead'
import { toHtml } from '../htmlDoc'
import { addLink, makeRequirement, setText, type Requirement } from './Requirement'
import { addAlias } from './reqAlias'
import { planCsvImport } from './reqCsv'
import { libraryDocx, noteDocx } from './reqDocx'
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

const read = (html: string, lang = 'fr') => docxRequirements(readHtml(html), vocabulary, lang)

const plan = (html: string, held: Requirement[], lang = 'fr') =>
  planCsvImport(settleSpacing(settleLanguages(read(html, lang).rows, held), held), held)

const exported = (requirements: Requirement[]) =>
  toHtml(
    libraryDocx(requirements, {
      title: 'Bibliothèque',
      lang: 'fr',
      meta,
      sourceLabel: 'Origine',
      noCategory: 'Sans catégorie'
    }),
    {
      meta: { exported: '2026-09-24', kicker: 'Black Projects' },
      anchor: (name) => (/^REQ-/.test(name) ? name : undefined)
    }
  )

describe('reading requirements back out of the library’s HTML', () => {
  // The test that matters most: the library's own page, read back, changes nothing.
  it('reads it back as a library with nothing to change', () => {
    const held = library()
    expect(plan(exported(held), held).map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'unchanged'],
      ['REQ-THERM-0002', 'unchanged'],
      ['REQ-LOG-0001', 'unchanged']
    ])
  })

  it('reads every field the page shows', () => {
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

  it('sees an edit made in the page as a change, and only there', () => {
    const held = library()
    const edited = exported(held).replace('toutes les 10 s.', 'toutes les 5 s.')
    const rows = plan(edited, held)
    expect(rows.map((row) => row.action)).toEqual(['unchanged', 'update', 'unchanged'])
  })
})

describe('reading requirements back out of a note’s HTML', () => {
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

  // The block's table, with anchors on its rows, bold identifiers, and the notes under a
  // wording in italics after a <br>; and a missing identifier's note under it.
  it('reads the block’s table back as nothing changed, and no missing identifier as new', () => {
    const held = library()
    const html = toHtml(
      noteDocx(
        '# Spécification\n\nIntroduction.\n\n```pm-req\nOMLX-THERM-0001, REQ-THERM-0002, REQ-THERM-0404\n```\n',
        { title: 'Spec', lang: 'en', library: held, fields: ['id', 'text', 'status', 'rating'], words },
        glyph
      ),
      { anchor: (name) => (/^(REQ|OMLX)-/.test(name) ? name : undefined) }
    )
    expect(plan(html, held, 'en').map((row) => [row.id, row.action])).toEqual([
      ['REQ-THERM-0001', 'unchanged'],
      ['REQ-THERM-0002', 'unchanged']
    ])
  })
})

describe('reading requirements out of HTML somebody wrote', () => {
  // As found: unclosed paragraphs and items, entities by name, a script, a navigation bar,
  // a page saved out of Word with its classes and its empty <o:p>.
  const page = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>Sp&eacute;cification</title>
<script>var x = "<p>SYS-ALIM-99 dans un script</p>"; var y = "<!--";</script><style>p { color: red }</style></head>
<body>
<nav><a href="/">Accueil</a> <p>SYS-ALIM-98 dans la navigation</nav>
<h1>Sp&eacute;cification du bo&icirc;tier</h1>
<p class=MsoNormal>Ce document d&eacute;crit le bo&icirc;tier.<o:p></o:p>
<h2>ALIM</h2>
<ul><li><b>[SYS-ALIM-01]</b> Le bo&icirc;tier doit accepter 18&nbsp;V &agrave; 32&nbsp;V.<li>Une remarque.</ul>
<h3>SYS-ALIM-02 &mdash; Protection</h3>
<p>Au-del&agrave; de 32 V, le bo&icirc;tier doit se prot&eacute;ger
   (voir <a href="annexe.html">l&rsquo;annexe</a>)&nbsp;:
<ul><li>sans dommage ;<li>sans perte des journaux.</ul>
<table border=1><tr><th>ID<th>Exigence<th>Statut
<tr><td>SYS-ALIM-03<td>La consommation doit rester<br>sous 12&#160;W.<td>Brouillon
<tr><td colspan=2>Total<td></table>
<footer>Page g&eacute;n&eacute;r&eacute;e le 24/09</footer>
</body></html>`
  const found = read(page)

  it('finds the requirements a list, a heading and a table hold, and nothing in scripts or navigation', () => {
    expect(found.rows.map((row) => row.id)).toEqual(['SYS-ALIM-01', 'SYS-ALIM-02', 'SYS-ALIM-03'])
  })

  it('reads the words as the page shows them', () => {
    expect(found.rows[0]).toEqual({
      id: 'SYS-ALIM-01',
      category: 'ALIM',
      'text.fr': 'Le boîtier doit accepter 18 V à 32 V.'
    })
    expect(found.rows[1]).toEqual({
      id: 'SYS-ALIM-02',
      title: 'Protection',
      category: 'ALIM',
      'text.fr':
        'Au-delà de 32 V, le boîtier doit se protéger (voir l’annexe) :\n\n- sans dommage ;\n- sans perte des journaux.'
    })
    expect(found.rows[2]).toEqual({
      id: 'SYS-ALIM-03',
      'text.fr': 'La consommation doit rester\nsous 12 W.',
      status: 'draft'
    })
  })
})

describe('reading a page saved out of a word processor', () => {
  // LibreOffice numbers its headings by putting them in list items, and a sub-level in a
  // list set straight inside the list.
  const saved = `<html><body>
<p class="title">Spécification du boîtier</p>
<ol><li><h1 class="western">1 Introduction</h1></li></ol>
<p>Ce document décrit le boîtier.</p>
<ol start="2"><li><h1 class="western">2 Alimentation</h1></li>
  <ol><li><h2 class="western">SYS-ALIM-02 — Protection</h2></li></ol>
</ol>
<p>Au-delà de 32 V, le boîtier doit se protéger.</p>
<ul><li><p>sans dommage ;</p></li><li>sans perte des journaux.</li></ul>
</body></html>`

  it('reads a heading numbered in a list as a heading, at whatever depth', () => {
    expect(read(saved).rows).toEqual([
      {
        id: 'SYS-ALIM-02',
        title: 'Protection',
        'text.fr': 'Au-delà de 32 V, le boîtier doit se protéger.\n\n- sans dommage ;\n- sans perte des journaux.'
      }
    ])
  })

  it('takes a paragraph classed as the title for the title', () => {
    expect(readHtml(saved)[0]).toMatchObject({ style: 'title', text: 'Spécification du boîtier' })
  })
})

describe('decodeHtml', () => {
  it('decodes entities by name, by number and by their accent’s shape', () => {
    expect(decodeHtml('&Eacute;t&eacute; &ccedil;a &#233;&#xE9; &hellip; &unknown; R&D')).toBe(
      'Été ça éé … &unknown; R&D'
    )
  })

  // A number past the last character would throw, and take the whole import with it.
  it('gives a number that is no character the replacement mark rather than failing', () => {
    expect(decodeHtml('a&#99999999;b&#x0;c')).toBe('a\ufffdb\ufffdc')
  })
})
