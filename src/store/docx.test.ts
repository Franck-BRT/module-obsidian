import { describe, expect, it } from 'vitest'
import { buildDocx, docxParts, para, type DocxDocument } from './docx'

const partText = (doc: DocxDocument, name: string): string => {
  const part = docxParts(doc, new Date('2026-09-22T10:00:00Z')).find((entry) => entry.name === name)
  if (!part) throw new Error(`no part ${name}`)
  return new TextDecoder().decode(part.data)
}

const body = (doc: DocxDocument): string => partText(doc, 'word/document.xml')

describe('the parts of a Word file', () => {
  const doc: DocxDocument = { title: 'Spécification', blocks: [para('Title', 'Spécification')] }

  // Word opens the package by name: a part that is not declared, or not pointed at, is a
  // file it refuses rather than a file it ignores.
  it('declares and points at every part it writes', () => {
    const names = docxParts(doc).map((entry) => entry.name)
    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml'
    ])
    const types = partText(doc, '[Content_Types].xml')
    for (const name of names.filter((entry) => entry.endsWith('.xml') && !entry.includes('_rels'))) {
      if (name === '[Content_Types].xml') continue
      expect(types).toContain(`PartName="/${name}"`)
    }
    expect(partText(doc, '_rels/.rels')).toContain('Target="word/document.xml"')
    expect(partText(doc, 'word/_rels/document.xml.rels')).toContain('Target="styles.xml"')
  })

  it('names the document in its properties, where Word shows it', () => {
    expect(partText(doc, 'docProps/core.xml')).toContain('<dc:title>Spécification</dc:title>')
  })

  it('is a zip, whatever is in it', () => {
    expect(Array.from(buildDocx(doc).slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
  })
})

describe('what a paragraph becomes', () => {
  it('carries its style, so a house template can restyle the whole document', () => {
    expect(body({ title: 'x', blocks: [para('Heading2', 'Soute')] })).toContain(
      '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>'
    )
  })

  // Normal is the absence of a style, and writing it out would be one more thing for a
  // template to have to override.
  it('says nothing at all for a plain paragraph', () => {
    expect(body({ title: 'x', blocks: [para('Normal', 'Texte')] })).not.toContain('w:pStyle')
  })

  it('escapes what would otherwise close a tag', () => {
    expect(body({ title: 'x', blocks: [para('Normal', 'a < b & "c"')] })).toContain('a &lt; b &amp; &quot;c&quot;')
  })

  // A requirement written on three lines means something by being on three lines.
  it('keeps a line break inside the paragraph rather than losing it', () => {
    const xml = body({ title: 'x', blocks: [para('Normal', 'un\ndeux')] })
    expect(xml).toContain('<w:t xml:space="preserve">un</w:t><w:br/><w:t xml:space="preserve">deux</w:t>')
  })

  // Leading and trailing spaces are the difference between "3 s" and "3s".
  it('tells Word to keep the spaces it was given', () => {
    expect(body({ title: 'x', blocks: [para('Normal', ' 3 s ')] })).toContain('xml:space="preserve"')
  })

  it('writes a bullet as something a reader sees', () => {
    expect(body({ title: 'x', blocks: [para('Bullet', 'un point')] })).toContain('• ')
  })
})

describe('what a table becomes', () => {
  const table = {
    kind: 'table' as const,
    header: [
      { runs: [{ text: 'Identifiant' }], width: 1500 },
      { runs: [{ text: 'Énoncé' }], width: 6000 }
    ],
    rows: [
      [
        { runs: [{ text: 'REQ-SYS-0001', bold: true }], width: 1500 },
        { runs: [{ text: 'La trappe doit ouvrir.' }], width: 6000 }
      ]
    ]
  }
  const xml = body({ title: 'x', blocks: [table] })

  it('declares its columns once in the grid and once per cell', () => {
    expect(xml).toContain('<w:gridCol w:w="1500"/><w:gridCol w:w="6000"/>')
    expect(xml).toContain('<w:tcW w:w="6000" w:type="dxa"/>')
  })

  // A specification runs over pages, and a table whose header stayed on page one is a
  // table nobody can read on page two.
  it('repeats the header row across pages', () => {
    expect(xml).toContain('<w:trPr><w:tblHeader/></w:trPr>')
  })

  it('writes the header in bold without being asked twice', () => {
    expect(xml.slice(xml.indexOf('tblHeader'), xml.indexOf('REQ-SYS-0001'))).toContain('<w:b/>')
  })

  // Two tables with nothing between them are read as one.
  it('leaves a paragraph after the table', () => {
    expect(xml).toContain('</w:tbl><w:p/>')
  })

  it('never writes an empty cell, which Word will not open', () => {
    const empty = body({
      title: 'x',
      blocks: [{ kind: 'table', header: [{ runs: [], width: 9000 }], rows: [[{ runs: [], width: 9000 }]] }]
    })
    expect(empty.match(/<w:tc>(?:(?!<w:p).)*<\/w:tc>/s)).toBeNull()
  })
})
