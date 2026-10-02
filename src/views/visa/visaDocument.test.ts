import { beforeAll, describe, expect, it } from 'vitest'
import { setLocale } from '../../i18n'
import { buildDocx } from '../../store/docx'
import { buildPdf, pdfString } from '../../store/pdf'
import type { VisaSheet } from '../../store/visa/visaSheet'
import { visaDocument, visaNote, type VisaContext } from './visaDocument'

beforeAll(() => setLocale('fr'))

const sheet: VisaSheet = {
  verdict: 'rejected',
  summary: 'Classe de béton et enrobage non conformes au CCTP.',
  observations: [
    {
      article: '§ 2.1',
      observation: 'Béton C25/30 au lieu de C30/37 XC2.',
      severity: 'blocking',
      source: 'CCTP art. 3.2'
    },
    { article: '§ 2.3', observation: 'Enrobage 30 mm | requis 40 mm.', severity: 'major', source: 'CCTP art. 3.4' }
  ]
}
const context: VisaContext = {
  project: 'Bâtiment B12',
  document: {
    title: 'Note de calcul radier',
    reference: 'NDC-04',
    issue: 'B',
    issuer: 'Garonne Bâtiment',
    file: 'NDC-04.pdf'
  },
  reviewer: 'Anne Leroy',
  date: '2026-10-02',
  references: ['CCTP Lot 02'],
  requirements: ['REQ-012']
}

describe('the visa sheet', () => {
  it('reads as a document with its verdict and its table, for Word and PDF', () => {
    const doc = visaDocument(sheet, context)
    expect(doc.title).toBe('Fiche de visa — NDC-04 — Note de calcul radier — indice B')
    const table = doc.blocks.find((block) => block.kind === 'table')
    expect(table?.kind === 'table' && table.rows).toHaveLength(2)
    expect(table?.kind === 'table' && table.header.reduce((sum, cell) => sum + cell.width, 0)).toBe(9638)
    expect(JSON.stringify(doc.blocks)).toContain('Refusé')
    expect(buildDocx(doc).length).toBeGreaterThan(1000)
    const pdf = Array.from(buildPdf(doc), (byte) => String.fromCharCode(byte)).join('')
    expect(pdf).toContain(pdfString('Bloquante').slice(1, -1))
  })

  it('is kept as a note with its properties, its table and links to its files', () => {
    const note = visaNote(sheet, context, {
      document: '[[Work/B12/NDC-04.md|Note de calcul radier]]',
      files: ['[[Work/B12/Visas/Fiche.pdf|PDF]]']
    })
    expect(note).toContain('verdict: rejected')
    expect(note).toContain('## Avis : Refusé')
    expect(note).toContain('| B1 | § 2.1 | Béton C25/30 au lieu de C30/37 XC2. | **Bloquante** | CCTP art. 3.2 |')
    expect(note).toContain('observations:\n  - {"ref":"B1"')
    // A bar in an observation does not cut its row.
    expect(note).toContain('Enrobage 30 mm \\| requis 40 mm.')
    expect(note).toContain('[[Work/B12/Visas/Fiche.pdf|PDF]]')
  })
})
