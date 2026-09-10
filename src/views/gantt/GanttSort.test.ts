import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeTask, type Task } from '../../types'
import { orderTasks } from './GanttSort'

const task = (title: string, over: Partial<Task> = {}): Task => makeTask({ title, start: '', ...over })
const phase = (title: string, subtasks: Task[], over: Partial<Task> = {}): Task =>
  makeTask({ title, type: 'phase', start: '', subtasks, ...over })

describe('the order the Gantt draws siblings in', () => {
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
