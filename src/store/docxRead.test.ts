import { describe, expect, it } from 'vitest'
import { buildDocx, para } from './docx'
import { readDocx, type DocxReadBlock } from './docxRead'
import { utf8, zip } from './zip'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/**
 * A document the way Word saves one, written by hand rather than by this plugin: a French
 * Word's `Titre2` style whose name is `heading 2`, a company style based on a heading, a
 * heading made by an outline level on the paragraph, tracked changes, a field, a text box
 * with its fallback copy, a hyperlink, a tab, a content control, a numbered paragraph and
 * a table whose cell holds two paragraphs.
 */
function wordLike(): Uint8Array {
  const styles = `<w:styles ${W}>
    <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="ExigenceTitre"><w:name w:val="Exigence titre"/><w:basedOn w:val="Titre2"/></w:style>
    <w:style w:type="paragraph" w:styleId="Citation"><w:name w:val="Quote"/></w:style>
  </w:styles>`
  const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
  const body = [
    `<w:p><w:pPr><w:pStyle w:val="Titre2"/></w:pPr>${run('SYS-12 — Démarrage')}</w:p>`,
    `<w:p>${run('Le système doit ')}<w:del><w:r><w:delText>vite </w:delText></w:r></w:del><w:ins><w:r><w:t>démarrer</w:t></w:r></w:ins>${run(' en 3 s')}<w:r><w:tab/></w:r>${run('(voir ')}<w:hyperlink><w:r><w:t>annexe</w:t></w:r></w:hyperlink>${run(').')}</w:p>`,
    `<w:p>${run('Page ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('4')}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
    `<w:p><w:r><mc:AlternateContent xmlns:mc="m"><mc:Choice><w:drawing><w:txbxContent><w:p>${run('encadré')}</w:p></w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p>${run('encadré')}</w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>${run('Texte courant.')}</w:p>`,
    `<w:p><w:pPr><w:pStyle w:val="ExigenceTitre"/></w:pPr>${run('SYS-13')}</w:p>`,
    `<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr>${run('Chapitre à la main')}</w:p>`,
    `<w:sdt><w:sdtContent><w:p><w:pPr><w:pStyle w:val="Citation"/></w:pPr>${run('Parce que.')}</w:p></w:sdtContent></w:sdt>`,
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run('un point')}</w:p>`,
    `<w:tbl><w:tr><w:tc><w:p>${run('ID')}</w:p></w:tc><w:tc><w:p>${run('Texte')}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run('SYS-14')}</w:p></w:tc><w:tc><w:p>${run('Ligne un')}</w:p><w:p>${run('ligne deux')}</w:p></w:tc></w:tr></w:tbl>`,
    `<w:p>${run('Deux')}<w:r><w:br/></w:r>${run('lignes')}</w:p>`
  ].join('')
  return zip([
    { name: 'word/document.xml', data: utf8(`<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`) },
    { name: 'word/styles.xml', data: utf8(styles) }
  ])
}

const shape = (blocks: DocxReadBlock[]) =>
  blocks.map((block) =>
    block.kind === 'table' ? block.rows : `${block.style}${block.level ? block.level : ''}: ${block.text}`
  )

describe('readDocx', () => {
  it('reads a document the way Word saves one', async () => {
    expect(shape(await readDocx(wordLike()))).toEqual([
      // A French Word's heading style, known by its name.
      'heading2: SYS-12 — Démarrage',
      // The insertion read, the deletion not, the tab kept, the hyperlink's words kept.
      'normal: Le système doit démarrer en 3 s\t(voir annexe).',
      // A field's result, not its code.
      'normal: Page 4',
      // A text box is an aside, and its fallback copy is the same aside twice.
      'normal: Texte courant.',
      // A company style based on a heading is a heading.
      'heading2: SYS-13',
      'heading1: Chapitre à la main',
      // What a content control holds is the document.
      'quote: Parce que.',
      'list: un point',
      [
        ['ID', 'Texte'],
        ['SYS-14', 'Ligne un\nligne deux']
      ],
      'normal: Deux\nlignes'
    ])
  })

  // The writer and the reader have to agree, or an export cannot come back.
  it('reads back what the plugin’s own export writes', async () => {
    const bytes = buildDocx({
      title: 'Spécification',
      blocks: [
        para('Title', 'Spécification'),
        para('Heading1', 'THERM'),
        para('Heading2', 'REQ-THERM-0001 — Maintien'),
        para('Meta', 'Approuvée · Performance'),
        para('Normal', 'La soute doit rester à 5 °C.\nEn toute saison & < 30 °C.'),
        para('Quote', 'Parce que.'),
        para('Bullet', 'un point'),
        {
          kind: 'table',
          header: [
            { runs: [{ text: 'ID' }], width: 2000 },
            { runs: [{ text: 'Énoncé' }], width: 7000 }
          ],
          rows: [
            [
              { runs: [{ text: 'REQ-THERM-0001', bold: true }], width: 2000 },
              { runs: [{ text: 'Mot.' }, { text: '\nen retard', italic: true }], width: 7000 }
            ]
          ]
        }
      ]
    })
    expect(shape(await readDocx(bytes))).toEqual([
      'title: Spécification',
      'heading1: THERM',
      'heading2: REQ-THERM-0001 — Maintien',
      'meta: Approuvée · Performance',
      'normal: La soute doit rester à 5 °C.\nEn toute saison & < 30 °C.',
      'quote: Parce que.',
      'list: • un point',
      [
        ['ID', 'Énoncé'],
        ['REQ-THERM-0001', 'Mot.\nen retard']
      ],
      // The empty paragraph Word wants after a table.
      'normal: '
    ])
  })

  it('says a file is not a Word document', async () => {
    await expect(readDocx(zip([{ name: 'a.txt', data: utf8('x') }]))).rejects.toThrow(/document\.xml/)
  })
})
