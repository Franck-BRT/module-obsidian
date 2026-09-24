import { describe, expect, it } from 'vitest'
import { buildXlsx } from './xlsx'
import { columnIndex, readXlsx } from './xlsxRead'
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
