import { describe, expect, it } from 'vitest'
import { readZipEntries } from '../../test/readZip'
import { buildXlsx, columnName, sheetName, xlsxParts, type XlsxSheet } from './xlsx'

const sheet = (over: Partial<XlsxSheet> = {}): XlsxSheet => ({
  name: 'Exigences',
  columns: [
    { label: 'Identifiant', width: 18 },
    { label: 'Énoncé', width: 60, wrap: true },
    { label: 'Note', width: 8 }
  ],
  rows: [['REQ-THERM-0001', 'La soute doit rester entre 5 et 30 °C.', 90]],
  ...over
})

const part = (sheets: XlsxSheet[], name: string): string => {
  const found = xlsxParts(sheets).find((entry) => entry.name === name)
  if (!found) throw new Error(`no part ${name}`)
  return new TextDecoder().decode(found.data)
}

describe('columnName', () => {
  // A requirements library with two languages already passes Z.
  it('counts the way a spreadsheet counts', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])
  })
})

describe('sheetName', () => {
  it('takes out what Excel uses for addressing', () => {
    expect(sheetName('Exigences [2026/09]')).toBe('Exigences  2026 09')
  })

  it('keeps it short enough to be a name', () => {
    expect(sheetName('x'.repeat(40))).toHaveLength(31)
  })

  // Excel will not open a file whose sheet is named nothing at all.
  it('never hands back an empty name', () => {
    expect(sheetName('  ')).toBe('Feuille')
  })
})

describe('a sheet', () => {
  const xml = part([sheet()], 'xl/worksheets/sheet1.xml')

  it('writes the header in the header style', () => {
    expect(xml).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Identifiant</t></is></c>')
  })

  // A rating written as text sorts as text, and puts 10 between 1 and 2.
  it('writes a number as a number', () => {
    expect(xml).toContain('<c r="C2"><v>90</v></c>')
  })

  it('writes prose as a string, escaped', () => {
    const escaped = part([sheet({ rows: [['a < b', '', null]] })], 'xl/worksheets/sheet1.xml')
    expect(escaped).toContain('a &lt; b')
  })

  // An empty cell that is written is a cell the reader has to hold in memory; a table of
  // four hundred requirements has thousands of them.
  it('writes nothing at all for an empty cell', () => {
    const sparse = part([sheet({ rows: [['REQ-A-0001', '', null]] })], 'xl/worksheets/sheet1.xml')
    expect(sparse).toContain('<row r="2"><c r="A2" t="inlineStr">')
    expect(sparse).not.toContain('r="B2"')
  })

  it('freezes the header and turns the filters on', () => {
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>')
    expect(xml).toContain('<autoFilter ref="A1:C2"/>')
  })

  // Long prose in an unwrapped column is one line as wide as the requirement.
  it('wraps the column that was asked to wrap, and only that one', () => {
    expect(xml).toContain('<c r="B2" s="2"')
    expect(xml).toContain('<c r="A2" t="inlineStr"')
  })

  // Infinity and NaN make the file unopenable rather than merely wrong.
  it('leaves out a number the spreadsheet could not hold', () => {
    const broken = part([sheet({ rows: [['REQ-A-0001', '', Number.NaN]] })], 'xl/worksheets/sheet1.xml')
    expect(broken).not.toContain('NaN')
  })
})

describe('the workbook', () => {
  const sheets = [sheet(), sheet({ name: 'Traçabilité', rows: [] })]

  it('declares, points at and writes every part', () => {
    const names = xlsxParts(sheets).map((entry) => entry.name)
    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
      'xl/styles.xml'
    ])
    const types = part(sheets, '[Content_Types].xml')
    for (const name of names.filter((entry) => entry.endsWith('.xml') && !entry.includes('_rels'))) {
      if (name === '[Content_Types].xml') continue
      expect(types).toContain(`PartName="/${name}"`)
    }
    const rels = part(sheets, 'xl/_rels/workbook.xml.rels')
    expect(rels).toContain('Target="worksheets/sheet1.xml"')
    expect(rels).toContain('Target="worksheets/sheet2.xml"')
    expect(rels).toContain('Target="styles.xml"')
  })

  // The name on the tab and the sheet the workbook points at have to be the same sheet.
  it('names each sheet against the relationship that reaches it', () => {
    const book = part(sheets, 'xl/workbook.xml')
    expect(book).toContain('<sheet name="Exigences" sheetId="1" r:id="rId1"/>')
    expect(book).toContain('<sheet name="Traçabilité" sheetId="2" r:id="rId2"/>')
  })

  it('comes out of the archive the way an unzipper reads it', () => {
    const entries = readZipEntries(buildXlsx(sheets, new Date('2026-09-22T10:00:00Z')))
    for (const entry of entries) expect(entry.ok).toBe(true)
    expect(entries.map((entry) => entry.name)).toContain('xl/worksheets/sheet2.xml')
  })
})
