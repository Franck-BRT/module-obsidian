import { describe, expect, it } from 'vitest'
import type { DocxParagraph, DocxTable } from '../docx'
import { makeRequirement, setText } from './Requirement'
import { columnWidths, inlineRuns, noteDocx } from './reqDocx'
import type { ReqBlockField } from './reqBlockFields'

const words = {
  column: (field: ReqBlockField) => field.toUpperCase(),
  rating: () => '4/5',
  note: (kind: string, lang: string) => `[${kind} ${lang}]`,
  missing: (id: string) => `${id} introuvable`,
  empty: 'rien'
}
const glyph = (): string => 'glyphe'

const library = [
  setText(
    makeRequirement({ id: 'REQ-SYS-0001', title: 'Trappe', status: 'approved', sourceLang: 'fr' }),
    'fr',
    'La trappe doit ouvrir en 3 s.',
    'franck'
  )
]

const options = {
  title: 'Spécification',
  lang: 'fr',
  library,
  fields: ['id', 'text', 'status'] as ReqBlockField[],
  words
}

const doc = (content: string) => noteDocx(content, options, glyph)
const tables = (content: string) => doc(content).blocks.filter((b): b is DocxTable => b.kind === 'table')
const paras = (content: string) =>
  doc(content)
    .blocks.filter((b): b is DocxParagraph => b.kind === 'p')
    .map((b) => `${b.style}:${b.runs.map((r) => r.text).join('')}`)

describe('inlineRuns', () => {
  it('reads bold and italic', () => {
    expect(inlineRuns('un **gras** et un *penché*')).toEqual([
      { text: 'un ' },
      { text: 'gras', bold: true },
      { text: ' et un ' },
      { text: 'penché', italic: true }
    ])
  })

  // A link in a specification is read for its text; the URL in the middle of a sentence
  // would be harder to read than no link at all.
  it('keeps what a link was wrapping and drops the rest', () => {
    expect(inlineRuns('voir [la note](https://x.y) et [[Trappe|la trappe]]')).toEqual([
      { text: 'voir la note et la trappe' }
    ])
  })

  it('has a run even for an empty line', () => {
    expect(inlineRuns('')).toEqual([{ text: '' }])
  })
})

describe('a note as a document', () => {
  // A reader who opens the file wants the specification, not the tags it was filed under.
  it('leaves the note’s own frontmatter behind', () => {
    expect(paras('---\ntags: [x]\n---\n\nUne phrase.')).toEqual(['Title:Spécification', 'Normal:Une phrase.'])
  })

  // A document that printed the file name above the note's own title would say the same
  // thing twice.
  it('takes the note’s own opening heading as the title', () => {
    expect(paras('# Spécification thermique\n\nUne phrase.')).toEqual([
      'Title:Spécification thermique',
      'Normal:Une phrase.'
    ])
  })

  it('falls back to the file name for a note that never named itself', () => {
    expect(paras('Une phrase.')[0]).toBe('Title:Spécification')
  })

  // Only the first heading, and only when it leads: a note whose second section is an H1
  // has a second section, not a second title.
  it('leaves a later heading where it is', () => {
    expect(paras('# Un\n# Deux')).toEqual(['Title:Un', 'Heading1:Deux'])
  })

  /**
   * The note's own first heading becomes the title, so everything under it moves up a
   * level: a `##` section is the document's first level, not its second. Left as it was,
   * the exported document skips a level, which a reader sees at once in Markdown.
   */
  it('lifts the headings under a title it took from the note', () => {
    expect(paras('# Titre\n## Section\n### Sous-section')).toEqual([
      'Title:Titre',
      'Heading1:Section',
      'Heading2:Sous-section'
    ])
  })

  it('leaves the levels alone in a note that never named itself', () => {
    expect(paras('## Section\n### Sous-section')).toEqual([
      'Title:Spécification',
      'Heading2:Section',
      'Heading3:Sous-section'
    ])
  })

  it('carries headings, quotes and bullets across', () => {
    expect(paras('Avant.\n# Titre\n## Sous-titre\n> une citation\n- un point')).toEqual([
      'Title:Spécification',
      'Normal:Avant.',
      'Heading1:Titre',
      'Heading2:Sous-titre',
      'Quote:une citation',
      'Bullet:un point'
    ])
  })

  it('turns a block into the table it draws on screen', () => {
    const [table] = tables('Avant.\n\n```pm-req\nREQ-SYS-0001\n```\n\nAprès.')
    expect(table.header.map((cell) => cell.runs[0].text)).toEqual(['ID', 'TEXT', 'STATUS'])
    expect(table.rows[0][0].runs[0].text).toBe('REQ-SYS-0001')
    expect(table.rows[0][1].runs[0].text).toBe('La trappe doit ouvrir en 3 s.')
  })

  it('keeps the prose on both sides of the block, in order', () => {
    expect(paras('Avant.\n\n```pm-req\nREQ-SYS-0001\n```\n\nAprès.')).toEqual([
      'Title:Spécification',
      'Normal:Avant.',
      'Normal:Après.'
    ])
  })

  // The block decides, as it does on screen.
  it('draws the columns the block asked for', () => {
    const [table] = tables('```pm-req\nREQ-SYS-0001\nfields: id, title\n```')
    expect(table.header.map((cell) => cell.runs[0].text)).toEqual(['ID', 'TITLE'])
  })

  // A supplier reading the exported file must read the requirement, never the fence that
  // fetches it.
  it('never leaves the block’s own lines in the document', () => {
    expect(paras('```pm-req\nREQ-SYS-0001\nfields: id, text\n```').join()).not.toContain('pm-req')
  })

  it('quotes it under the name the document used', () => {
    const aliased = { ...options, library: [{ ...library[0], aliases: ['OMLX-SYS-0001'] }] }
    const [table] = noteDocx('```pm-req\nOMLX-SYS-0001\n```', aliased, glyph).blocks.filter(
      (b): b is DocxTable => b.kind === 'table'
    )
    expect(table.rows[0][0].runs[0].text).toBe('OMLX-SYS-0001')
  })

  // A requirement deleted under a document has to leave a hole in the document.
  it('writes out an identifier the library does not hold', () => {
    expect(paras('```pm-req\nREQ-SYS-0404\n```')).toContain('Meta:REQ-SYS-0404 introuvable')
  })

  /**
   * The mark is worth more in the file that leaves the building than in the one that
   * stays: a specification exporting a translation that has fallen behind its source,
   * without saying so, is the failure this whole library exists to prevent.
   */
  it('says in the cell when the wording it exported is not simply current', () => {
    let requirement = setText(makeRequirement({ id: 'REQ-SYS-0001', sourceLang: 'fr' }), 'fr', 'Version un.', 'a')
    requirement = setText(requirement, 'en', 'Version one.', 'llm', 'machine')
    requirement = setText(requirement, 'fr', 'Version deux.', 'a')
    const [table] = noteDocx(
      '```pm-req\nREQ-SYS-0001\nlang: en\n```',
      { ...options, library: [requirement] },
      glyph
    ).blocks.filter((b): b is DocxTable => b.kind === 'table')
    const cell = table.rows[0][1].runs
    expect(cell[0].text).toBe('Version one.')
    expect(cell[1]).toEqual({ text: '\n[stale en] · [unreviewed en]', italic: true })
  })

  it('says a block that matched nothing matched nothing', () => {
    expect(paras('```pm-req\ncategory: NOPE\n```')).toContain('Meta:rien')
  })

  // An empty block asks for nothing, and a document should not be handed the library.
  it('draws no table for a block that asked for nothing', () => {
    expect(tables('```pm-req\nlang: fr\n```')).toEqual([])
  })
})

describe('columnWidths', () => {
  it('gives the wording whatever the named columns left', () => {
    const widths = columnWidths(['id', 'text', 'status'])
    expect(widths[0]).toBe(1500)
    expect(widths[1]).toBeGreaterThan(5000)
  })

  // A table that does not fit is Word's problem to shrink; a two-centimetre column of
  // prose is nobody's idea of a specification.
  it('never squeezes the wording below something readable', () => {
    const widths = columnWidths(['id', 'title', 'text', 'type', 'status', 'criticality', 'verification', 'rating'])
    expect(widths[2]).toBeGreaterThanOrEqual(2400)
  })

  it('leaves a line break out of the table, having no column to be', () => {
    expect(columnWidths(['id', 'break', 'text'])).toHaveLength(2)
  })
})
