import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeDocument, makeTask, type Task } from '../types'
import { daysBetween, firstDateOf, tasksFromTemplate } from './Template'

const task = (title: string, over: Partial<Task> = {}): Task => makeTask({ title, start: '', ...over })
const start = { start: '2026-06-01', statuses: DEFAULT_STATUSES }

describe('the day a template starts from', () => {
  it('is the earliest date anything in it stands on, at any depth', () => {
    const tasks = [
      task('a', { due: '2026-03-10' }),
      task('b', { start: '2026-02-01', subtasks: [task('c', { due: '2026-01-15' })] })
    ]
    expect(firstDateOf(tasks)).toBe('2026-01-15')
  })

  it('is empty when a template lays out no dates at all', () => {
    expect(firstDateOf([task('a'), task('b')])).toBe('')
  })
})

describe('a project made from a template', () => {
  it('keeps the shape: the titles, the tree, the types', () => {
    const tasks = [task('Lot 1', { type: 'phase', subtasks: [task('Étude'), task('Jalon', { type: 'milestone' })] })]
    const made = tasksFromTemplate(tasks, start)
    expect(made[0]?.title).toBe('Lot 1')
    expect(made[0]?.type).toBe('phase')
    expect(made[0]?.subtasks.map((t) => t.type)).toEqual(['task', 'milestone'])
  })

  it('carries none of the history', () => {
    const tasks = [
      task('Faite', {
        status: 'done',
        progress: 100,
        completed: '2026-02-02',
        archived: true,
        timeLogs: [{ date: '2026-02-01', hours: 3, note: '' }]
      })
    ]
    const [made] = tasksFromTemplate(tasks, start)
    expect(made?.status).toBe('todo')
    expect(made?.progress).toBe(0)
    expect(made?.completed).toBe('')
    expect(made?.archived).toBe(false)
    expect(made?.timeLogs).toEqual([])
  })

  it('moves every date as a block, keeping the plan’s spacing', () => {
    const tasks = [task('Début', { start: '2026-01-15', due: '2026-01-20' }), task('Fin', { due: '2026-03-15' })]
    // The template's first day is 15 January; the project starts on 1 June, so
    // everything moves by the same gap and the two months between them survive.
    const made = tasksFromTemplate(tasks, start)
    expect(made[0]?.start).toBe('2026-06-01')
    expect(made[0]?.due).toBe('2026-06-06')
    // Two months after the start in the template stays two months after it here.
    expect(made[1]?.due).toBe('2026-07-30')
    expect(daysBetween('2026-06-06', '2026-07-30')).toBe(daysBetween('2026-01-20', '2026-03-15'))
  })

  it('leaves the dates alone when no start is asked for', () => {
    const tasks = [task('a', { due: '2026-01-20' })]
    expect(tasksFromTemplate(tasks, { start: '', statuses: DEFAULT_STATUSES })[0]?.due).toBe('2026-01-20')
  })

  it('leaves an undated task undated rather than inventing a day for it', () => {
    const tasks = [task('daté', { due: '2026-01-15' }), task('sans date')]
    const made = tasksFromTemplate(tasks, start)
    expect(made[1]?.start).toBe('')
    expect(made[1]?.due).toBe('')
  })

  it('keeps what describes an awaited document and drops what was deposited against it', () => {
    const tasks = [
      task('Plan de masse', {
        type: 'document',
        document: makeDocument({
          reference: 'PL-001',
          issuer: 'BET',
          approvers: ['Ana'],
          state: 'approved',
          file: 'Projets/Vieux/_docs/plan.pdf',
          versions: [{ version: 2, file: 'plan.pdf', at: '2026-02-02', by: 'Ana', note: '' }],
          approvals: [{ by: 'Ana', at: '2026-02-03', verdict: 'approved', note: '' }]
        })
      })
    ]
    const [made] = tasksFromTemplate(tasks, start)
    expect(made?.document?.reference).toBe('PL-001')
    expect(made?.document?.issuer).toBe('BET')
    expect(made?.document?.approvers).toEqual(['Ana'])
    // The file and the signatures belong to the project that did the work.
    expect(made?.document?.state).toBe('expected')
    expect(made?.document?.file).toBe('')
    expect(made?.document?.versions).toEqual([])
    expect(made?.document?.approvals).toEqual([])
  })
})
