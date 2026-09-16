import { describe, it, expect } from 'vitest'
import { makeTask } from '../../types'
import { buildTimelineConfig, getSnapPoints, dateToX, arrowEndX, arrowStartX, MILESTONE_SIZE } from './TimelineConfig'
import { Temporal } from '../../dates'

const tasks = [makeTask({ start: '2026-03-10', due: '2026-04-20' })]

describe('buildTimelineConfig', () => {
  it('spans at least three years at year granularity', () => {
    const cfg = buildTimelineConfig(tasks, 'year')
    expect(cfg.totalDays).toBeGreaterThanOrEqual(1095)
  })

  it('starts a year timeline on the first of a month', () => {
    const cfg = buildTimelineConfig(tasks, 'year')
    expect(cfg.startDate.day).toBe(1)
  })

  it('gives a year column less width than a quarter column', () => {
    expect(buildTimelineConfig(tasks, 'year').dayWidth).toBeLessThan(buildTimelineConfig(tasks, 'quarter').dayWidth)
  })
})

describe('getSnapPoints', () => {
  it('snaps to month starts at year granularity', () => {
    const cfg = buildTimelineConfig(tasks, 'year')
    const points = getSnapPoints(cfg)
    const march = Temporal.PlainDate.from('2026-03-01')
    expect(points).toContain(dateToX(cfg, march))
    expect(points).not.toContain(dateToX(cfg, march.add({ days: 1 })))
  })
})

describe('where a dependency arrow touches a ticket', () => {
  const cfg = buildTimelineConfig([makeTask({ start: '2026-03-10', due: '2026-04-20' })], 'day')
  const bar = makeTask({ start: '2026-03-16', due: '2026-03-18' })
  // A milestone carries a date and no start at all, which is what the editor writes.
  const milestone = makeTask({ type: 'milestone', start: '', due: '2026-03-20' })

  it('arrives at a milestone, which used to be skipped for having no start date', () => {
    expect(arrowEndX(milestone, cfg)).not.toBeNull()
  })

  it('touches the diamond own points, not the day around it', () => {
    const centre = dateToX(cfg, Temporal.PlainDate.from('2026-03-20')) + cfg.dayWidth / 2
    expect(arrowEndX(milestone, cfg)).toBe(centre - MILESTONE_SIZE)
    expect(arrowStartX(milestone, cfg)).toBe(centre + MILESTONE_SIZE)
  })

  it('stays on the diamond at every zoom level', () => {
    for (const level of ['day', 'week', 'month', 'quarter', 'year'] as const) {
      const zoomed = buildTimelineConfig([bar], level)
      const centre = dateToX(zoomed, Temporal.PlainDate.from('2026-03-20')) + zoomed.dayWidth / 2
      expect(arrowEndX(milestone, zoomed)).toBe(centre - MILESTONE_SIZE)
    }
  })

  it('leaves a bar at its right edge and arrives at its left, as before', () => {
    expect(arrowEndX(bar, cfg)).toBe(dateToX(cfg, Temporal.PlainDate.from('2026-03-16')))
    expect(arrowStartX(bar, cfg)).toBe(dateToX(cfg, Temporal.PlainDate.from('2026-03-19')))
  })

  it('has nowhere to touch a ticket with no dates at all', () => {
    const undated = makeTask({ start: '', due: '' })
    expect(arrowEndX(undated, cfg)).toBeNull()
    expect(arrowStartX(undated, cfg)).toBeNull()
  })
})
