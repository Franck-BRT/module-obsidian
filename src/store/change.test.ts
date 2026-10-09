import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_STATUSES, makeTask, type StatusConfig, type TaskChange } from '../types'
import {
  awaitedRound,
  boardAgenda,
  boardDocument,
  boardNote,
  changeCounts,
  changeStage,
  emptyChange,
  nextChangeNumber,
  orderChanges,
  recordDecision,
  statusForChange,
  type BoardWords
} from './change'
import type { App } from 'obsidian'
import { makeFakeApp } from '../../test/fakeVault'
import { ProjectStore } from './ProjectStore'
import { projectMetrics } from './Metrics'
import { buildDocx, DOCX_TEXT_WIDTH } from './docx'
import { buildPdf } from './pdf'

const change = (over: Partial<TaskChange> = {}): TaskChange => emptyChange(over)
const ticket = (number: string, over: Partial<TaskChange> = {}, title = number) =>
  makeTask({ title, type: 'change', change: change({ number, ...over }) })

describe('a change before the board', () => {
  it('is a draft until it is sent, then waits for round 0', () => {
    expect(changeStage(change())).toBe('draft')
    expect(awaitedRound(change())).toBeNull()
    expect(changeStage(change({ submittedOn: '2026-10-01' }))).toBe('round0')
    expect(awaitedRound(change({ submittedOn: '2026-10-01' }))).toBe(0)
  })

  it('goes on round by round as each is accepted, and is closed after round 2', () => {
    let one = change({ submittedOn: '2026-10-01' })
    one = recordDecision(one, 0, 'accepted', '2026-10-05')
    expect(changeStage(one)).toBe('round1')
    one = recordDecision(one, 1, 'postponed', '2026-10-12', 'Chiffrage à préciser')
    expect(changeStage(one)).toBe('round1')
    one = recordDecision(one, 1, 'accepted', '2026-10-19')
    expect(changeStage(one)).toBe('round2')
    one = recordDecision(one, 2, 'incomplete', '2026-11-02')
    expect(awaitedRound(one)).toBe(2)
    one = recordDecision(one, 2, 'accepted', '2026-11-09')
    expect(changeStage(one)).toBe('closed')
    expect(awaitedRound(one)).toBeNull()
    expect(one.rounds[1]).toEqual({
      round: 1,
      decision: 'postponed',
      date: '2026-10-12',
      comment: 'Chiffrage à préciser'
    })
  })

  it('ends when refused at any round, or withdrawn', () => {
    expect(changeStage(recordDecision(change({ submittedOn: '2026-10-01' }), 0, 'rejected', '2026-10-05'))).toBe(
      'rejected'
    )
    expect(changeStage(change({ submittedOn: '2026-10-01', withdrawn: true }))).toBe('withdrawn')
  })

  it('is sent the day a decision is first taken on it, when it was not yet', () => {
    expect(recordDecision(change(), 0, 'accepted', '2026-10-05').submittedOn).toBe('2026-10-05')
  })
})

describe('the register of changes', () => {
  it('numbers the next request past the highest', () => {
    expect(nextChangeNumber([])).toBe('DM-001')
    expect(nextChangeNumber([ticket('DM-007'), ticket('DM-012'), ticket('')])).toBe('DM-013')
  })

  it('puts the ongoing first, by number', () => {
    const done = ticket('DM-001', { withdrawn: true })
    const two = ticket('DM-002', { submittedOn: '2026-10-01' })
    const ten = ticket('DM-010')
    expect(orderChanges([ten, done, two]).map((task) => task.change?.number)).toEqual(['DM-002', 'DM-010', 'DM-001'])
  })

  it('counts by stage, and gathers a sitting’s agenda by round', () => {
    const tasks = [
      ticket('DM-003', { submittedOn: '2026-10-01' }),
      ticket('DM-001', { submittedOn: '2026-10-01' }),
      ticket('DM-002', {
        submittedOn: '2026-09-01',
        rounds: [{ round: 0, decision: 'accepted', date: '2026-09-10', comment: '' }]
      }),
      ticket('DM-004')
    ]
    expect(changeCounts(tasks)).toMatchObject({ draft: 1, round0: 2, round1: 1, round2: 0 })
    const agenda = boardAgenda(tasks)
    expect(agenda[0].map((task) => task.change?.number)).toEqual(['DM-001', 'DM-003'])
    expect(agenda[1].map((task) => task.change?.number)).toEqual(['DM-002'])
    expect(agenda[2]).toEqual([])
  })

  it('gathers for a sitting of one group only that group’s changes', () => {
    const tasks = [
      ticket('DM-001', { submittedOn: '2026-10-01', group: 1 }),
      ticket('DM-002', { submittedOn: '2026-10-01', group: 2 }),
      ticket('DM-003', { submittedOn: '2026-10-01' })
    ]
    expect(boardAgenda(tasks, 2)[0].map((task) => task.change?.number)).toEqual(['DM-002'])
    expect(boardAgenda(tasks)[0]).toHaveLength(3)
  })
})

describe('a change and its ticket', () => {
  const statuses: StatusConfig[] = [
    { id: 'todo', label: 'À faire', color: '', complete: false },
    { id: 'doing', label: 'En cours', color: '', complete: false },
    { id: 'done', label: 'Fait', color: '', complete: true }
  ] as StatusConfig[]

  it('is done once over, and open again while it goes on', () => {
    const closed = recordDecision(
      recordDecision(recordDecision(change(), 0, 'accepted', 'a'), 1, 'accepted', 'b'),
      2,
      'accepted',
      'c'
    )
    expect(statusForChange(closed, 'doing', statuses)).toBe('done')
    expect(statusForChange(change(), 'done', statuses)).toBe('todo')
    expect(statusForChange(change(), 'doing', statuses)).toBeNull()
  })

  it('is kept in its note whole, and not counted as work', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const store = new ProjectStore(app, () => DEFAULT_SETTINGS)
    const project = await store.createProject('Satellite', 'Work')
    const task = ticket('DM-004', {
      origin: '[[Socotec]]',
      class: 'major',
      reason: 'Anomalie',
      request: 'Changer le connecteur',
      submittedOn: '2026-10-01',
      proposal: 'Modèle étanche IP67',
      impactCost: '1 200 €',
      group: 2,
      affected: ['PL-002', 'EX-12'],
      rounds: [{ round: 0, decision: 'accepted', date: '2026-10-05', comment: 'OK' }]
    })
    await store.insertTask(project, task)
    const reread = (await new ProjectStore(app, () => DEFAULT_SETTINGS).loadProjectByPath(project.filePath))?.tasks[0]
    expect(reread?.type).toBe('change')
    expect(reread?.change).toEqual(task.change)
    expect(
      projectMetrics({ tasks: [task], statuses: DEFAULT_STATUSES, priorities: [], today: '2026-10-09' }).total
    ).toBe(0)
  })
})

describe('a sitting kept as a note', () => {
  const words: BoardWords = {
    title: (date) => `CLM du ${date}`,
    round: (round) => `Tour ${round}`,
    roundHint: () => 'aide',
    number: 'N°',
    subject: 'Objet',
    origin: 'Émetteur',
    owner: 'Porteur',
    decision: 'Décision',
    comment: 'Observations',
    decisionLabel: (decision) =>
      ({ accepted: 'Acceptée', rejected: 'Refusée', postponed: 'Ajournée', incomplete: 'À compléter' })[decision],
    none: 'Aucune.',
    pending: 'À examiner',
    group: 'Groupe',
    groupLabel: (group) => `Groupe ${group}`,
    subtitle: (project, group) => [project, group ? `Groupe ${group}` : 'Tous les groupes'].filter(Boolean).join(' · '),
    summary: (counts, pending) =>
      `Acceptées : ${counts.accepted} · Refusées : ${counts.rejected} · À examiner : ${pending}`,
    signatures: 'Signatures',
    chair: 'Le président',
    secretary: 'Le secrétaire',
    signHere: 'Nom, date et signature',
    field: (label, value) => `${label} : ${value}`
  }
  const lines = () => [
    {
      task: ticket('DM-001', { origin: 'MOE | lot 2', group: 2 as const }, 'Connecteur'),
      round: 0 as const,
      decision: 'accepted' as const,
      comment: 'Lancer la PM'
    },
    { task: ticket('DM-002', {}, 'Câblage'), round: 1 as const, decision: null, comment: '' }
  ]

  it('lists by round each change with its decision, or as to examine', () => {
    const note = boardNote('2026-10-09', lines(), words, { project: 'Satellite', group: 2 })
    expect(note).toContain('type: clm')
    expect(note).toContain('group: 2')
    expect(note).toContain('# CLM du 2026-10-09')
    expect(note).toContain('*Satellite · Groupe 2*')
    expect(note).toContain('| DM-001 | Connecteur | Groupe 2 | MOE / lot 2 | — | Acceptée | Lancer la PM |')
    expect(note).toContain('| DM-002 | Câblage | — | — | — | À examiner | — |')
    expect(note).toMatch(/## Tour 2\n\n\*aide\*\n\nAucune\./)
    expect(note).toContain('Acceptées : 1 · Refusées : 0 · À examiner : 1')
  })

  it('is a record to sign in Word and PDF: a table by round, the decisions counted, the signatures', () => {
    const document = boardDocument('2026-10-09', lines(), words, { project: 'Satellite', group: null })
    const texts = (block: (typeof document.blocks)[number]): string[] =>
      block.kind === 'table'
        ? [...block.header, ...block.rows.flat()].map((cell) => cell.runs.map((run) => run.text).join(''))
        : [block.runs.map((run) => run.text).join('')]
    const all = document.blocks.flatMap(texts)
    expect(document.title).toBe('CLM du 2026-10-09')
    expect(all).toContain('Satellite · Tous les groupes')
    const tables = document.blocks.filter((block) => block.kind === 'table')
    expect(tables).toHaveLength(3)
    expect(texts(tables[0])).toEqual(
      expect.arrayContaining(['N°', 'DM-001', 'Connecteur', '2', 'MOE | lot 2', 'Acceptée', 'Lancer la PM'])
    )
    expect(texts(tables[1])).toEqual(expect.arrayContaining(['DM-002', 'À examiner']))
    expect(all).toContain('Aucune.')
    expect(all).toContain('Acceptées : 1 · Refusées : 0 · À examiner : 1')
    expect(texts(tables[2])).toEqual(expect.arrayContaining(['Le président', 'Le secrétaire']))
    for (const table of tables) {
      if (table.kind !== 'table') continue
      expect(table.header.reduce((sum, cell) => sum + cell.width, 0)).toBeLessThanOrEqual(DOCX_TEXT_WIDTH)
    }
    expect(buildPdf(document).length).toBeGreaterThan(500)
    expect(buildDocx(document).length).toBeGreaterThan(500)
  })
})
