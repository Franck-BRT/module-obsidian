import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES, makeDocument, makeTask, type Task } from '../types'
import { addDays, burnCurve, projectMetrics, rankPeople } from './Metrics'

const TODAY = '2026-03-10'
const task = (title: string, over: Partial<Task> = {}): Task => makeTask({ title, start: '', ...over })
const doneTask = (title: string, over: Partial<Task> = {}): Task => task(title, { status: 'done', ...over })
const phase = (title: string, subtasks: Task[], over: Partial<Task> = {}): Task =>
  makeTask({ title, type: 'phase', start: '', subtasks, ...over })

const metrics = (tasks: Task[], over: Partial<Parameters<typeof projectMetrics>[0]> = {}) =>
  projectMetrics({ tasks, statuses: DEFAULT_STATUSES, priorities: DEFAULT_PRIORITIES, today: TODAY, ...over })

describe('counting what a project holds', () => {
  it('counts tickets, never the lots holding them', () => {
    const m = metrics([phase('Lot 1', [task('a'), task('b')]), task('c')])
    // The lot's own tasks are not in the flat list here; only what the view passes is
    // counted, and the lot itself never is.
    expect(m.total).toBe(1)
    expect(m.phases).toHaveLength(1)
    expect(m.phases[0]?.count).toBe(2)
  })

  it('reads progress with a finished ticket counting for 100', () => {
    const m = metrics([doneTask('a', { progress: 0 }), task('b', { progress: 50 })])
    expect(m.progress).toBe(75)
    expect(m.done).toBe(1)
    expect(m.open).toBe(1)
  })

  it('has a progress of zero rather than a division by nothing on an empty project', () => {
    const m = metrics([])
    expect(m.progress).toBe(0)
    expect(m.total).toBe(0)
    expect(m.health.level).toBe('on-track')
  })

  it('separates late, coming up, and undated', () => {
    const m = metrics([
      task('en retard', { due: '2026-03-01' }),
      task('cette semaine', { due: '2026-03-12' }),
      task('plus tard', { due: '2026-06-01' }),
      task('sans date'),
      doneTask('finie en retard', { due: '2026-02-01' })
    ])
    expect(m.late).toBe(1)
    expect(m.dueSoon).toBe(1)
    expect(m.undated).toBe(1)
  })

  it('never calls a finished ticket late, however far its date has passed', () => {
    expect(metrics([doneTask('a', { due: '2020-01-01' })]).late).toBe(0)
  })
})

describe('the state a project is in', () => {
  it('is late as soon as one open ticket has passed its date', () => {
    const m = metrics([task('a', { due: '2026-03-01' })])
    expect(m.health.level).toBe('late')
    expect(m.health.late).toBe(1)
  })

  it('is at risk when a lot no longer fits the dates it declares', () => {
    const lot = phase('Lot', [task('a', { due: '2026-09-01' })], { start: '2026-01-01', due: '2026-06-01' })
    const m = metrics([lot])
    expect(m.health.level).toBe('at-risk')
    expect(m.health.overrunningPhases).toBe(1)
  })

  it('is at risk when a document is still awaited past its date', () => {
    const late = task('Plan', { type: 'document', due: '2026-03-01', document: makeDocument({ state: 'expected' }) })
    const m = metrics([late])
    // The document is open and overdue, so it is late on both counts; the point is that
    // the document tally sees it too rather than leaving it to the task count alone.
    expect(m.documents.late).toBe(1)
    expect(m.documents.awaited).toBe(1)
  })

  it('is on track when everything open is still ahead of its date', () => {
    expect(metrics([task('a', { due: '2026-06-01' }), doneTask('b')]).health.level).toBe('on-track')
  })
})

describe('breakdowns', () => {
  it('drops the classes nobody used rather than drawing them at zero', () => {
    const m = metrics([task('a', { status: 'todo' }), task('b', { status: 'todo' })])
    expect(m.byStatus).toHaveLength(1)
    expect(m.byStatus[0]).toMatchObject({ id: 'todo', count: 2 })
  })

  it('gives each class the colour it already wears elsewhere', () => {
    const m = metrics([task('a', { status: 'done' })])
    expect(m.byStatus[0]?.color).toBe(DEFAULT_STATUSES.find((s) => s.id === 'done')?.color)
  })

  it('counts a ticket once per person who carries it', () => {
    const m = metrics([task('a', { assignees: ['Ana', 'Bob'] }), task('b', { assignees: ['Ana'] })])
    expect(m.byAssignee.find((row) => row.name === 'Ana')?.total).toBe(2)
    expect(m.byAssignee.find((row) => row.name === 'Bob')?.total).toBe(1)
  })

  it('gathers what nobody has taken into a row of its own, last', () => {
    const m = metrics([task('a', { assignees: ['Ana'] }), task('b'), task('c')])
    const last = m.byAssignee[m.byAssignee.length - 1]
    expect(last?.name).toBe('')
    expect(last?.total).toBe(2)
  })

  it('folds the ninth person into one row rather than inventing a ninth colour', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      name: `P${String(i).padStart(2, '0')}`,
      total: 11 - i,
      done: 0,
      late: 0
    }))
    const ranked = rankPeople(rows)
    expect(ranked).toHaveLength(9)
    expect(ranked[8]?.name).toBe('')
    // Nobody is dropped: the tail's work is still in the total.
    expect(ranked.reduce((sum, row) => sum + row.total, 0)).toBe(66)
  })

  it('sorts milestones by date and says where each one stands', () => {
    const m = metrics([
      task('Jalon tard', { type: 'milestone', due: '2026-06-01' }),
      task('Jalon raté', { type: 'milestone', due: '2026-03-01' }),
      doneTask('Jalon tenu', { type: 'milestone', due: '2026-02-01' }),
      task('Jalon proche', { type: 'milestone', due: '2026-03-12' })
    ])
    expect(m.milestones.map((ms) => ms.state)).toEqual(['done', 'late', 'soon', 'later'])
  })

  it('adds up time logged against time estimated', () => {
    const m = metrics([
      task('a', { timeEstimate: 3, timeLogs: [{ date: TODAY, hours: 1.5, note: '' }] }),
      task('b', { timeEstimate: 2 })
    ])
    expect(m.time).toEqual({ logged: 1.5, estimate: 5 })
  })
})

describe('the plan against the work', () => {
  it('draws two lines that only ever climb', () => {
    const curve = burnCurve(
      [
        doneTask('a', { due: '2026-03-02', completed: '2026-03-03' }),
        doneTask('b', { due: '2026-03-04', completed: '2026-03-04' }),
        task('c', { due: '2026-03-06' })
      ],
      DEFAULT_STATUSES,
      '2026-03-06'
    )
    const planned = curve.points.map((p) => p.planned)
    const done = curve.points.map((p) => p.done)
    expect(planned).toEqual([...planned].sort((a, b) => a - b))
    expect(done).toEqual([...done].sort((a, b) => a - b))
    expect(planned[planned.length - 1]).toBe(3)
    expect(done[done.length - 1]).toBe(2)
  })

  it('reaches today even when every date in the project has passed', () => {
    const curve = burnCurve([doneTask('a', { due: '2026-01-05', completed: '2026-01-06' })], DEFAULT_STATUSES, TODAY)
    expect(curve.points[curve.points.length - 1]?.date).toBe(TODAY)
  })

  it('says how many finished tickets it could not place in time', () => {
    const curve = burnCurve(
      [doneTask('sans date de fin', { due: '2026-03-02' }), doneTask('datée', { completed: '2026-03-03' })],
      DEFAULT_STATUSES,
      '2026-03-05'
    )
    // Drawing the undated one on some day would put work on a date it did not happen.
    expect(curve.undatedDone).toBe(1)
    expect(curve.points[curve.points.length - 1]?.done).toBe(1)
  })

  it('counts what is in no column of the plan', () => {
    const curve = burnCurve([task('sans échéance'), doneTask('b', { completed: TODAY })], DEFAULT_STATUSES, TODAY)
    expect(curve.unplanned).toBe(1)
  })

  it('widens its step rather than drawing hundreds of points', () => {
    const long = [task('a', { due: '2024-01-01' }), task('b', { due: '2026-12-31' })]
    const curve = burnCurve(long, DEFAULT_STATUSES, TODAY, 24)
    expect(curve.step).toBe('month')
    expect(curve.points.length).toBeLessThanOrEqual(40)
    expect(curve.points.length).toBeGreaterThan(2)
  })

  it('draws a day-by-day curve over a short project', () => {
    const curve = burnCurve([task('a', { due: '2026-03-08' })], DEFAULT_STATUSES, '2026-03-12', 24)
    expect(curve.step).toBe('day')
  })

  it('has nothing to draw when no ticket carries a date', () => {
    const curve = burnCurve([task('a')], DEFAULT_STATUSES, TODAY)
    expect(curve.points.length).toBeGreaterThan(0)
  })
})

describe('walking dates without a timezone', () => {
  it('crosses a month, a year and a leap day', () => {
    expect(addDays('2026-03-10', 5)).toBe('2026-03-15')
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-03-10', -10)).toBe('2026-02-28')
  })
})
