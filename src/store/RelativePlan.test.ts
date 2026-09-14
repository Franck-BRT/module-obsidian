import { describe, expect, it } from 'vitest'
import { makeTask, type DependencyOption, type Task } from '../types'
import { earliestStart, lengthOf, relativePlan } from './RelativePlan'
import { makeWorkCalendar } from './WorkCalendar'

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

  it('is one day for a milestone: no work, but the day it marks is its own', () => {
    expect(lengthOf(task('a', { type: 'milestone' }))).toBe(1)
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

describe('a lot that waits on another lot', () => {
  const lot = (id: string, subtasks: Task[], over: Partial<Task> = {}): Task =>
    task(id, { type: 'phase', subtasks, ...over })

  it('starts after it, instead of being dragged back onto what it holds', () => {
    const first = lot('lot1', [task('a1'), task('a2', { dependencies: ['a1'] })])
    const second = lot('lot2', [task('b1')], { dependencies: ['lot1'], dependencyOptions: { lot1: fs() } })
    const plan = relativePlan([first, second])
    // The first lot covers two chained days; the second may only open once it is over.
    expect(plan.bars.get('lot1')).toEqual({ offset: 0, length: 2 })
    expect(plan.bars.get('lot2')?.offset).toBe(2)
  })

  it('takes what it holds along with it', () => {
    const first = lot('lot1', [task('a1')])
    const second = lot('lot2', [task('b1')], { dependencies: ['lot1'], dependencyOptions: { lot1: fs() } })
    const plan = relativePlan([first, second])
    expect(plan.bars.get('b1')?.offset).toBe(1)
  })

  it('carries the constraint all the way down, not just to the first level', () => {
    const inner = lot('inner', [task('deep')])
    const first = lot('lot1', [task('a1')])
    const second = lot('lot2', [inner], { dependencies: ['lot1'], dependencyOptions: { lot1: fs() } })
    const plan = relativePlan([first, second])
    expect(plan.bars.get('deep')?.offset).toBe(1)
    expect(plan.bars.get('inner')?.offset).toBe(1)
  })

  it('is read as everything it holds when something waits on it', () => {
    const first = lot('lot1', [task('a1', { start: '2026-01-05', due: '2026-01-09' })])
    const after = task('after', { dependencies: ['lot1'], dependencyOptions: { lot1: fs() } })
    const plan = relativePlan([first, after])
    // Five days held, so the ticket after the lot opens on the sixth.
    expect(plan.bars.get('after')?.offset).toBe(5)
  })

  it('still lets a ticket inside one lot wait on a ticket inside another', () => {
    const first = lot('lot1', [task('a1'), task('a2')])
    const second = lot('lot2', [task('b1', { dependencies: ['a1'], dependencyOptions: { a1: fs(2) } })])
    const plan = relativePlan([first, second])
    expect(plan.bars.get('b1')?.offset).toBe(3)
    expect(plan.bars.get('lot2')?.offset).toBe(3)
  })

  it('leaves an empty lot to its own links', () => {
    const first = lot('lot1', [task('a1')])
    const empty = lot('lot2', [], { dependencies: ['lot1'], dependencyOptions: { lot1: fs() } })
    const plan = relativePlan([first, empty])
    expect(plan.bars.get('lot2')?.offset).toBe(1)
  })
})

describe('a template laid out as a chain of lots', () => {
  it('steps down evenly, whether or not a lot holds anything', () => {
    // What Franck's template looks like: seven lots in a row, the first two holding
    // tickets of their own and the rest still empty.
    const chain: Task[] = []
    for (let n = 1; n <= 7; n++) {
      const deps = n === 1 ? {} : { [`lot${n - 1}`]: fs() }
      const held = n <= 2 ? [task(`t${n}`)] : []
      chain.push(
        task(`lot${n}`, { type: 'phase', subtasks: held, dependencies: Object.keys(deps), dependencyOptions: deps })
      )
    }
    const plan = relativePlan(chain)
    // One day each, so each lot opens the day the one before it closes: 0, 1, 2 …
    expect(chain.map((lot) => plan.bars.get(lot.id)?.offset)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(plan.bars.get('t2')?.offset).toBe(1)
    expect(plan.cycles).toEqual([])
  })
})

describe('what the arrows must never show', () => {
  it('never points a finish-to-start link backwards, lots or tickets', () => {
    const tree = [
      task('lot1', { type: 'phase', subtasks: [task('a1'), task('a2', { dependencies: ['a1'] })] }),
      task('lot2', {
        type: 'phase',
        subtasks: [task('b1', { start: '2026-03-02', due: '2026-03-06' })],
        dependencies: ['lot1'],
        dependencyOptions: { lot1: fs() }
      }),
      task('jalon', { type: 'milestone', dependencies: ['lot2'], dependencyOptions: { lot2: fs() } }),
      task('after', { dependencies: ['jalon'], dependencyOptions: { jalon: fs() } })
    ]
    const plan = relativePlan(tree)
    const links: [string, string][] = [
      ['a1', 'a2'],
      ['lot1', 'lot2'],
      ['lot2', 'jalon'],
      ['jalon', 'after']
    ]
    for (const [from, to] of links) {
      const pred = plan.bars.get(from)
      const succ = plan.bars.get(to)
      expect(pred && succ && succ.offset >= pred.offset + pred.length).toBe(true)
    }
  })
})

describe('the duration a template states, when it has no dates to give', () => {
  it('is how long the bar is', () => {
    expect(lengthOf(task('a', { duration: 15 }))).toBe(15)
  })

  it('is believed over dates left lying in the template', () => {
    expect(lengthOf(task('a', { start: '2026-01-05', due: '2026-01-06', duration: 20 }))).toBe(20)
  })

  it('never shrinks a bar to nothing, and never stretches a milestone', () => {
    expect(lengthOf(task('a', { duration: 0 }))).toBe(1)
    expect(lengthOf(task('m', { type: 'milestone', duration: 30 }))).toBe(1)
  })

  it('counts the days the project counts: a dated week is five of them on weekdays', () => {
    const weekdays = makeWorkCalendar([1, 2, 3, 4, 5])
    // Monday the 5th to Friday the 16th: ten working days, fourteen plain ones.
    const dated = task('a', { start: '2026-01-05', due: '2026-01-16' })
    expect(lengthOf(dated, weekdays)).toBe(10)
    expect(lengthOf(dated)).toBe(12)
  })

  it('pushes what follows by the days it claims', () => {
    const tasks = [task('a', { duration: 15 }), task('b', { dependencies: ['a'], dependencyOptions: { a: fs() } })]
    expect(relativePlan(tasks).bars.get('b')?.offset).toBe(15)
  })

  it('makes a lot as long as the durations it holds', () => {
    const lot = task('lot', {
      type: 'phase',
      subtasks: [
        task('x', { duration: 3 }),
        task('y', { duration: 4, dependencies: ['x'], dependencyOptions: { x: fs() } })
      ]
    })
    expect(relativePlan([lot]).bars.get('lot')).toEqual({ offset: 0, length: 7 })
  })
})

describe('a milestone, which marks a day rather than filling one', () => {
  it('lets the work after it start the next day, as the dated scheduler does', () => {
    const tasks = [
      task('a', { duration: 2 }),
      task('m', { type: 'milestone', dependencies: ['a'], dependencyOptions: { a: fs() } }),
      task('b', { dependencies: ['m'], dependencyOptions: { m: fs() } })
    ]
    const plan = relativePlan(tasks)
    // The milestone marks the day the work before it closed on; the next thing opens after.
    expect(plan.bars.get('m')?.offset).toBe(2)
    expect(plan.bars.get('b')?.offset).toBe(3)
  })

  it('never points its arrow backwards, which is how it is drawn', () => {
    const tasks = [task('m', { type: 'milestone' }), task('b', { dependencies: ['m'], dependencyOptions: { m: fs() } })]
    const plan = relativePlan(tasks)
    const milestone = plan.bars.get('m')
    const after = plan.bars.get('b')
    expect(milestone && after && after.offset >= milestone.offset + milestone.length).toBe(true)
  })

  it('is covered by the lot that holds it, day included', () => {
    const lot = task('lot', {
      type: 'phase',
      subtasks: [
        task('x', { duration: 2 }),
        task('m', { type: 'milestone', dependencies: ['x'], dependencyOptions: { x: fs() } })
      ]
    })
    expect(relativePlan([lot]).bars.get('lot')).toEqual({ offset: 0, length: 3 })
  })
})
