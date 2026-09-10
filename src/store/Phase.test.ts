import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeTask, type Task } from '../types'
import { isPhase, openTasksIn, phaseHolds, phaseSpan } from './Phase'

const task = (over: Partial<Task> = {}): Task => makeTask({ start: '', ...over })
const phase = (subtasks: Task[], over: Partial<Task> = {}): Task =>
  makeTask({ type: 'phase', start: '', subtasks, ...over })

describe('what a phase amounts to', () => {
  it('takes its range from the tasks it holds', () => {
    const span = phaseSpan(
      phase([task({ start: '2026-03-02', due: '2026-03-06' }), task({ start: '2026-02-16', due: '2026-02-20' })])
    )
    expect(span.start).toBe('2026-02-16')
    expect(span.due).toBe('2026-03-06')
    expect(span.overruns).toBe(false)
  })

  it('counts a task dated on one end only', () => {
    const span = phaseSpan(phase([task({ start: '', due: '2026-03-06' })]))
    expect(span.start).toBe('2026-03-06')
    expect(span.due).toBe('2026-03-06')
  })

  it('has no range when nothing it holds is dated', () => {
    const span = phaseSpan(phase([task(), task()]))
    expect(span.start).toBe('')
    expect(span.due).toBe('')
  })

  it('reaches through a task to its subtasks', () => {
    const parent = task({ start: '2026-03-02', due: '2026-03-03', subtasks: [task({ due: '2026-04-30' })] })
    expect(phaseSpan(phase([parent])).due).toBe('2026-04-30')
  })

  it('lets a declared date win over the roll-up', () => {
    const span = phaseSpan(phase([task({ start: '2026-03-02', due: '2026-03-06' })], { start: '2026-01-01' }))
    expect(span.start).toBe('2026-01-01')
    expect(span.rolledStart).toBe('2026-03-02')
    expect(span.declaredStart).toBe('2026-01-01')
  })

  it('reports work running past the declared end', () => {
    const span = phaseSpan(phase([task({ due: '2026-03-31' })], { start: '2026-01-01', due: '2026-02-28' }))
    expect(span.overruns).toBe(true)
  })

  it('reports work starting before the declared start', () => {
    expect(phaseSpan(phase([task({ start: '2025-12-01' })], { start: '2026-01-01' })).overruns).toBe(true)
  })

  it('does not call it an overrun when the work fits', () => {
    const span = phaseSpan(
      phase([task({ start: '2026-01-05', due: '2026-02-01' })], {
        start: '2026-01-01',
        due: '2026-02-28'
      })
    )
    expect(span.overruns).toBe(false)
  })
})

describe('what a phase reports as progress', () => {
  const statuses = DEFAULT_STATUSES

  it('averages the tasks it holds', () => {
    expect(phaseSpan(phase([task({ progress: 100 }), task({ progress: 0 })]), statuses).progress).toBe(50)
  })

  it('counts a completed task as done however its progress field reads', () => {
    const done = task({ status: 'done', progress: 0 })
    expect(phaseSpan(phase([done, task({ progress: 0 })]), statuses).progress).toBe(50)
  })

  it('counts every task once, a parent alongside its own subtasks', () => {
    const parent = task({ progress: 0, subtasks: [task({ progress: 100 }), task({ progress: 100 })] })
    expect(phaseSpan(phase([parent]), statuses).progress).toBe(67)
  })

  it('takes a nested phase for what it holds, not as one task', () => {
    const inner = phase([task({ progress: 100 }), task({ progress: 100 }), task({ progress: 100 })])
    const outer = phase([inner, task({ progress: 0 })])
    expect(phaseSpan(outer, statuses).count).toBe(4)
    expect(phaseSpan(outer, statuses).progress).toBe(75)
  })

  it('reports nothing for an empty phase rather than dividing by zero', () => {
    const span = phaseSpan(phase([]), statuses)
    expect(span.progress).toBe(0)
    expect(span.count).toBe(0)
  })
})

describe('membership', () => {
  it('knows a phase from a task', () => {
    expect(isPhase(phase([]))).toBe(true)
    expect(isPhase(task())).toBe(false)
  })

  it('finds a task it holds at any depth', () => {
    const deep = task({ id: 'deep' })
    const p = phase([task({ subtasks: [deep] })])
    expect(phaseHolds(p, 'deep')).toBe(true)
    expect(phaseHolds(p, 'elsewhere')).toBe(false)
  })
})

describe('what a phase still has open', () => {
  it('counts what is not in a complete status', () => {
    const lot = phase([task({ title: 'à faire' }), task({ title: 'finie', status: 'done' })])
    expect(openTasksIn(lot, DEFAULT_STATUSES).map((t) => t.title)).toEqual(['à faire'])
  })

  it('reaches subtasks, however deep', () => {
    const lot = phase([task({ title: 'parente', status: 'done', subtasks: [task({ title: 'profonde' })] })])
    expect(openTasksIn(lot, DEFAULT_STATUSES).map((t) => t.title)).toEqual(['profonde'])
  })

  it('looks through a nested phase without counting the phase itself', () => {
    const lot = phase([phase([task({ title: 'dedans' })])])
    expect(openTasksIn(lot, DEFAULT_STATUSES).map((t) => t.title)).toEqual(['dedans'])
  })

  it('says nothing of a finished phase, which is what lets it archive without a question', () => {
    const lot = phase([task({ status: 'done' }), task({ status: 'cancelled' })])
    expect(openTasksIn(lot, DEFAULT_STATUSES)).toEqual([])
  })

  it('says nothing of an empty phase either', () => {
    expect(openTasksIn(phase([]), DEFAULT_STATUSES)).toEqual([])
  })

  it('counts everything when the palette has no complete status at all', () => {
    const open = [{ id: 'todo', label: 'À faire', color: '#888', icon: 'circle', complete: false }]
    const lot = phase([task({ status: 'todo' }), task({ status: 'done' })])
    expect(openTasksIn(lot, open)).toHaveLength(2)
  })
})
