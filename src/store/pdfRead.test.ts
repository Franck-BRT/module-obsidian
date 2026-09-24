import { describe, expect, it } from 'vitest'
import { readPdf, type PdfStructElement } from './pdfRead'
import { pdfBlocks } from './pdfText'

/**
 * A PDF assembled here object by object, the way other tools write them rather than the
 * way this plugin does: a composite font known only through its ToUnicode map, fonts
 * with their own encodings, kerning inside TJ, a font scaled by the text matrix, an
 * italic made by slanting, escapes and hex strings, a running head marked as furniture,
 * a structure tree with a role map, objects packed into an object stream and the root
 * named only by a cross-reference stream.
 */
function assemble(objects: (string | null)[], root = '<< /Type /XRef /Root 1 0 R >>'): Uint8Array {
  let out = '%PDF-1.7\n'
  objects.forEach((object, at) => {
    // A gap: an object that lives only inside an object stream.
    if (object !== null) out += `${at + 1} 0 obj\n${object}\nendobj\n`
  })
  out += `${objects.length + 1} 0 obj\n${root}\nstream\n\nendstream\nendobj\n%%EOF\n`
  return Uint8Array.from(out, (char) => char.charCodeAt(0) & 0xff)
}

function stream(dict: string, body: string): string {
  return `<< ${dict} /Length ${body.length} >>\nstream\n${body}\nendstream`
}

/** Objects packed as an object stream packs them: offsets first, then the objects. */
function objectStream(objects: [number, string][]): string {
  let body = ''
  const offsets: string[] = []
  for (const [num, text] of objects) {
    offsets.push(`${num} ${body.length}`)
    body += `${text} `
  }
  const header = `${offsets.join(' ')} `
  return stream(`/Type /ObjStm /N ${objects.length} /First ${header.length}`, header + body)
}

const TO_UNICODE = [
  '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
  '1 begincodespacerange <0000> <FFFF> endcodespacerange',
  '2 beginbfchar <0001> <0053> <0002> <00E9> endbfchar',
  '1 beginbfrange <0010> <0012> <0061> endbfrange',
  '1 beginbfrange <0020> <0021> [<0066006C> <2019>] endbfrange',
  'endcmap CMapName currentdict /CMap defineresource pop end end'
].join('\n')

const CONTENT = [
  // A running head, marked as the page's furniture.
  '/Artifact BMC BT /F1 9 Tf 50 800 Td (Confidentiel) Tj ET EMC',
  // A heading, in the composite font: codes that mean nothing without the map.
  '/H1 << /MCID 0 >> BDC BT /F2 18 Tf 50 760 Td <00010002001000110012> Tj ET EMC',
  // A paragraph whose words are placed by kerning, with an escape, a byte from the
  // Windows code page, a ligature from the map and a hex string.
  '/P << /MCID 1 >> BDC BT /F1 12 Tf 50 730 Td [(Le \\(syst) 20 (\\350me\\)) -300 (doit)] TJ',
  '( l\\222ouvrir) Tj ET BT /F2 12 Tf 150 730 Td <0020> Tj ET',
  'BT /F1 12 Tf 158 730 Td <20656E> Tj ET EMC',
  // A caption, slanted by the text matrix rather than set in an italic font.
  '/Meta << /MCID 2 >> BDC BT /F1 1 Tf 9 0 2 9 50 700 Tm (Approuv\\351e \\267 Haute) Tj ET EMC',
  // A table of one header and one row.
  '/TD << /MCID 3 >> BDC BT /F1 10 Tf 50 660 Td (ID) Tj ET EMC',
  '/TD << /MCID 4 >> BDC BT /F1 10 Tf 150 660 Td (Texte) Tj ET EMC',
  '/TD << /MCID 5 >> BDC BT /F1 10 Tf 50 645 Td (SYS-1) Tj ET EMC',
  '/TD << /MCID 6 >> BDC BT /F3 10 Tf 150 645 Td (D\\351marrer.) Tj ET EMC'
].join('\n')

function tagged(): Uint8Array {
  const td = (mcid: number) => `<< /Type /StructElem /S /TD /Pg 3 0 R /K ${mcid} >>`
  return assemble([
    /* 1 */ '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 8 0 R >>',
    /* 2 */ '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    /* 3 */ '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 13 0 R >> >> /Contents 7 0 R >>',
    /* 4 */ '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    /* 5 */ '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Calibri-Bold /Encoding /Identity-H /DescendantFonts [14 0 R] /ToUnicode 6 0 R >>',
    /* 6 */ stream('', TO_UNICODE),
    /* 7 */ stream('', CONTENT),
    /* 8 */ '<< /Type /StructTreeRoot /RoleMap << /Meta /P >> /K [9 0 R] >>',
    /* 9 */ '<< /Type /StructElem /S /Document /K [10 0 R 11 0 R 12 0 R 15 0 R] >>',
    // Two of the structure's elements live only in the object stream at 16.
    /* 10 */ null,
    /* 11 */ null,
    /* 12 */ '<< /Type /StructElem /S /Meta /Pg 3 0 R /K << /Type /MCR /MCID 2 /Pg 3 0 R >> >>',
    /* 13 */ '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding << /BaseEncoding /MacRomanEncoding /Differences [201 /Eacute 233 /eacute] >> >>',
    /* 14 */ '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+Calibri-Bold /W [1 [600 500] 16 18 520] /DW 1000 >>',
    /* 15 */ `<< /Type /StructElem /S /Table /K [<< /Type /StructElem /S /TR /K [${td(3)} ${td(4)}] >> << /Type /StructElem /S /TR /K [${td(5)} ${td(6)}] >>] >>`,
    /* 16 */ objectStream([
      [10, '<< /Type /StructElem /S /H1 /Pg 3 0 R /K 0 >>'],
      [11, '<< /Type /StructElem /S /P /Pg 3 0 R /K [1] >>']
    ])
  ])
}

describe('readPdf', () => {
  it('reads the text through the fonts, whatever their encodings', async () => {
    const content = await readPdf(tagged())
    expect(content.items.map((item) => item.text)).toEqual([
      'Confidentiel',
      'Séabc',
      'Le (syst',
      'ème)',
      'doit',
      ' l’ouvrir',
      'fl',
      ' en',
      'Approuvée · Haute',
      'ID',
      'Texte',
      'SYS-1',
      'Démarrer.'
    ])
  })

  it('knows the text a matrix scaled, and the italic a matrix slanted', async () => {
    const caption = (await readPdf(tagged())).items.find((item) => item.text.startsWith('Approuvée'))
    expect(caption).toMatchObject({ size: 9, italic: true, mcid: 2 })
  })

  it('knows the composite font is bold, and measures it by its own widths', async () => {
    const heading = (await readPdf(tagged())).items[1]
    // S=600, é=500, a..c at 520 each, eighteen points.
    expect(heading).toMatchObject({ bold: true, size: 18 })
    expect(heading.width).toBeCloseTo(((600 + 500 + 3 * 520) / 1000) * 18)
  })

  it('moves text by the kerning a TJ puts between its strings', async () => {
    const [before, after] = (await readPdf(tagged())).items.filter((item) => ['ème)', 'doit'].includes(item.text))
    // A kern of -300 is three tenths of the size to the right.
    expect(after.x - (before.x + before.width)).toBeCloseTo(3.6)
  })

  it('says which text is the page’s furniture', async () => {
    expect((await readPdf(tagged())).items[0]).toMatchObject({ text: 'Confidentiel', artifact: true })
  })

  it('reads the structure tree, the author’s names beside the standard roles', async () => {
    const structure = (await readPdf(tagged())).structure as PdfStructElement
    const document = structure.kids[0] as PdfStructElement
    expect(document.kids.map((kid) => ('role' in kid ? `${kid.role}/${kid.name}` : 'ref'))).toEqual([
      'H1/H1',
      'P/P',
      'P/Meta',
      'Table/Table'
    ])
  })

  // Compressed by the platform's zlib, not by anything in this plugin.
  it('reads a page whose contents are compressed', async () => {
    const packed = new Uint8Array(
      await new Response(
        new Blob(['BT /F1 12 Tf 50 700 Td (Compress\\351) Tj ET'])
          .stream()
          .pipeThrough(new CompressionStream('deflate'))
      ).arrayBuffer()
    )
    const raw = String.fromCharCode(...packed)
    const file = assemble([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      `<< /Filter /FlateDecode /Length ${raw.length} >>\nstream\n${raw}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    ])
    expect((await readPdf(file)).items.map((item) => item.text)).toEqual(['Compressé'])
  })

  it('refuses an encrypted file by name rather than reading noise', async () => {
    const encrypted = assemble(
      ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'],
      '<< /Type /XRef /Root 1 0 R /Encrypt << /Filter /Standard >> >>'
    )
    await expect(readPdf(encrypted)).rejects.toThrow(/encrypted/)
  })

  it('says a file is not a PDF', async () => {
    await expect(readPdf(Uint8Array.from('PK\u0003\u0004', (char) => char.charCodeAt(0)))).rejects.toThrow(/not a PDF/)
  })
})

describe('pdfBlocks, on a tagged PDF', () => {
  // The structure says what each piece is; the furniture is not in it and falls away.
  it('reads the document as its structure says it was written', async () => {
    expect(pdfBlocks(await readPdf(tagged()))).toEqual([
      { kind: 'p', style: 'heading', level: 1, styleName: 'H1', text: 'Séabc' },
      { kind: 'p', style: 'normal', styleName: 'P', text: 'Le (système) doit l’ouvrirfl en' },
      { kind: 'p', style: 'meta', styleName: 'Meta', text: 'Approuvée · Haute' },
      {
        kind: 'table',
        rows: [
          ['ID', 'Texte'],
          ['SYS-1', 'Démarrer.']
        ]
      }
    ])
  })
})
