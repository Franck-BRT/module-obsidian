import { describe, expect, it } from 'vitest'
import { makeDocument, makeTask, type DocState } from '../types'
import { deliveryDocument, deliveryNote, deliveryRows, nextDeliveryNumber, type DeliveryWords } from './delivery'

const WORDS: DeliveryWords = {
  title: 'Bordereau de livraison',
  numberDate: (number, date) => `N° ${number} du ${date}`,
  project: 'Projet :',
  sender: 'Émetteur :',
  recipient: 'Destinataire :',
  reference: 'Référence',
  documentTitle: 'Titre',
  state: 'État',
  version: 'Version',
  count: (count) => `${count} document(s)`,
  stateLabel: (state: DocState) =>
    ({ expected: 'Attendu', received: 'Reçu', 'in-review': 'En revue', approved: 'Approuvé', obsolete: 'Obsolète' })[
      state
    ],
  signatures: 'Signatures',
  sentBy: 'Remis par',
  receivedBy: 'Reçu par',
  signHere: 'Nom, date et signature'
}

const doc = (title: string, over: Parameters<typeof makeDocument>[0]) =>
  makeTask({ title, type: 'document', document: makeDocument(over) })

const TASKS = [
  doc('Plan RDC', {
    reference: 'GC-PL-002',
    issue: 'B',
    state: 'approved',
    versions: [{ version: 2, file: 'b.pdf', at: '2026-10-01', by: '', note: '' }]
  }),
  doc('Note de calcul', {
    reference: 'GC-NC-001',
    state: 'received',
    versions: [{ version: 1, file: 'a.pdf', at: '2026-09-01', by: '', note: '' }]
  }),
  doc('Planning', { state: 'expected' }),
  makeTask({ title: 'Pas un document' })
]

describe('deliveryRows', () => {
  it('lists the documents by reference, each with its state and version — its issue, else its last deposit', () => {
    expect(deliveryRows(TASKS)).toEqual([
      { reference: 'GC-NC-001', title: 'Note de calcul', state: 'received', version: 'v1' },
      { reference: 'GC-PL-002', title: 'Plan RDC', state: 'approved', version: 'B' },
      { reference: '', title: 'Planning', state: 'expected', version: '' }
    ])
  })
})

describe('nextDeliveryNumber', () => {
  it('numbers past those given in the year, from 001', () => {
    expect(nextDeliveryNumber([], '2026')).toBe('BL-2026-001')
    expect(nextDeliveryNumber(['BL-2026-003', 'BL-2025-009', 'BL-2026-001', 'autre'], '2026')).toBe('BL-2026-004')
  })
})

const CONTEXT = {
  project: 'Tunnel « Est » | lot 2',
  number: 'BL-2026-004',
  date: '6 octobre 2026',
  isoDate: '2026-10-06',
  sender: 'MOE Setec',
  recipient: 'MOA Ville',
  note: 'Pour visa'
}

describe('deliveryDocument', () => {
  it('is the table of reference, title, state and version, then the blocks to sign', () => {
    const document = deliveryDocument(deliveryRows(TASKS), CONTEXT, WORDS)
    const [table, signatures] = document.blocks.filter((block) => block.kind === 'table')
    if (table?.kind !== 'table' || signatures?.kind !== 'table') throw new Error('no tables')
    expect(table.header.map((cell) => cell.runs[0].text)).toEqual(['Référence', 'Titre', 'État', 'Version'])
    expect(table.rows.map((row) => row.map((cell) => cell.runs[0].text))).toEqual([
      ['GC-NC-001', 'Note de calcul', 'Reçu', 'v1'],
      ['GC-PL-002', 'Plan RDC', 'Approuvé', 'B'],
      ['—', 'Planning', 'Attendu', '—']
    ])
    expect(signatures.header.map((cell) => cell.runs[0].text)).toEqual(['Remis par', 'Reçu par'])
    const texts = document.blocks.flatMap((block) => (block.kind === 'p' ? block.runs.map((run) => run.text) : []))
    expect(texts).toContain('N° BL-2026-004 du 6 octobre 2026')
    expect(texts).toContain('Destinataire : MOA Ville')
    expect(texts).toContain('Pour visa')
  })
})

describe('deliveryNote', () => {
  it('writes its properties safely, whatever the project is called, and the same table', () => {
    const note = deliveryNote(deliveryRows(TASKS), CONTEXT, WORDS, ['P/Bordereaux/BL.docx', 'P/Bordereaux/BL.pdf'])
    expect(note).toContain('number: BL-2026-004')
    expect(note).toMatch(/project: .*Tunnel « Est » \| lot 2/)
    expect(note).toContain('| Référence | Titre | État | Version |')
    expect(note).toContain('| GC-PL-002 | Plan RDC | Approuvé | B |')
    expect(note).toContain('| — | Planning | Attendu | — |')
    expect(note).toContain('[[P/Bordereaux/BL.docx]] · [[P/Bordereaux/BL.pdf]]')
  })
})

describe('the order of the delivery note', () => {
  it('puts the documents without a reference last', () => {
    const rows = deliveryRows([doc('Sans référence', {}), doc('Plan', { reference: 'A-01' })])
    expect(rows.map((row) => row.title)).toEqual(['Plan', 'Sans référence'])
  })
})
