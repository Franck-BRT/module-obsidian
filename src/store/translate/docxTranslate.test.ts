import { describe, expect, it } from 'vitest'
import { buildDocx, para } from '../docx'
import { readDocx } from '../docxRead'
import { unzip } from '../unzip'
import {
  decodeXml,
  openDocxForTranslation,
  paragraphText,
  rewriteParagraphs,
  scanParagraphs,
  setProofingLanguage,
  translatedName,
  worthTranslating
} from './docxTranslate'

const body = (inner: string): string =>
  `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${inner}</w:body></w:document>`

describe('the text of a Word paragraph', () => {
  it('is gathered from its runs, its tabs and breaks kept, the tab stops of its style not', () => {
    const xml = body(
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Note:</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> the contractor </w:t></w:r>' +
        '<w:r><w:t>shall &amp; must</w:t><w:br/><w:t>comply.</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>'
    )
    const [paragraph] = scanParagraphs(xml)
    expect(paragraphText(paragraph)).toBe('Note:\t the contractor shall & must\ncomply.')
  })

  it('leaves a field’s code and result out, and a text box is a paragraph of its own', () => {
    const xml = body(
      '<w:p><w:r><w:t>See page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText> PAGEREF _Toc1 </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t>12</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:r><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>Inside the box</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></w:r>' +
        '<w:fldSimple w:instr="DATE"><w:r><w:t>01/10/2026</w:t></w:r></w:fldSimple></w:p>'
    )
    const texts = scanParagraphs(xml).map(paragraphText)
    expect(texts).toEqual(['Inside the box', 'See page '])
  })

  it('knows what is worth translating, and reads XML entities', () => {
    expect(worthTranslating('1.2.3')).toBe(false)
    expect(worthTranslating('—')).toBe(false)
    expect(worthTranslating('Scope')).toBe(true)
    expect(decodeXml('a &lt;b&gt; &#233;t&#xE9; &quot;x&quot;')).toBe('a <b> été "x"')
  })
})

describe('a Word paragraph translated', () => {
  it('goes whole into the run that held most of it, its tabs and breaks with it, the rest emptied', () => {
    const xml = body(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Note:</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> the contractor shall comply.</w:t></w:r>' +
        '<w:r><w:drawing>IMG</w:drawing></w:r></w:p>'
    )
    const paragraphs = scanParagraphs(xml)
    const out = rewriteParagraphs(xml, paragraphs, (text) =>
      text === 'Note:\t the contractor shall comply.'
        ? 'Remarque :\tl’entrepreneur doit s’y conformer & <le> faire.'
        : undefined
    )
    expect(out).toContain('<w:r><w:rPr><w:b/></w:rPr></w:r>')
    expect(out).toContain(
      '<w:r><w:t xml:space="preserve">Remarque :</w:t><w:tab/><w:t xml:space="preserve">l’entrepreneur doit s’y conformer &amp; &lt;le&gt; faire.</w:t></w:r>'
    )
    expect(out).toContain('<w:drawing>IMG</w:drawing>')
  })

  it('stays as it is when no translation is given', () => {
    const xml = body('<w:p><w:r><w:t>Scope</w:t></w:r></w:p>')
    expect(rewriteParagraphs(xml, scanParagraphs(xml), () => undefined)).toBe(xml)
  })

  it('has its proofing language set', () => {
    expect(setProofingLanguage('<w:lang w:val="en-US" w:eastAsia="zh-CN"/>', 'fr-FR')).toBe(
      '<w:lang w:val="fr-FR" w:eastAsia="zh-CN"/>'
    )
  })
})

describe('a Word document translated', () => {
  it('lists each text once, and is written back translated, its other parts untouched', async () => {
    const source = buildDocx({
      title: 'Spec',
      blocks: [
        para('Heading1', 'Scope'),
        para('Normal', 'The contractor shall supply the drawings.'),
        para('Normal', 'Scope'),
        para('Normal', '4.2.1'),
        {
          kind: 'table',
          header: [
            { runs: [{ text: 'Item' }], width: 3000 },
            { runs: [{ text: 'Due date' }], width: 3000 }
          ],
          rows: [[{ runs: [{ text: 'Plans', bold: true }, { text: ' and notes' }], width: 6000 }]]
        }
      ]
    })
    const opened = await openDocxForTranslation(source, 'fr')
    expect(opened.texts).toEqual(
      expect.arrayContaining(['Scope', 'The contractor shall supply the drawings.', 'Item', 'Due date'])
    )
    expect(opened.texts.filter((text) => text === 'Scope')).toHaveLength(1)
    expect(opened.texts).not.toContain('4.2.1')
    const french: Record<string, string> = {
      Scope: 'Objet',
      'The contractor shall supply the drawings.': 'L’entrepreneur doit fournir les plans.',
      Item: 'Élément',
      'Due date': 'Échéance'
    }
    const out = opened.build((text) => french[text])
    const blocks = await readDocx(out)
    const all = JSON.stringify(blocks)
    expect(all).toContain('Objet')
    expect(all).toContain('L’entrepreneur doit fournir les plans.')
    expect(all).toContain('Échéance')
    expect(all).toContain('4.2.1')
    expect(all).not.toContain('Due date')
    const names = (await unzip(source)).map((entry) => entry.name)
    expect((await unzip(out)).map((entry) => entry.name)).toEqual(names)
  })

  it('is refused when it is no Word document', async () => {
    const { zip, utf8 } = await import('../zip')
    await expect(openDocxForTranslation(zip([{ name: 'a.txt', data: utf8('x') }]), 'fr')).rejects.toThrow()
  })
})

describe('a translation’s name', () => {
  it('is the source’s, with the language after it', () => {
    expect(translatedName('Library/_files/CCTP lot 2.docx', 'fr')).toBe('CCTP lot 2 (FR).docx')
    expect(translatedName('Spec', 'en')).toBe('Spec (EN)')
  })
})
