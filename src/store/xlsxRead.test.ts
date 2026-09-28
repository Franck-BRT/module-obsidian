import { describe, expect, it } from 'vitest'
import { buildXlsx } from './xlsx'
import { columnIndex, isDateFormat, readXlsx, serialDate } from './xlsxRead'
import { utf8, zip } from './zip'

/**
 * A workbook shaped the way Excel saves one, written out here by hand rather than by this
 * plugin's writer: shared strings, a string in formatted runs with a phonetic guide
 * beside it, a line break escaped as `_x000A_`, a prefixed namespace, a cell with no
 * reference, a formula, a boolean, an error, and the relationships pointing at parts by
 * an absolute path.
 */
function excelLike(): Uint8Array {
  const part = (name: string, text: string) => ({ name, data: utf8(text) })
  return zip([
    part(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
    ),
    part(
      '_rels/.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    ),
    part(
      'xl/workbook.xml',
      '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="Exigences" sheetId="1" rel:id="rId7"/><x:sheet name="Notes" sheetId="2" rel:id="rId8"/></x:sheets></x:workbook>'
    ),
    part(
      'xl/_rels/workbook.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'
    ),
    part(
      'xl/sharedStrings.xml',
      '<x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:si><x:t>id</x:t></x:si><x:si><x:t>Texte</x:t></x:si><x:si><x:r><x:rPr><x:b/></x:rPr><x:t xml:space="preserve">Le système </x:t></x:r><x:r><x:t>doit démarrer.</x:t></x:r><x:rPh sb="0" eb="1"><x:t>PHONETIC</x:t></x:rPh></x:si><x:si><x:t>Ligne un_x000A_ligne deux</x:t></x:si><x:si><x:t>REQ-A-0001</x:t></x:si></x:sst>'
    ),
    part(
      'xl/worksheets/sheet1.xml',
      '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
        '<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c></x:row>' +
        '<x:row r="2"/>' +
        '<x:row r="3"><x:c r="A3" t="s"><x:v>4</x:v></x:c><x:c t="s"><x:v>2</x:v></x:c><x:c r="D3" t="str"><x:f>A3&amp;"!"</x:f><x:v>REQ-A-0001!</x:v></x:c></x:row>' +
        '<x:row r="4"><x:c r="A4"><x:v>12</x:v></x:c><x:c r="B4" t="s"><x:v>3</x:v></x:c><x:c r="C4" t="b"><x:v>1</x:v></x:c><x:c r="E4" t="e"><x:v>#N/A</x:v></x:c></x:row>' +
        '</x:sheetData></x:worksheet>'
    ),
    part(
      'xl/worksheets/sheet2.xml',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>seule</t></is></c></row></sheetData></worksheet>'
    )
  ])
}

describe('readXlsx', () => {
  it('reads every sheet, in the order of its tabs', async () => {
    const sheets = await readXlsx(excelLike())
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Exigences', 'Notes'])
  })

  it('reads a workbook the way Excel saves one', async () => {
    const [sheet] = await readXlsx(excelLike())
    expect(sheet.rows).toEqual([
      ['id', 'Texte'],
      // The formatted runs joined, the phonetic guide left out, a cell with no reference
      // taken as the next one, and a formula read as the value it shows.
      ['REQ-A-0001', 'Le système doit démarrer.', '', 'REQ-A-0001!'],
      // A number as written, an escaped line break unescaped, and an error as nothing.
      ['12', 'Ligne un\nligne deux', 'TRUE']
    ])
  })

  it('reads a string written inline, as this plugin writes them', async () => {
    const sheets = await readXlsx(excelLike())
    expect(sheets[1].rows).toEqual([['', 'seule']])
  })

  // The writer and the reader have to agree, or an export cannot come back.
  it('reads back what the plugin’s own export writes', async () => {
    const bytes = buildXlsx([
      {
        name: 'Bibliothèque',
        columns: [
          { label: 'Identifiant', width: 10 },
          { label: 'FR', width: 10 },
          { label: 'Note', width: 5 }
        ],
        rows: [
          ['REQ-A-0001', 'Deux lignes\net « guillemets » & <chevrons>', 80],
          ['REQ-A-0002', null, 0]
        ]
      }
    ])
    const [sheet] = await readXlsx(bytes)
    expect(sheet.rows).toEqual([
      ['Identifiant', 'FR', 'Note'],
      ['REQ-A-0001', 'Deux lignes\net « guillemets » & <chevrons>', '80'],
      ['REQ-A-0002', '', '0']
    ])
  })

  it('says a file is not a workbook', async () => {
    await expect(readXlsx(zip([{ name: 'a.txt', data: utf8('x') }]))).rejects.toThrow(/workbook/)
  })
})

describe('columnIndex', () => {
  it('counts columns the way a spreadsheet names them', () => {
    expect(['A1', 'Z9', 'AA1', 'AB12', 'XFD1'].map(columnIndex)).toEqual([0, 25, 26, 27, 16383])
  })
})

describe('dates', () => {
  it('knows a date format from a number one', () => {
    for (const code of ['dd/mm/yyyy', 'd mmm yy', 'mm/dd/yy', 'yyyy-mm-dd hh:mm', '[$-40C]d mmmm yyyy', 'mmm-yy']) {
      expect(isDateFormat(code)).toBe(true)
    }
    for (const code of ['General', '0.00', '#,##0 "m²"', '[Red]0', 'h:mm', '[h]:mm:ss', '0 "jours"']) {
      expect(isDateFormat(code)).toBe(false)
    }
  })

  // Day counts as Excel keeps them, and the dates they are.
  it('turns a serial number into the date it shows', () => {
    expect(serialDate(46279)).toBe('2026-09-14')
    expect(serialDate(1)).toBe('1899-12-31')
    expect(serialDate(61)).toBe('1900-03-01')
    expect(serialDate(46279.5)).toBe('2026-09-14 12:00')
    expect(serialDate(44817, true)).toBe('2026-09-14')
  })
})

/** A planning as a French Excel saves one: a custom date format, a built-in one, a number beside them. */
function planning(from1904 = false): Uint8Array {
  const part = (name: string, text: string) => ({ name, data: utf8(text) })
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  return zip([
    part(
      '_rels/.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    part(
      'xl/workbook.xml',
      `<workbook ${ns} xmlns:r="${rel}">${from1904 ? '<workbookPr date1904="1"/>' : ''}<sheets><sheet name="Planning" sheetId="1" r:id="r2"/></sheets></workbook>`
    ),
    part(
      'xl/_rels/workbook.xml.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r2" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r3" Type="${rel}/styles" Target="styles.xml"/></Relationships>`
    ),
    part(
      'xl/styles.xml',
      `<styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>`
    ),
    part(
      'xl/worksheets/sheet1.xml',
      `<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Soutènement</t></is></c><c r="B1" s="1"><v>${from1904 ? 44817 : 46279}</v></c><c r="C1" s="2"><v>${from1904 ? 44842 : 46304}</v></c><c r="D1" s="0"><v>20</v></c></row></sheetData></worksheet>`
    )
  ])
}

describe('a planning’s dates', () => {
  it('reads a date cell as the date it shows, and a number as a number', async () => {
    const [sheet] = await readXlsx(planning())
    expect(sheet.rows).toEqual([['Soutènement', '2026-09-14', '2026-10-09', '20']])
  })

  it('counts from 1904 when the workbook says so', async () => {
    const [sheet] = await readXlsx(planning(true))
    expect(sheet.rows[0].slice(1, 3)).toEqual(['2026-09-14', '2026-10-09'])
  })
})
