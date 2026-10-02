import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, DEFAULT_STATUSES, makeTask, type Task, type TaskDecision } from '../types'
import { ProjectStore } from './ProjectStore'
import { projectMetrics } from './Metrics'
import {
  decidedSince,
  decisionDay,
  decisionMatches,
  emptyDecision,
  orderDecisions,
  readAffected,
  readDecisionState,
  statusForDecision,
  withAffected
} from './decision'

const decision = (title: string, over: Partial<TaskDecision>, task: Partial<Task> = {}): Task =>
  makeTask({ title, type: 'decision', start: '', decision: emptyDecision(over), ...task })

const register = [
  decision('Béton C30/37 pour le radier', {
    state: 'decided',
    date: '2026-09-12',
    decidedBy: 'MOE',
    rationale: 'Classe d’exposition XC2 demandée par le bureau de contrôle.',
    affects: ['[[Work/B12/Plan de coffrage radier.md|Plan de coffrage radier]]', 'Lot 02']
  }),
  decision('Report de la réception', { state: 'proposed' }, { due: '2026-10-20' }),
  decision('Choix du lanceur', { state: 'proposed' }, { due: '2026-10-05' }),
  decision('Membrane bitumineuse', { state: 'superseded', date: '2026-08-01', decidedBy: 'MOA' }),
  decision('Phasage des travaux', { state: 'decided', date: '2026-09-30', decidedBy: 'COPIL' }),
  decision('Sous-traitance des réseaux', { state: 'cancelled', date: '2026-07-10' })
]

describe('the decisions register', () => {
  it('lists those to take first, the soonest due on top, then those taken, the latest first', () => {
    expect(orderDecisions(register).map((one) => one.title)).toEqual([
      'Choix du lanceur',
      'Report de la réception',
      'Phasage des travaux',
      'Béton C30/37 pour le radier',
      'Membrane bitumineuse',
      'Sous-traitance des réseaux'
    ])
  })

  it('files a decision under the day it was taken, else its due date', () => {
    expect(decisionDay(register[0])).toBe('2026-09-12')
    expect(decisionDay(register[1])).toBe('2026-10-20')
  })

  it('finds a decision by its words, its decider, its reasons or what it bears on, accents aside', () => {
    expect(decisionMatches(register[0], 'exposition')).toBe(true)
    expect(decisionMatches(register[0], 'moe beton')).toBe(true)
    expect(decisionMatches(register[0], 'coffrage')).toBe(true)
    expect(decisionMatches(register[0], 'lot 02')).toBe(true)
    expect(decisionMatches(register[0], 'lanceur')).toBe(false)
  })

  it('gives the decisions taken since a day', () => {
    expect(decidedSince(register, '2026-09-15').map((one) => one.title)).toEqual(['Phasage des travaux'])
  })
})

describe('a decision’s state', () => {
  it('is read in either language', () => {
    expect(readDecisionState('Prise')).toBe('decided')
    expect(readDecisionState('validée')).toBe('decided')
    expect(readDecisionState('à décider')).toBe('proposed')
    expect(readDecisionState('superseded')).toBe('superseded')
    expect(readDecisionState('Annulée')).toBe('cancelled')
    expect(readDecisionState('peut-être')).toBeNull()
  })

  it('moves the ticket’s status with it, and only when it must', () => {
    expect(statusForDecision('decided', 'todo', DEFAULT_STATUSES)).toBe('done')
    expect(statusForDecision('superseded', 'done', DEFAULT_STATUSES)).toBeNull()
    expect(statusForDecision('cancelled', 'done', DEFAULT_STATUSES)).toBe('cancelled')
    expect(statusForDecision('proposed', 'done', DEFAULT_STATUSES)).toBe('todo')
    expect(statusForDecision('proposed', 'review', DEFAULT_STATUSES)).toBeNull()
  })
})

describe('what a decision bears on', () => {
  it('is a link with its label, or words', () => {
    expect(readAffected('[[Work/B12/Plan.md|Plan de coffrage]]')).toEqual({
      kind: 'link',
      link: '[[Work/B12/Plan.md|Plan de coffrage]]',
      target: 'Work/B12/Plan.md',
      label: 'Plan de coffrage'
    })
    expect(readAffected('[[REQ-012]]')).toMatchObject({ kind: 'link', label: 'REQ-012' })
    expect(readAffected(' Lot 02 ')).toEqual({ kind: 'text', text: 'Lot 02' })
  })

  it('holds each once', () => {
    const once = withAffected(['[[a.md|A]]', 'Lot 02'], '[[a.md|Autre nom]]')
    expect(once).toEqual(['[[a.md|A]]', 'Lot 02'])
    expect(withAffected(once, 'lot 02')).toEqual(once)
    expect(withAffected(once, 'Budget')).toEqual(['[[a.md|A]]', 'Lot 02', 'Budget'])
  })
})

describe('a decision in its note', () => {
  it('is written and read back whole', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const store = new ProjectStore(app, () => DEFAULT_SETTINGS)
    const project = await store.createProject('Bâtiment B12', 'Work')
    const task = register[0]
    await store.insertTask(project, task)
    const reread = await new ProjectStore(app, () => DEFAULT_SETTINGS).loadProjectByPath(project.filePath)
    const found = reread?.tasks.find((one) => one.id === task.id)
    expect(found?.type).toBe('decision')
    expect(found?.decision).toEqual(task.decision)
  })
})

describe('the dashboard', () => {
  it('does not count a decision as work', () => {
    const metrics = projectMetrics({
      tasks: [...register, makeTask({ title: 'Couler le radier', start: '', due: '2026-09-01' })],
      statuses: DEFAULT_STATUSES,
      priorities: [],
      today: '2026-10-02'
    })
    expect(metrics.total).toBe(1)
    expect(metrics.late).toBe(1)
  })
})
