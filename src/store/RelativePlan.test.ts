import { describe, expect, it } from 'vitest'
import { makeTask, type DependencyOption, type Task } from '../types'
import { earliestStart, lengthOf, relativePlan } from './RelativePlan'

const task = (id: string, over: Partial<Task> = {}): Task =>
  makeTask({ title: id, start: '', ...over, ...({ id } as Partial<Task>) })

const linked = (id: string, deps: Record<string, DependencyOption>, over: Partial<Task> = {}): Task =>
  task(id, { dependencies: Object.keys(deps), dependencyOptions: deps, ...over })

const fs = (lag = 0): DependencyOption => ({ type: 'FS', lag })

describe('how long a ticket takes when a template gives no dates', () => {
  it('takes a day, so it is a bar and not a point', () => {
    expect(lengthOf(task('a'))).toBe(1)
  })

  it('takes the days it names when someone did date it', () => {
    expect(lengthOf(task('a', { start: '2026-01-05', due: '2026-01-09' }))).toBe(5)
  })

  it('takes none at all for a milestone, which is a moment', () => {
    expect(lengthOf(task('a', { type: 'milestone' }))).toBe(0)
  })
})

describe('where a link puts a successor', () => {
  const pred = { offset: 3, length: 4 }
  it('reads the four kinds the same way a dated plan does', () => {
    expect(earliestStart(pred, 'FS', 0, 2)).toBe(7)
    expect(earliestStart(pred, 'SS', 0, 2)).toBe(3)
    expect(earliestStart(pred, 'FF', 0, 2)).toBe(5)
    expect(earliestStart(pred, 'SF', 0, 2)).toBe(1)
  })

  it('counts the lag, either way', () => {
    expect(earliestStart(pred, 'FS', 2, 1)).toBe(9)
    expect(earliestStart(pred, 'FS', -1, 1)).toBe(6)
  })
})

describe('the plan a template’s links imply', () => {
  it('starts everything with nothing in front of it on day zero', () => {
    const plan = relativePlan([task('a'), task('b')])
    expect(plan.bars.get('a')?.offset).toBe(0)
    expect(plan.bars.get('b')?.offset).toBe(0)
  })

  it('puts a chain end to end, with no date anywhere', () => {
    const plan = relativePlan([task('a'), linked('b', { a: fs() }), linked('c', { b: fs() })])
    expect(plan.bars.get('b')?.offset).toBe(1)
    expect(plan.bars.get('c')?.offset).toBe(2)
    expect(plan.span).toBe(3)
  })

  it('holds a successor back to its latest predecessor, not its first', () => {
    const plan = relativePlan([
      task('long', { start: '2026-01-01', due: '2026-01-10' }),
      task('short'),
      linked('after', { long: fs(), short: fs() })
    ])
    expect(plan.bars.get('after')?.offset).toBe(10)
  })

  it('opens a gap for a lag', () => {
    const plan = relativePlan([task('a'), linked('b', { a: fs(3) })])
    expect(plan.bars.get('b')?.offset).toBe(4)
  })

  it('never lets a link push something before day zero', () => {
    // SF with no lag would put it at -1; a plan cannot start before it starts.
    const plan = relativePlan([task('a'), linked('b', { a: { type: 'SF', lag: 0 } })])
    expect(plan.bars.get('b')?.offset).toBe(0)
  })

  it('spans a lot over what it holds', () => {
    const inside = [task('x'), linked('y', { x: fs(2) })]
    const lot = makeTask({ title: 'Lot', type: 'phase', start: '', subtasks: inside })
    const plan = relativePlan([lot])
    expect(plan.bars.get(lot.id)?.offset).toBe(0)
    // x takes day 0, y starts on day 3 and takes a day: four days end to end.
    expect(plan.bars.get(lot.id)?.length).toBe(4)
  })

  it('draws a loop at day zero and says which tickets are in it', () => {
    const a = linked('a', { b: fs() })
    const b = linked('b', { a: fs() })
    const plan = relativePlan([a, b])
    expect(plan.cycles.sort()).toEqual(['a', 'b'])
    expect(plan.bars.get('a')?.offset).toBe(0)
    expect(plan.bars.get('b')?.offset).toBe(0)
  })

  it('ignores a link pointing outside the template rather than dropping the ticket', () => {
    const plan = relativePlan([linked('b', { elsewhere: fs() })])
    expect(plan.bars.get('b')?.offset).toBe(0)
    expect(plan.cycles).toEqual([])
  })

  it('covers at least one day, even with nothing in it', () => {
    expect(relativePlan([]).span).toBe(1)
  })
})
