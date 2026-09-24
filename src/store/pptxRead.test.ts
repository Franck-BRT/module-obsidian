import { describe, expect, it } from 'vitest'
import { buildPptx } from './pptx'
import { readPptx } from './pptxRead'
import { utf8, zip } from './zip'

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

const slide = (tree: string) =>
  `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>${tree}</p:spTree></p:cSld></p:sld>`

const shape = (name: string, placeholder: string | null, y: number | null, body: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${name}"/><p:cNvSpPr/><p:nvPr>${placeholder ? `<p:ph type="${placeholder}"/>` : ''}</p:nvPr></p:nvSpPr>` +
  `<p:spPr>${y === null ? '' : `<a:xfrm><a:off x="0" y="${y * 12700}"/><a:ext cx="1" cy="1"/></a:xfrm>`}</p:spPr>` +
  `<p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>`

const run = (text: string) => `<a:r><a:rPr lang="fr-FR"/><a:t>${text}</a:t></a:r>`

/**
 * A deck the way PowerPoint saves one, written here by hand: slides listed in an order
 * that is not their file names', a title placeholder with no position of its own, a
 * soft return written as a vertical tab and one written as a break, a field, a bullet,
 * a group, a slide number, a table with a merged cell, and content wrapped for older
 * readers.
 */
function powerPointLike(): Uint8Array {
  const first = slide(
    shape('Titre 1', 'title', null, `<a:p>${run('SYS-12 — Démarrage')}</a:p>`) +
      shape(
        'Espace réservé du contenu 2',
        'body',
        150,
        `<a:p>${run('Le système doit\u000Bdémarrer')}<a:br/>${run('en 3 s.')}</a:p><a:p><a:pPr><a:buChar char="•"/></a:pPr>${run('sans bruit')}</a:p>`
      ) +
      shape('Numéro de diapositive 3', 'sldNum', 500, `<a:p><a:fld id="{1}" type="slidenum"><a:t>2</a:t></a:fld></a:p>`)
  )
  const second = slide(
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="Groupe"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape('Note', null, 400, `<a:p>${run('dans un groupe')}</a:p>`)}</p:grpSp>` +
      `<mc:AlternateContent xmlns:mc="m"><mc:Choice>${shape('Nouveau', null, 420, `<a:p>${run('choisi')}</a:p>`)}</mc:Choice><mc:Fallback>${shape('Ancien', null, 420, `<a:p>${run('repli')}</a:p>`)}</mc:Fallback></mc:AlternateContent>` +
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Tableau"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="${100 * 12700}"/><a:ext cx="1" cy="1"/></p:xfrm>` +
      `<a:graphic><a:graphicData uri="t"><a:tbl><a:tr h="1"><a:tc><a:txBody><a:bodyPr/><a:p>${run('ID')}</a:p></a:txBody></a:tc><a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:p>${run('Texte')}</a:p></a:txBody></a:tc><a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p>${run('fusionnée')}</a:p></a:txBody></a:tc></a:tr>` +
      `<a:tr h="1"><a:tc><a:txBody><a:bodyPr/><a:p>${run('SYS-13')}</a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p>${run('Un')}</a:p><a:p>${run('deux')}</a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  )
  const rel = (id: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${target}"/>`
  return zip([
    {
      name: 'ppt/presentation.xml',
      data: utf8(
        `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId9"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`
      )
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: utf8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId3', 'slides/slide1.xml')}${rel('rId9', '/ppt/slides/slide7.xml')}</Relationships>`
      )
    },
    { name: 'ppt/slides/slide1.xml', data: utf8(second) },
    { name: 'ppt/slides/slide7.xml', data: utf8(first) }
  ])
}

describe('readPptx', () => {
  it('reads the slides in the order the deck shows them, not their files’', async () => {
    const slides = await readPptx(powerPointLike())
    expect(slides[0].shapes[0]).toMatchObject({ kind: 'text', name: 'Titre 1', placeholder: 'title' })
    expect(slides[1].shapes[0]).toMatchObject({ kind: 'text', name: 'Note' })
  })

  it('reads a slide’s text the way PowerPoint writes it', async () => {
    const [first] = await readPptx(powerPointLike())
    expect(first.shapes).toEqual([
      {
        kind: 'text',
        name: 'Titre 1',
        placeholder: 'title',
        paragraphs: [{ text: 'SYS-12 — Démarrage', bullet: false }]
      },
      {
        kind: 'text',
        name: 'Espace réservé du contenu 2',
        placeholder: 'body',
        x: 0,
        y: 150,
        paragraphs: [
          // A soft return as a vertical tab and one as a break: both a line break.
          { text: 'Le système doit\ndémarrer\nen 3 s.', bullet: false },
          { text: 'sans bruit', bullet: true }
        ]
      },
      {
        kind: 'text',
        name: 'Numéro de diapositive 3',
        placeholder: 'sldNum',
        x: 0,
        y: 500,
        paragraphs: [{ text: '2', bullet: false }]
      }
    ])
  })

  it('reads a group’s shapes, the first of two choices, and a table', async () => {
    const [, second] = await readPptx(powerPointLike())
    expect(second.shapes.map((shape) => (shape.kind === 'table' ? shape.rows : shape.paragraphs[0].text))).toEqual([
      'dans un groupe',
      'choisi',
      [
        // A merged cell holds nothing of its own.
        ['ID', 'Texte', ''],
        ['SYS-13', 'Un\ndeux', '']
      ]
    ])
  })

  // The writer and the reader have to agree, or an export cannot come back.
  it('reads back what the plugin’s own export writes', async () => {
    const bytes = buildPptx({
      title: 'Revue',
      slides: [
        {
          eyebrow: 'REQ-A-0001',
          title: 'Trappe',
          body: [{ text: 'Deux\nlignes & <signes>' }, { text: 'Point', bullet: true }],
          footer: 'Brouillon'
        }
      ]
    })
    const [only] = await readPptx(bytes)
    expect(only.shapes.map((shape) => (shape.kind === 'text' ? [shape.name, shape.paragraphs] : null))).toEqual([
      ['Eyebrow', [{ text: 'REQ-A-0001', bullet: false }]],
      ['Title', [{ text: 'Trappe', bullet: false }]],
      [
        'Body',
        [
          { text: 'Deux\nlignes & <signes>', bullet: false },
          { text: 'Point', bullet: true }
        ]
      ],
      ['Footer', [{ text: 'Brouillon', bullet: false }]]
    ])
  })

  it('says a file is not a deck', async () => {
    await expect(readPptx(zip([{ name: 'a.txt', data: utf8('x') }]))).rejects.toThrow(/presentation\.xml/)
  })
})
