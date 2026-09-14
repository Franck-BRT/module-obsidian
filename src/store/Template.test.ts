import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeDocument, makeTask, type Task } from '../types'
import { makeWorkCalendar } from './WorkCalendar'
import { computeSchedule } from './Scheduler'
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

describe('a template that states durations instead of dates', () => {
  const statuses = DEFAULT_STATUSES

  const plain = (id: string, over: Partial<Task> = {}): Task =>
    makeTask({ title: id, start: '', ...over, ...({ id } as Partial<Task>) })

  it('dates the new project from the day it starts and the days each ticket claims', () => {
    const tasks = [plain('a', { duration: 3 }), plain('b', { duration: 2, dependencies: ['a'] })]
    const made = tasksFromTemplate(tasks, { start: '2026-03-02', statuses })
    // Three days from the Monday, then the next one opens on the Thursday.
    expect(made[0]).toMatchObject({ start: '2026-03-02', due: '2026-03-04' })
    expect(made[1]).toMatchObject({ start: '2026-03-05', due: '2026-03-06' })
  })

  it('puts a milestone on its day, and leaves it without a start', () => {
    const tasks = [plain('a', { duration: 2 }), plain('m', { type: 'milestone', dependencies: ['a'] })]
    const made = tasksFromTemplate(tasks, { start: '2026-03-02', statuses })
    expect(made[1]?.due).toBe('2026-03-04')
    expect(made[1]?.start).toBe('')
  })

  it('keeps off weekends when the project does', () => {
    const tasks = [plain('a', { duration: 5 }), plain('b', { duration: 1, dependencies: ['a'] })]
    const calendar = makeWorkCalendar([1, 2, 3, 4, 5])
    const made = tasksFromTemplate(tasks, { start: '2026-03-02', statuses, calendar })
    // Monday to Friday, then the next Monday rather than the Saturday.
    expect(made[0]).toMatchObject({ start: '2026-03-02', due: '2026-03-06' })
    expect(made[1]).toMatchObject({ start: '2026-03-09', due: '2026-03-09' })
  })

  it('leaves a dated template alone, shifting it as it always did', () => {
    const tasks = [plain('a', { start: '2026-01-05', due: '2026-01-09' })]
    const made = tasksFromTemplate(tasks, { start: '2026-03-02', statuses })
    expect(made[0]).toMatchObject({ start: '2026-03-02', due: '2026-03-06' })
  })

  it('dates what a lot holds, and lets the lot roll up from it', () => {
    const lot = plain('lot', { type: 'phase', subtasks: [plain('x', { duration: 4 })] })
    const made = tasksFromTemplate([lot], { start: '2026-03-02', statuses })
    expect(made[0]?.subtasks[0]).toMatchObject({ start: '2026-03-02', due: '2026-03-05' })
  })

  it('does nothing at all without a start day', () => {
    const tasks = [plain('a', { duration: 3 })]
    const made = tasksFromTemplate(tasks, { start: '', statuses })
    expect(made[0]).toMatchObject({ start: '', due: '' })
  })
})

describe('what a template leaves open on purpose', () => {
  const plainStatuses = DEFAULT_STATUSES

  it('keeps a lone ticket undated even beside tickets the plan places', () => {
    const tasks = [makeTask({ title: 'a', start: '', duration: 3 }), makeTask({ title: 'libre', start: '' })]
    const made = tasksFromTemplate(tasks, { start: '2026-03-02', statuses: plainStatuses })
    expect(made[0]?.start).toBe('2026-03-02')
    expect(made[1]).toMatchObject({ start: '', due: '' })
  })

  it('places a ticket something else waits on, even when it claims no duration', () => {
    const first = makeTask({ title: 'first', start: '' })
    const second = makeTask({ title: 'second', start: '', dependencies: [first.id] })
    const made = tasksFromTemplate([first, second], { start: '2026-03-02', statuses: plainStatuses })
    expect(made[0]).toMatchObject({ start: '2026-03-02', due: '2026-03-02' })
    expect(made[1]).toMatchObject({ start: '2026-03-03', due: '2026-03-03' })
  })
})

describe('the dates a template hands to the new project', () => {
  it('are ones the project scheduler already agrees with, milestones included', () => {
    // The strongest thing the plan can promise: what it lays down, the scheduler that
    // owns real dates would not move. A milestone is the case that used to disagree.
    const a = makeTask({ title: 'a', start: '', duration: 3 })
    const m = makeTask({ title: 'jalon', type: 'milestone', start: '', due: '', dependencies: [a.id] })
    const b = makeTask({ title: 'b', start: '', duration: 2, dependencies: [m.id] })
    const made = tasksFromTemplate([a, m, b], { start: '2026-03-02', statuses: DEFAULT_STATUSES })

    expect(made.map((task) => [task.start, task.due])).toEqual([
      ['2026-03-02', '2026-03-04'],
      ['', '2026-03-05'],
      ['2026-03-06', '2026-03-07']
    ])
    expect(computeSchedule(made, undefined, DEFAULT_STATUSES).patches).toEqual([])
  })

  it('agrees with it on a working-day project too', () => {
    const calendar = makeWorkCalendar([1, 2, 3, 4, 5])
    const a = makeTask({ title: 'a', start: '', duration: 5 })
    const m = makeTask({ title: 'jalon', type: 'milestone', start: '', due: '', dependencies: [a.id] })
    const b = makeTask({ title: 'b', start: '', duration: 2, dependencies: [m.id] })
    const made = tasksFromTemplate([a, m, b], { start: '2026-03-02', statuses: DEFAULT_STATUSES, calendar })

    // Monday to Friday, the milestone on the following Monday, then Tuesday and Wednesday.
    expect(made.map((task) => [task.start, task.due])).toEqual([
      ['2026-03-02', '2026-03-06'],
      ['', '2026-03-09'],
      ['2026-03-10', '2026-03-11']
    ])
    expect(computeSchedule(made, undefined, DEFAULT_STATUSES, false, [], calendar).patches).toEqual([])
  })
})
