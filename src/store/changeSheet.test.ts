import { describe, expect, it } from 'vitest'
import { makeTask } from '../types'
import { emptyChange } from './change'
import { changeSheetDocument, type ChangeSheetWords } from './changeSheet'
import { buildDocx } from './docx'
import { buildPdf } from './pdf'

const words: ChangeSheetWords = {
  title: (number) => `Fiche ${number}`,
  identification: 'Identification',
  number: 'N°',
  subject: 'Objet',
  class: 'Classe',
  classLabel: (kind) => (kind === 'major' ? 'Majeure' : 'Mineure'),
  group: 'Groupe',
  groupLabel: (group) => `Groupe ${group}`,
  origin: 'Émetteur',
  owner: 'Porteur',
  due: 'Échéance',
  submittedOn: 'Émise le',
  stage: 'Étape',
  stageLabel: (stage) => stage,
  requestHeading: 'Demande',
  reason: 'Motif',
  request: 'Demande',
  affected: 'Éléments impactés',
  proposalHeading: 'Proposition',
  proposal: 'Proposition',
  impactTechnical: 'Technique',
  impactCost: 'Coût',
  impactSchedule: 'Délai',
  roundsHeading: 'CLM',
  roundColumn: 'Tour',
  round: (round) => `Tour ${round}`,
  date: 'Date',
  decision: 'Décision',
  comment: 'Observations',
  decisionLabel: (decision) => (decision === 'accepted' ? 'Acceptée' : decision),
  noRound: 'Pas encore examinée.',
  tasksHeading: 'Tâches',
  taskStatus: 'Statut',
  signatures: 'Signatures',
  signers: ['L’émetteur', 'Le porteur', 'Le président'],
  signHere: 'Nom, date et signature',
  none: '—',
  formatDate: (date) => date
}

const texts = (doc: ReturnType<typeof changeSheetDocument>): string[] =>
  doc.blocks.flatMap((block) =>
    block.kind === 'table'
      ? [...block.header, ...block.rows.flat()].map((cell) => cell.runs.map((run) => run.text).join(''))
      : [block.runs.map((run) => run.text).join('')]
  )

describe('a change’s sheet', () => {
  it('holds the request, what it touches, the proposal, the rounds, the tickets and the signatures', () => {
    const task = makeTask({
      title: 'Connecteur étanche',
      type: 'change',
      assignees: ['[[Anne Leroy]]'],
      due: '2026-11-30',
      change: emptyChange({
        number: 'DM-001',
        class: 'major',
        group: 2,
        origin: '[[Thales]]',
        reason: 'Infiltrations',
        request: 'Remplacer J12',
        proposal: 'Modèle IP67',
        impactCost: '1 200 €',
        affected: ['[[Plans/PL-002|PL-002]]', 'Harnais'],
        submittedOn: '2026-09-02',
        rounds: [{ round: 0, decision: 'accepted', date: '2026-09-10', comment: 'Lancer la PM' }]
      })
    })
    const doc = changeSheetDocument(task, words, {
      project: 'Satellite',
      tasks: [{ title: 'Commander', status: 'Fait', due: '2026-10-15' }]
    })
    const all = texts(doc)
    expect(doc.title).toBe('Fiche DM-001')
    expect(all).toEqual(
      expect.arrayContaining([
        'Satellite',
        'DM-001',
        'Majeure',
        'Groupe 2',
        'Thales',
        'Anne Leroy',
        '2026-11-30',
        'Infiltrations',
        'Remplacer J12',
        'PL-002',
        'Harnais',
        'Modèle IP67',
        '1 200 €',
        'Tour 0',
        'Acceptée',
        'Lancer la PM',
        'Commander',
        'Fait',
        'Le président'
      ])
    )
    const signatures = doc.blocks[doc.blocks.length - 1]
    expect(signatures.kind === 'table' && signatures.rows[0][0].runs[0].text).toBe('Nom, date et signature\n\n\n\n')
    expect(buildPdf(doc).length).toBeGreaterThan(500)
    expect(buildDocx(doc).length).toBeGreaterThan(500)
  })

  it('says so when the board has not examined it, and lists no tickets when there are none', () => {
    const doc = changeSheetDocument(makeTask({ title: 'X', type: 'change', change: emptyChange() }), words, {
      project: ''
    })
    const all = texts(doc)
    expect(all).toContain('Pas encore examinée.')
    expect(all).not.toContain('Tâches')
    expect(doc.title).toBe('Fiche —')
  })
})
