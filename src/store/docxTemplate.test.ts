import { describe, expect, it } from 'vitest'
import { fieldOf, isRowField } from './delivery'
import { fillDocxPart, fillDocxTemplate, joinSplitFields, type DocxFields } from './docxTemplate'
import { unzip } from './unzip'
import { utf8, zip } from './zip'

const FIELDS: DocxFields = {
  fieldOf: (name) => fieldOf(name),
  isRowField: (field) => isRowField(field as never),
  note: { numero: 'BL-2026-004', destinataire: 'MOA Ville', remarque: 'Pour visa\net diffusion', projet: 'A & B' },
  rows: [
    { reference: 'GC-NC-001', titre: 'Note de calcul' },
    { reference: 'GC-PL-002', titre: 'Plan <RDC>' }
  ]
}

const run = (text: string): string => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`
const p = (...runs: string[]): string => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${runs.join('')}</w:p>`
const texts = (xml: string): string[] =>
  [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((match) =>
    [...match[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('')
  )

describe('joinSplitFields', () => {
  it('gathers a field Word cut over several runs into the run it starts in', () => {
    const xml = p(run('N° {'), run('{num'), '<w:proofErr w:type="spellStart"/>', run('ero}} du '), run('{{date}}'))
    const joined = joinSplitFields(xml)
    expect(joined).toContain('>N° {{numero}}</w:t>')
    expect(joined).toContain('> du </w:t>')
    expect(texts(joined)).toEqual(['N° {{numero}} du {{date}}'])
  })

  it('leaves a paragraph with no field as it is', () => {
    const xml = p(run('Rien'), run(' ici'))
    expect(joinSplitFields(xml)).toBe(xml)
  })
})

describe('fillDocxPart', () => {
  it('writes a table row naming a document’s field once for each document, and the note’s fields', () => {
    const row = (a: string, b: string): string => `<w:tr><w:tc>${p(run(a))}</w:tc><w:tc>${p(run(b))}</w:tc></w:tr>`
    const xml = `<w:body>${p(run('Bordereau {{numéro}} — '), run('{{projet}}'))}<w:tbl>${row('Réf', 'Titre')}${row('{{ref', 'erence}}')}</w:tbl>${p(run('{{remarque}}'))}${p(run('{{inconnu}}'))}</w:body>`
    // The second row's field is cut: put back first.
    const filled = fillDocxPart(
      xml.replace(
        '{{ref</w:t></w:r></w:p></w:tc><w:tc><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">erence}}',
        '{{reference}}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{{titre}}'
      ),
      FIELDS
    )
    expect(texts(filled)).toEqual([
      'Bordereau BL-2026-004 — A &amp; B',
      'Réf',
      'Titre',
      'GC-NC-001',
      'Note de calcul',
      'GC-PL-002',
      'Plan &lt;RDC&gt;',
      'Pour visaet diffusion',
      '{{inconnu}}'
    ])
    expect(filled).toContain('Pour visa</w:t><w:br/><w:t xml:space="preserve">et diffusion')
    expect(filled.match(/<w:tr>/g)).toHaveLength(3)
  })

  it('repeats a paragraph outside a table naming a document’s field', () => {
    expect(texts(fillDocxPart(p(run('- {{reference}} : {{titre}}')), FIELDS))).toEqual([
      '- GC-NC-001 : Note de calcul',
      '- GC-PL-002 : Plan &lt;RDC&gt;'
    ])
  })
})

describe('fillDocxTemplate', () => {
  it('fills the body, the headers and the footers, and leaves the rest as it was', async () => {
    const image = new Uint8Array([1, 2, 3])
    const bytes = zip([
      { name: '[Content_Types].xml', data: utf8('<Types/>') },
      { name: 'word/document.xml', data: utf8(`<w:document><w:body>${p(run('{{numero}}'))}</w:body></w:document>`) },
      { name: 'word/header1.xml', data: utf8(`<w:hdr>${p(run('{{destinataire}}'))}</w:hdr>`) },
      { name: 'word/media/logo.png', data: image }
    ])
    const out = await unzip(await fillDocxTemplate(bytes, FIELDS))
    const read = (name: string): string => new TextDecoder().decode(out.find((entry) => entry.name === name)?.data)
    expect(out.map((entry) => entry.name)).toEqual([
      '[Content_Types].xml',
      'word/document.xml',
      'word/header1.xml',
      'word/media/logo.png'
    ])
    expect(read('word/document.xml')).toContain('>BL-2026-004<')
    expect(read('word/header1.xml')).toContain('>MOA Ville<')
    expect([...(out.find((entry) => entry.name === 'word/media/logo.png')?.data ?? [])]).toEqual([1, 2, 3])
  })

  it('refuses what is not a Word document', async () => {
    await expect(fillDocxTemplate(utf8('pas un zip'), FIELDS)).rejects.toThrow('not a Word document')
  })
})

describe('an empty field alone in its paragraph', () => {
  it('takes the paragraph out, but not a table cell’s', () => {
    const empty: DocxFields = { ...FIELDS, note: { ...FIELDS.note, remarque: '' } }
    const cell = `<w:tbl><w:tr><w:tc>${p(run('{{remarque}}'))}</w:tc></w:tr></w:tbl>`
    const filled = fillDocxPart(`<w:body>${p(run('A'))}${p(run('{{remarque}}'))}${cell}${p(run('B'))}</w:body>`, empty)
    expect(texts(filled)).toEqual(['A', '', 'B'])
  })
})
