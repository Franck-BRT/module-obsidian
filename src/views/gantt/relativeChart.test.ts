import { describe, expect, it } from 'vitest'
import { makeTask, type Task } from '../../types'
import { relativePlan } from '../../store/RelativePlan'
import { ALL_DAYS, makeWorkCalendar } from '../../store/WorkCalendar'
import { projectOntoDays, realTasksById, relativeTimelineConfig, relativeWeek, RELATIVE_ANCHOR } from './relativeChart'

const task = (id: string, over: Partial<Task> = {}): Task =>
  makeTask({ title: id, start: '', ...over, ...({ id } as Partial<Task>) })

describe('drawing a plan that has no dates', () => {
  it('starts the chart on the anchor, whatever the template says', () => {
    const tasks = [task('a'), task('b', { dependencies: ['a'] })]
    const drawn = projectOntoDays(tasks, relativePlan(tasks), RELATIVE_ANCHOR)
    expect(drawn[0]?.start).toBe(RELATIVE_ANCHOR)
    expect(drawn[1]?.start).toBe('2000-01-04')
  })

  it('covers the days a bar lasts, first to last inclusive', () => {
    const tasks = [task('a', { start: '2026-05-01', due: '2026-05-05' })]
    const drawn = projectOntoDays(tasks, relativePlan(tasks), RELATIVE_ANCHOR)
    // Five days from the anchor: the 3rd to the 7th.
    expect(drawn[0]?.start).toBe('2000-01-03')
    expect(drawn[0]?.due).toBe('2000-01-07')
  })

  it('gives a milestone a day to be drawn on rather than none', () => {
    const tasks = [task('m', { type: 'milestone' })]
    const drawn = projectOntoDays(tasks, relativePlan(tasks), RELATIVE_ANCHOR)
    expect(drawn[0]?.start).toBe(RELATIVE_ANCHOR)
    expect(drawn[0]?.due).toBe(RELATIVE_ANCHOR)
  })

  it('goes all the way down the tree', () => {
    const child = task('child')
    const parent = task('parent', { subtasks: [child] })
    const tasks = [parent]
    const drawn = projectOntoDays(tasks, relativePlan(tasks), RELATIVE_ANCHOR)
    expect(drawn[0]?.subtasks[0]?.start).toBe(RELATIVE_ANCHOR)
  })

  it('leaves the real tickets alone, and keeps them reachable by id', () => {
    const tasks = [task('a', { start: '2026-05-01', due: '2026-05-05' })]
    const drawn = projectOntoDays(tasks, relativePlan(tasks), RELATIVE_ANCHOR)
    // The copies are what the chart draws; an edit has to land on these.
    expect(tasks[0]?.start).toBe('2026-05-01')
    expect(drawn[0]).not.toBe(tasks[0])
    expect(realTasksById(tasks).get('a')).toBe(tasks[0])
  })
})

describe('the axis a dateless plan is drawn against', () => {
  it('starts on the anchor rather than reaching back from today', () => {
    // The ordinary axis folds today into its span, which with an anchor in the past
    // would stretch a six-week template across a quarter of a century.
    const tasks = [task('a'), task('b', { dependencies: ['a'] })]
    const plan = relativePlan(tasks)
    const cfg = relativeTimelineConfig(plan, 'day', ALL_DAYS)
    expect(cfg.startDate.toString()).toBe(RELATIVE_ANCHOR)
    expect(cfg.totalDays).toBeLessThan(60)
  })

  it('runs in whole weeks, so the last band is as wide as the others', () => {
    const tasks = [task('a', { start: '2026-05-01', due: '2026-06-30' })]
    const cfg = relativeTimelineConfig(relativePlan(tasks), 'day', ALL_DAYS)
    expect(cfg.totalDays % 7).toBe(0)
    expect(cfg.totalDays).toBeGreaterThanOrEqual(61)
  })

  it('gives a one-task template a readable width instead of a sliver', () => {
    const cfg = relativeTimelineConfig(relativePlan([task('a')]), 'day', ALL_DAYS)
    expect(cfg.totalDays).toBe(28)
  })
})

describe('a template read end to end', () => {
  it('lays a chained plan out week by week, from its own day one', () => {
    // Cadrage → études → jalon → travaux → essais, the shape a template usually has.
    const tasks = [
      task('cadrage', { start: '2026-01-05', due: '2026-01-06' }),
      task('etudes', { start: '2026-02-02', due: '2026-02-11', dependencies: ['cadrage'] }),
      task('jalon', { type: 'milestone', dependencies: ['etudes'] }),
      task('travaux', { start: '2026-03-02', due: '2026-03-20', dependencies: ['jalon'] }),
      task('essais', { start: '2026-04-06', due: '2026-04-13', dependencies: ['travaux'] })
    ]
    const plan = relativePlan(tasks)
    const drawn = projectOntoDays(tasks, plan, RELATIVE_ANCHOR)
    // Each one begins the day after the one it waits on, whatever dates it carried. A
    // milestone does no work but owns the day it marks, so the work resumes the day after
    // it — the same rule the dated scheduler follows.
    expect(drawn.map((t) => t.start)).toEqual(['2000-01-03', '2000-01-05', '2000-01-15', '2000-01-16', '2000-02-04'])
    const cfg = relativeTimelineConfig(plan, 'day', ALL_DAYS)
    expect(cfg.startDate.toString()).toBe(RELATIVE_ANCHOR)
    // Six whole weeks of axis: enough for the plan, and no more.
    expect(cfg.totalDays).toBe(42)
  })
})

describe('how wide a week is on a dateless axis', () => {
  const weekdays = makeWorkCalendar([1, 2, 3, 4, 5])

  it('is seven columns when every day counts, five when only weekdays do', () => {
    expect(relativeWeek(ALL_DAYS)).toBe(7)
    expect(relativeWeek(weekdays)).toBe(5)
  })

  it('bands the axis in the project own weeks, so a fortnight is two of them', () => {
    const tasks = [task('a', { duration: 10 })]
    const cfg = relativeTimelineConfig(relativePlan(tasks, weekdays), 'day', weekdays)
    expect(cfg.totalDays % 5).toBe(0)
    expect(cfg.totalDays).toBe(20)
  })
})
