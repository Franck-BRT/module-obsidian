import { describe, expect, it } from 'vitest'
import { para, type DocxDocument, type DocxTable } from './docx'
import { cellMd, toMarkdown } from './markdownDoc'

const doc = (blocks: DocxDocument['blocks']): DocxDocument => ({ title: 'Spécification', blocks })

describe('a document as Markdown', () => {
  // Two `#` in a document is two documents as far as most readers are concerned.
  it('gives the title the one first-level heading and moves the rest down', () => {
    const md = toMarkdown(doc([para('Title', 'Spécification'), para('Heading1', 'Soute'), para('Heading2', 'Trappe')]))
    expect(md).toContain('# Spécification')
    expect(md).toContain('## Soute')
    expect(md).toContain('### Trappe')
  })

  it('writes a quote as a quote, line by line', () => {
    expect(toMarkdown(doc([para('Quote', 'un\ndeux')]))).toContain('> un\n> deux')
  })

  it('writes a bullet as a bullet', () => {
    expect(toMarkdown(doc([para('Bullet', 'un point')]))).toContain('- un point')
  })

  // A requirement the library does not hold has to read as a remark, not as prose.
  it('says a remark quietly', () => {
    expect(toMarkdown(doc([para('Meta', 'REQ-SYS-0404 : introuvable.')]))).toContain('*REQ-SYS-0404 : introuvable.*')
  })

  it('keeps the emphasis the runs carried', () => {
    const md = toMarkdown(
      doc([
        {
          kind: 'p',
          style: 'Normal',
          runs: [{ text: 'un ' }, { text: 'gras', bold: true }, { text: ' et ' }, { text: 'penché', italic: true }]
        }
      ])
    )
    expect(md).toContain('un **gras** et *penché*')
  })

  // Markdown does not open an emphasis on whitespace, so `* mot *` is three asterisks
  // and a word. A mark written under a wording arrives with its newline in front of it.
  it('puts the emphasis around the words and not around the spaces', () => {
    const md = toMarkdown(
      doc([{ kind: 'p', style: 'Normal', runs: [{ text: 'a' }, { text: ' en retard ', italic: true }] }])
    )
    expect(md).toContain('a *en retard*')
  })

  // A line straight after a list is read as more of the last item; the blank line is
  // what ends the list.
  it('closes a list before whatever comes next', () => {
    const md = toMarkdown(doc([para('Bullet', 'un'), para('Bullet', 'deux'), para('Meta', 'une remarque')]))
    expect(md).toContain('- deux\n\n*une remarque*')
  })

  // A bullet list followed by a paragraph must not become two lists.
  it('never leaves a run of blank lines', () => {
    expect(toMarkdown(doc([para('Bullet', 'un'), para('Bullet', 'deux'), para('Normal', 'Après.')]))).not.toMatch(
      /\n{3}/
    )
  })

  it('ends with exactly one newline, as a text file should', () => {
    expect(toMarkdown(doc([para('Normal', 'Texte.')]))).toBe('Texte.\n')
  })

  it('says what it is and when it was taken, because it is a snapshot', () => {
    const md = toMarkdown(doc([para('Title', 'Spécification')]), {
      exported: '2026-09-24T10:00:00.000Z',
      source: 'Specs/Thermique.md'
    })
    expect(md.startsWith('---\ntitle: "Spécification"')).toBe(true)
    expect(md).toContain('exported: "2026-09-24T10:00:00.000Z"')
    expect(md).toContain('source: "Specs/Thermique.md"')
  })
})

describe('a table as Markdown', () => {
  const table: DocxTable = {
    kind: 'table',
    header: [
      { runs: [{ text: 'Identifiant' }], width: 2000 },
      { runs: [{ text: 'Énoncé' }], width: 7000 }
    ],
    rows: [
      [
        { runs: [{ text: 'REQ-THERM-0001' }], width: 2000 },
        { runs: [{ text: 'Entre 5 et 30 °C.' }, { text: '\nAffichée en FR', italic: true }], width: 7000 }
      ]
    ]
  }

  it('writes the header, the rule and the rows', () => {
    const md = toMarkdown(doc([table]))
    expect(md).toContain('| Identifiant | Énoncé |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| REQ-THERM-0001 |')
  })

  // A newline would end the row, and a mark under a wording is exactly where one is.
  it('turns a line break inside a cell into one the renderer understands', () => {
    expect(toMarkdown(doc([table]))).toContain('Entre 5 et 30 °C.<br>*Affichée en FR*')
  })

  // "3 V | 5 V" is a requirement, not two columns.
  it('escapes a pipe rather than ending the column', () => {
    expect(cellMd({ runs: [{ text: '3 V | 5 V' }], width: 100 })).toBe('3 V \\| 5 V')
  })

  it('leaves an empty cell empty rather than dropping the column', () => {
    const sparse: DocxTable = {
      ...table,
      rows: [
        [
          { runs: [], width: 2000 },
          { runs: [{ text: 'x' }], width: 7000 }
        ]
      ]
    }
    expect(toMarkdown(doc([sparse]))).toContain('|  | x |')
  })
})
