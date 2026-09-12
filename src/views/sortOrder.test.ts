import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES, makeTask, type Task } from '../types'
import { TASK_SORT_KEYS, KANBAN_SORT_KEYS, orderRows, orderTasks } from './sortOrder'

const task = (title: string, over: Partial<Task> = {}): Task => makeTask({ title, start: '', ...over })
const phase = (title: string, subtasks: Task[], over: Partial<Task> = {}): Task =>
  makeTask({ title, type: 'phase', start: '', subtasks, ...over })

describe('the order a view draws its rows in', () => {
  it('hands back the project’s own order when nothing is sorted', () => {
    const rows = [task('Zèbre'), task('Alpha')]
    expect(orderTasks(rows, { sortKey: 'manual', sortDir: 'asc' }).map((t) => t.title)).toEqual(['Zèbre', 'Alpha'])
  })

  it('sorts by title both ways', () => {
    const rows = [task('Zèbre'), task('Alpha'), task('Milieu')]
    expect(orderTasks(rows, { sortKey: 'title', sortDir: 'asc' }).map((t) => t.title)).toEqual([
      'Alpha',
      'Milieu',
      'Zèbre'
    ])
    expect(orderTasks(rows, { sortKey: 'title', sortDir: 'desc' }).map((t) => t.title)).toEqual([
      'Zèbre',
      'Milieu',
      'Alpha'
    ])
  })

  it('leaves the list it was given alone', () => {
    const rows = [task('Zèbre'), task('Alpha')]
    orderTasks(rows, { sortKey: 'title', sortDir: 'asc' })
    expect(rows.map((t) => t.title)).toEqual(['Zèbre', 'Alpha'])
  })

  it('puts the undated last whichever way it is sorted, rather than first', () => {
    const rows = [task('Sans date'), task('Datée', { due: '2026-03-02' })]
    expect(orderTasks(rows, { sortKey: 'due', sortDir: 'asc' }).map((t) => t.title)).toEqual(['Datée', 'Sans date'])
  })

  it('places a lot by the work it holds, not by its own empty dates', () => {
    const rows = [
      task('Tâche de mars', { due: '2026-03-15' }),
      phase('Lot de janvier', [task('dedans', { due: '2026-01-10' })])
    ]
    expect(orderTasks(rows, { sortKey: 'due', sortDir: 'asc' }, DEFAULT_STATUSES).map((t) => t.title)).toEqual([
      'Lot de janvier',
      'Tâche de mars'
    ])
  })

  it('places a lot by its declared dates when it has them', () => {
    const rows = [
      task('Tâche de mars', { due: '2026-03-15' }),
      phase('Lot annoncé en mai', [task('dedans', { due: '2026-01-10' })], { due: '2026-05-30' })
    ]
    expect(orderTasks(rows, { sortKey: 'due', sortDir: 'asc' }, DEFAULT_STATUSES).map((t) => t.title)).toEqual([
      'Tâche de mars',
      'Lot annoncé en mai'
    ])
  })

  it('sorts a lot on the progress of what it holds', () => {
    const rows = [
      phase('Bien avancé', [task('a', { progress: 100 }), task('b', { progress: 100 })]),
      phase('À peine commencé', [task('c', { progress: 10 })])
    ]
    expect(orderTasks(rows, { sortKey: 'progress', sortDir: 'desc' }, DEFAULT_STATUSES).map((t) => t.title)).toEqual([
      'Bien avancé',
      'À peine commencé'
    ])
  })

  it('does not touch a lot the sort has nothing to say about', () => {
    const rows = [phase('Lot vide', []), task('Tâche')]
    expect(orderTasks(rows, { sortKey: 'progress', sortDir: 'asc' }, DEFAULT_STATUSES)).toHaveLength(2)
  })
})

describe('what each view offers to sort by', () => {
  it('gives the board every order but status', () => {
    expect(KANBAN_SORT_KEYS).not.toContain('status')
    // A board answers status with the column a card sits in: sorting a column by it
    // would order every card in it by the one thing they all share.
    expect(KANBAN_SORT_KEYS).toEqual(TASK_SORT_KEYS.filter((key) => key !== 'status'))
  })

  it('leads with the project’s own order in both', () => {
    expect(TASK_SORT_KEYS[0]).toBe('manual')
    expect(KANBAN_SORT_KEYS[0]).toBe('manual')
  })
})

describe('the cards of one board column', () => {
  // Ascending walks the palette from the top, as the table has always done: the most
  // important first, not the alphabetical order of the labels.
  it('sorts by priority within the column, the palette’s order', () => {
    const cards = [
      task('Basse', { priority: 'low' }),
      task('Critique', { priority: 'critical' }),
      task('Moyenne', { priority: 'medium' })
    ]
    const asc = orderTasks(cards, { sortKey: 'priority', sortDir: 'asc' }, DEFAULT_STATUSES, DEFAULT_PRIORITIES)
    expect(asc.map((t) => t.title)).toEqual(['Critique', 'Moyenne', 'Basse'])
    const desc = orderTasks(cards, { sortKey: 'priority', sortDir: 'desc' }, DEFAULT_STATUSES, DEFAULT_PRIORITIES)
    expect(desc.map((t) => t.title)).toEqual(['Basse', 'Moyenne', 'Critique'])
  })

  it('sorts by due date, the undated last', () => {
    const cards = [task('Sans date'), task('Mars', { due: '2026-03-10' }), task('Février', { due: '2026-02-10' })]
    const sorted = orderTasks(cards, { sortKey: 'due', sortDir: 'asc' }, DEFAULT_STATUSES)
    expect(sorted.map((t) => t.title)).toEqual(['Février', 'Mars', 'Sans date'])
  })

  it('keeps the project’s order when nothing is sorted, which is what a board did before', () => {
    const cards = [task('Zèbre'), task('Alpha')]
    expect(orderTasks(cards, { sortKey: 'manual', sortDir: 'asc' }, DEFAULT_STATUSES)).toBe(cards)
  })
})

describe('what a sort does with a field nobody filled in', () => {
  it('puts the undated last, whichever way the list is read', () => {
    const rows = [task('Sans date'), task('Mars', { due: '2026-03-10' }), task('Février', { due: '2026-02-10' })]
    expect(orderTasks(rows, { sortKey: 'due', sortDir: 'asc' }).map((t) => t.title)).toEqual([
      'Février',
      'Mars',
      'Sans date'
    ])
    // A blank is an absent value, not a small one: reversing must not parade it first.
    expect(orderTasks(rows, { sortKey: 'due', sortDir: 'desc' }).map((t) => t.title)).toEqual([
      'Mars',
      'Février',
      'Sans date'
    ])
  })

  it('puts the unassigned last both ways too', () => {
    const rows = [task('Personne'), task('Zoé', { assignees: ['Zoé'] }), task('Ana', { assignees: ['Ana'] })]
    expect(orderTasks(rows, { sortKey: 'assignees', sortDir: 'asc' }).map((t) => t.title)).toEqual([
      'Ana',
      'Zoé',
      'Personne'
    ])
    expect(orderTasks(rows, { sortKey: 'assignees', sortDir: 'desc' }).map((t) => t.title)).toEqual([
      'Zoé',
      'Ana',
      'Personne'
    ])
  })
})

describe('the rows a table sorts', () => {
  // The table sorts rows that carry their task along with a depth and tree guides, so
  // the comparator has to reach through the wrapper rather than take the task itself.
  const row = (t: Task, depth = 0) => ({ task: t, depth })

  it('orders the wrappers by the task inside them', () => {
    const rows = [row(task('Zèbre')), row(task('Alpha'))]
    expect(orderRows(rows, (r) => r.task, { sortKey: 'title', sortDir: 'asc' }).map((r) => r.task.title)).toEqual([
      'Alpha',
      'Zèbre'
    ])
  })

  it('hands back the very list it was given when nothing is sorted', () => {
    const rows = [row(task('Zèbre')), row(task('Alpha'))]
    expect(orderRows(rows, (r) => r.task, { sortKey: 'manual', sortDir: 'asc' })).toBe(rows)
  })

  it('offers the table the project’s own order, which no column header can ask for', () => {
    expect(TASK_SORT_KEYS).toContain('manual')
    expect(TASK_SORT_KEYS[0]).toBe('manual')
  })
})
