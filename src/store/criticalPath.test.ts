import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeTask, type Task } from '../types'
import { criticalPath, endSlip } from './criticalPath'
import { makeWorkCalendar } from './WorkCalendar'
import { b12Tasks } from '../views/demo/demoContent'

const task = (title: string, start: string, due: string, over: Partial<Task> = {}): Task =>
  makeTask({ id: title, title, start, due, ...over })

describe('the critical path', () => {
  it('runs through the chain that ends last, the others given their margin', () => {
    const tasks = [
      task('A', '2026-10-01', '2026-10-05'),
      task('B', '2026-10-06', '2026-10-15', { dependencies: ['A'] }),
      task('C', '2026-10-06', '2026-10-08', { dependencies: ['A'] }),
      task('D', '2026-10-16', '2026-10-20', { dependencies: ['B', 'C'] }),
      task('E', '2026-10-02', '2026-10-03')
    ]
    const cp = criticalPath(tasks, DEFAULT_STATUSES)
    expect(cp.end).toBe('2026-10-20')
    expect(cp.path.map((one) => one.title)).toEqual(['A', 'B', 'D'])
    expect(cp.floats.get('C')).toMatchObject({ float: 7, latestDue: '2026-10-15', critical: false })
    // Unlinked, it may run up to the end.
    expect(cp.floats.get('E')?.float).toBe(17)
    expect(endSlip(7, 10)).toBe(3)
    expect(endSlip(0, 4)).toBe(4)
    expect(endSlip(7, 5)).toBe(0)
  })

  it('reads lags and the other kinds of link', () => {
    const tasks = [
      task('A', '2026-10-01', '2026-10-10'),
      // Starts three days after A starts, finishes with A: both tight.
      task('B', '2026-10-04', '2026-10-12', {
        dependencies: ['A'],
        dependencyOptions: { A: { type: 'SS', lag: 3 } }
      }),
      task('C', '2026-10-05', '2026-10-14', {
        dependencies: ['B'],
        dependencyOptions: { B: { type: 'FF', lag: 2 } }
      })
    ]
    const cp = criticalPath(tasks, DEFAULT_STATUSES)
    expect(cp.path.map((one) => one.title)).toEqual(['A', 'B', 'C'])
    // Two days of lag left loose: B may finish two days later.
    tasks[2].due = '2026-10-16'
    tasks[2].dependencyOptions = { B: { type: 'FF', lag: 2 } }
    const loose = criticalPath(tasks, DEFAULT_STATUSES)
    expect(loose.floats.get('B')?.float).toBe(2)
    expect(loose.floats.get('A')?.float).toBe(2)
  })

  it('counts working days, leaves out what is done and stands a phase for what it holds', () => {
    const calendar = makeWorkCalendar([1, 2, 3, 4, 5])
    const lot = task('Lot', '', '', {
      type: 'phase',
      subtasks: [task('A', '2026-10-05', '2026-10-09'), task('Done', '2026-09-28', '2026-10-02', { status: 'done' })]
    })
    const tasks = [
      lot,
      // Friday 9th, then Monday 12th: no slack across the weekend.
      task('B', '2026-10-12', '2026-10-16', { dependencies: ['Lot'] }),
      task('M', '', '2026-10-16', { type: 'milestone' })
    ]
    const cp = criticalPath(tasks, DEFAULT_STATUSES, calendar)
    expect(cp.floats.get('A')?.float).toBe(0)
    expect(cp.floats.has('Done')).toBe(false)
    expect(cp.floats.has('Lot')).toBe(false)
    expect(cp.path.map((one) => one.title)).toEqual(['A', 'B', 'M'])
  })

  it('gives no margin to tickets caught in a loop, and nothing to an undated plan', () => {
    const tasks = [
      task('A', '2026-10-01', '2026-10-02', { dependencies: ['B'] }),
      task('B', '2026-10-03', '2026-10-04', { dependencies: ['A'] }),
      task('C', '2026-10-01', '2026-10-04')
    ]
    const cp = criticalPath(tasks, DEFAULT_STATUSES)
    expect(cp.floats.has('A')).toBe(false)
    expect(cp.floats.get('C')?.critical).toBe(true)
    expect(criticalPath([task('X', '', '')]).end).toBe('')
  })

  it('runs through the demonstration’s slab, walls and floor to the roof', () => {
    const cp = criticalPath(b12Tasks('2026-10-05'), DEFAULT_STATUSES)
    expect(cp.end).toBe('2026-12-19')
    expect(cp.path.map((one) => one.title)).toEqual([
      'Coffrage du radier',
      'Ferraillage du radier',
      'Coulage du radier',
      'Radier coulé',
      'Voiles du rez-de-chaussée',
      'Plancher haut du rez-de-chaussée',
      'Hors d’eau'
    ])
    const reservations = b12Tasks('2026-10-05')
    expect(criticalPath(reservations, DEFAULT_STATUSES).floats.get('demo-b12-reservations')?.float).toBe(8)
  })
})
