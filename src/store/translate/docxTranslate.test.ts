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

const slideXml = (inner: string): string =>
  `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree><p:sp><p:txBody>${inner}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`

describe('a PowerPoint paragraph', () => {
  it('is gathered from its runs, its line breaks kept, the slide number left out', async () => {
    const { scanParagraphs: scan } = await import('./docxTranslate')
    const xml = slideXml(
      '<a:p><a:r><a:rPr lang="en-US" b="1"/><a:t>Antenna</a:t></a:r><a:r><a:rPr lang="en-US"/><a:t> maintenance plan</a:t></a:r>' +
        '<a:br><a:rPr lang="en-US"/></a:br><a:r><a:rPr lang="en-US"/><a:t>Issue 2</a:t></a:r></a:p>' +
        '<a:p><a:fld id="{1}" type="slidenum"><a:rPr lang="en-US"/><a:t>3</a:t></a:fld></a:p>'
    )
    expect(scan(xml, 'drawing').map(paragraphText)).toEqual(['Antenna maintenance plan\nIssue 2'])
  })

  it('is written back as runs like the one that held most of it, a break between its lines, the rest taken out', async () => {
    const { scanParagraphs: scan, rewriteParagraphs: rewrite } = await import('./docxTranslate')
    const xml = slideXml(
      '<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" b="1"/><a:t>Plan</a:t></a:r><a:r><a:rPr lang="en-US" sz="2400"/><a:t> for the antenna &amp; mast</a:t></a:r>' +
        '<a:br/><a:r><a:rPr lang="en-US"/><a:t>Issue 2</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>'
    )
    const out = rewrite(xml, scan(xml, 'drawing'), () => 'Plan de l’antenne & du mât\nÉdition 2', 'drawing')
    expect(out).toContain(
      '<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="2400"/><a:t>Plan de l’antenne &amp; du mât</a:t></a:r><a:br/><a:r><a:rPr lang="en-US" sz="2400"/><a:t>Édition 2</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>'
    )
    expect(out).not.toContain('b="1"')
  })

  it('has its language set on its text', async () => {
    const { setDrawingLanguage } = await import('./docxTranslate')
    expect(setDrawingLanguage('<a:rPr lang="en-US" altLang="en-GB" b="1"/><a:endParaRPr lang="en-US"/>', 'fr-FR')).toBe(
      '<a:rPr lang="fr-FR" altLang="en-GB" b="1"/><a:endParaRPr lang="fr-FR"/>'
    )
  })
})

describe('a PowerPoint deck translated', () => {
  it('lists its slides’ texts once, and is written back translated, every part kept', async () => {
    const { buildPptx } = await import('../pptx')
    const source = buildPptx({
      title: 'Review',
      slides: [
        {
          title: 'Antenna maintenance',
          eyebrow: 'Ground segment',
          body: [{ text: 'Preventive visit every 6 months', bullet: true }],
          footer: 'CNES — Issue 2'
        },
        {
          title: 'Deliverables',
          body: [
            { text: 'Maintenance plan', bullet: true },
            { text: 'Visit report', bullet: true }
          ]
        }
      ]
    })
    const opened = await openDocxForTranslation(source, 'fr')
    expect(opened.texts).toEqual(
      expect.arrayContaining(['Antenna maintenance', 'Preventive visit every 6 months', 'Deliverables', 'Visit report'])
    )
    const french: Record<string, string> = {
      'Antenna maintenance': 'Maintenance de l’antenne',
      'Preventive visit every 6 months': 'Visite préventive tous les 6 mois',
      Deliverables: 'Livrables',
      'Visit report': 'Rapport de visite'
    }
    const out = opened.build((text) => french[text])
    const entries = await unzip(out)
    const slides = entries
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
      .map((entry) => new TextDecoder().decode(entry.data))
      .join('\n')
    expect(slides).toContain('Maintenance de l’antenne')
    expect(slides).toContain('Visite préventive tous les 6 mois')
    expect(slides).toContain('Rapport de visite')
    expect(slides).not.toContain('Visit report')
    expect(slides).toContain('Maintenance plan')
    expect(entries.map((entry) => entry.name)).toEqual((await unzip(source)).map((entry) => entry.name))
  })
})
