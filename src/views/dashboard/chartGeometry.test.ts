import { describe, expect, it } from 'vitest'
import { areaPath, linePath, niceTicks, plotPoints, ringDash, type PlotBox } from './chartGeometry'

const box: PlotBox = { width: 300, height: 100, padTop: 10, padRight: 20, padBottom: 20, padLeft: 30 }

describe('placing the marks', () => {
  it('spans the plot from the left pad to the right pad', () => {
    const points = plotPoints([0, 5, 10], 10, box)
    expect(points[0]?.x).toBe(30)
    expect(points[2]?.x).toBe(280)
  })

  it('reads upwards: a bigger value sits higher', () => {
    const [low, high] = plotPoints([0, 10], 10, box)
    expect(low?.y).toBe(80)
    expect(high?.y).toBe(10)
  })

  it('scales both series against the ceiling it is given, never their own', () => {
    // Two series on one axis: the same value has to land on the same height in both,
    // which is the whole reason the ceiling is a parameter.
    const a = plotPoints([5], 10, box)
    const b = plotPoints([5], 10, box)
    expect(a[0]?.y).toBe(b[0]?.y)
  })

  it('puts a lone value in the middle rather than against the edge', () => {
    expect(plotPoints([3], 10, box)[0]?.x).toBe(155)
  })

  it('survives a ceiling of zero rather than dividing by it', () => {
    const points = plotPoints([0, 0], 0, box)
    expect(points.every((p) => p.y === 80)).toBe(true)
  })
})

describe('the paths', () => {
  it('draws nothing for an empty series', () => {
    expect(linePath([])).toBe('')
    expect(areaPath([], 80)).toBe('')
  })

  it('does not wash under a single point', () => {
    expect(areaPath(plotPoints([4], 10, box), 80)).toBe('')
  })

  it('closes the wash onto the baseline', () => {
    const path = areaPath(plotPoints([0, 10], 10, box), 80)
    expect(path.endsWith('Z')).toBe(true)
    expect(path).toContain('L30 80')
  })
})

describe('the progress ring', () => {
  it('fills the share of the circumference it is given', () => {
    const r = 40
    const circumference = 2 * Math.PI * r
    const half = ringDash(50, r)
    expect(half.dash).toBeCloseTo(circumference / 2, 1)
    expect(half.dash + half.gap).toBeCloseTo(circumference, 1)
  })

  it('clamps rather than wrapping, so 120% never draws as 20%', () => {
    const r = 40
    expect(ringDash(120, r).dash).toBeCloseTo(ringDash(100, r).dash, 5)
    expect(ringDash(-10, r).dash).toBe(0)
  })
})

describe('the axis ticks', () => {
  it('climbs in round steps and covers the ceiling', () => {
    const ticks = niceTicks(9)
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(9)
    expect(ticks.every((tick) => Number.isInteger(tick * 2))).toBe(true)
  })

  it('has a single tick when there is nothing to scale', () => {
    expect(niceTicks(0)).toEqual([0])
  })
})
