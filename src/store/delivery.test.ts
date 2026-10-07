import { describe, expect, it } from 'vitest'
import { makeDocument, makeTask, type DocState } from '../types'
import {
  defaultDeliveryTemplate,
  deliveryDocument,
  deliveryNote,
  deliveryRows,
  deliveryValues,
  fieldOf,
  fillDeliveryTemplate,
  nextDeliveryNumber,
  type DeliveryWords
} from './delivery'

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
  countLabel: 'Documents livrés :',
  stateLabel: (state: DocState) =>
    ({ expected: 'Attendu', received: 'Reçu', 'in-review': 'En revue', approved: 'Approuvé', obsolete: 'Obsolète' })[
      state
    ],
  day: (iso) => iso.split('-').reverse().join('/'),
  signatures: 'Signatures',
  sentBy: 'Remis par',
  receivedBy: 'Reçu par',
  signHere: 'Nom, date et signature',
  help: ['Modèle du bordereau.']
}

const doc = (title: string, over: Parameters<typeof makeDocument>[0], due?: string) =>
  makeTask({ title, type: 'document', document: makeDocument(over), ...(due ? { due } : {}) })

const TASKS = [
  doc('Plan RDC', {
    reference: 'GC-PL-002',
    issue: 'B',
    state: 'approved',
    issuer: 'BET Structure',
    file: 'Projets/B12/Documents/Plan RDC.pdf',
    versions: [{ version: 2, file: 'b.pdf', at: '2026-10-01T09:00', by: '', note: '' }]
  }),
  doc('Note de calcul', {
    reference: 'GC-NC-001',
    state: 'received',
    versions: [{ version: 1, file: 'a.pdf', at: '2026-09-01', by: '', note: '' }]
  }),
  doc('Planning', { state: 'expected' }, '2026-11-15'),
  makeTask({ title: 'Pas un document' })
]

const CONTEXT = {
  project: 'Tunnel « Est » | lot 2',
  number: 'BL-2026-004',
  date: '6 octobre 2026',
  isoDate: '2026-10-06',
  sender: 'MOE Setec',
  recipient: 'MOA Ville',
  note: 'Pour visa'
}

const fill = (template: string, note = CONTEXT.note) =>
  fillDeliveryTemplate(template, deliveryValues(deliveryRows(TASKS), { ...CONTEXT, note }, WORDS))

describe('deliveryRows', () => {
  it('lists the documents by reference, each with its state and version — its issue, else its last deposit', () => {
    const rows = deliveryRows(TASKS, (task) => (task.title === 'Plan RDC' ? 'Gros œuvre' : ''))
    expect(rows.map(({ reference, title, state, version }) => ({ reference, title, state, version }))).toEqual([
      { reference: 'GC-NC-001', title: 'Note de calcul', state: 'received', version: 'v1' },
      { reference: 'GC-PL-002', title: 'Plan RDC', state: 'approved', version: 'B' },
      { reference: '', title: 'Planning', state: 'expected', version: '' }
    ])
    expect(rows[1]).toMatchObject({
      issuer: 'BET Structure',
      lot: 'Gros œuvre',
      file: 'Plan RDC.pdf',
      deposited: '2026-10-01'
    })
    expect(rows[2].due).toBe('2026-11-15')
  })

  it('puts the documents without a reference last', () => {
    const rows = deliveryRows([doc('Sans référence', {}), doc('Plan', { reference: 'A-01' })])
    expect(rows.map((row) => row.title)).toEqual(['Plan', 'Sans référence'])
  })
})

describe('nextDeliveryNumber', () => {
  it('numbers past those given in the year, from 001', () => {
    expect(nextDeliveryNumber([], '2026')).toBe('BL-2026-001')
    expect(nextDeliveryNumber(['BL-2026-003', 'BL-2025-009', 'BL-2026-001', 'autre'], '2026')).toBe('BL-2026-004')
  })
})

describe('the fields of a template', () => {
  it('are known by their French or English names, accents, case and spaces aside', () => {
    expect(fieldOf('numéro')).toBe('numero')
    expect(fieldOf('Number')).toBe('numero')
    expect(fieldOf(' Référence ')).toBe('reference')
    expect(fieldOf('échéance')).toBe('echeance')
    expect(fieldOf('due')).toBe('echeance')
    expect(fieldOf('indice')).toBe('version')
    expect(fieldOf('inconnu')).toBeNull()
  })
})

describe('fillDeliveryTemplate', () => {
  it('writes a line naming a document’s field once for each document', () => {
    const filled = fill(
      '| Réf | Titre | Lot |\n| --- | --- | --- |\n| {{n}}. {{reference}} | {{titre}} | {{échéance}} |'
    )
    expect(filled.split('\n')).toEqual([
      '| Réf | Titre | Lot |',
      '| --- | --- | --- |',
      '| 1. GC-NC-001 | Note de calcul | — |',
      '| 2. GC-PL-002 | Plan RDC | — |',
      '| 3. — | Planning | 15/11/2026 |'
    ])
  })

  it('puts in the note’s fields, made safe for a table and for emphasis', () => {
    const filled = fill('Projet : {{projet}}\n\n| {{projet}} |\n| --- |')
    expect(filled).toContain('Projet : Tunnel « Est » \\| lot 2')
    expect(fill('{{numero}} pour {{destinataire}}')).toBe('BL-2026-004 pour MOA Ville')
  })

  it('takes out a line left with nothing but its marks, and leaves an unknown field to be seen', () => {
    expect(fill('> {{remarque}}\n\nFin', '')).toBe('Fin')
    expect(fill('> {{remarque}}', 'Pour visa\net diffusion')).toBe('> Pour visa\n> et diffusion')
    expect(fill('{{inconnu}} {{nombre}}')).toBe('{{inconnu}} 3')
  })

  it('leaves out the template’s comment and properties', () => {
    expect(fill('---\na: 1\n---\n%% aide {{numero}} %%\nN° {{numero}}')).toBe('N° BL-2026-004')
  })
})

describe('the default template', () => {
  const template = defaultDeliveryTemplate(WORDS)

  it('makes the table of reference, title, state and version, then the blocks to sign', () => {
    const document = deliveryDocument(fill(template), CONTEXT, WORDS)
    const [table, signatures] = document.blocks.filter((block) => block.kind === 'table')
    if (table?.kind !== 'table' || signatures?.kind !== 'table') throw new Error('no tables')
    expect(table.header.map((cell) => cell.runs[0].text)).toEqual(['Référence', 'Titre', 'État', 'Version'])
    expect(table.rows.map((row) => row.map((cell) => cell.runs[0].text))).toEqual([
      ['GC-NC-001', 'Note de calcul', 'Reçu', 'v1'],
      ['GC-PL-002', 'Plan RDC', 'Approuvé', 'B'],
      ['—', 'Planning', 'Attendu', '—']
    ])
    expect(signatures.header.map((cell) => cell.runs[0].text)).toEqual(['Remis par', 'Reçu par'])
    const texts = document.blocks.flatMap((block) =>
      block.kind === 'p' ? [block.runs.map((run) => run.text).join('')] : []
    )
    expect(texts).toContain('N° BL-2026-004 du 6 octobre 2026')
    expect(texts).toContain('Émetteur : MOE Setec\nDestinataire : MOA Ville')
    expect(texts).toContain('Pour visa')
    expect(texts).toContain('Documents livrés : 3')
  })

  it('reads the same with its English field names', () => {
    expect(fill(defaultDeliveryTemplate(WORDS, true))).toBe(fill(template))
  })

  it('tells its fields in its comment', () => {
    expect(template).toMatch(/^%%\nModèle du bordereau\.\n\n\{\{numero\}\}/)
  })
})

describe('deliveryNote', () => {
  it('writes its properties safely, whatever the project is called, and the filled template', () => {
    const note = deliveryNote(fill(defaultDeliveryTemplate(WORDS)), CONTEXT, 3, [
      'P/Bordereaux/BL.docx',
      'P/Bordereaux/BL.pdf'
    ])
    expect(note).toContain('number: BL-2026-004')
    expect(note).toMatch(/project: .*Tunnel « Est » \| lot 2/)
    expect(note).toContain('| Référence | Titre | État | Version |')
    expect(note).toContain('| GC-PL-002 | Plan RDC | Approuvé | B |')
    expect(note).toContain('| — | Planning | Attendu | — |')
    expect(note).toContain('[[P/Bordereaux/BL.docx]] · [[P/Bordereaux/BL.pdf]]')
    expect(note).not.toContain('%%')
  })
})
