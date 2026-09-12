/**
 * Where the marks go. Kept apart from the drawing so the arithmetic can be tested
 * without a DOM: a chart that plots the right numbers in the wrong place is still wrong,
 * and that is exactly the part an eye cannot check.
 */

export interface PlotBox {
  width: number
  height: number
  padTop: number
  padRight: number
  padBottom: number
  padLeft: number
}

export interface Point {
  x: number
  y: number
}

/**
 * Values spread evenly across the plot, scaled against a shared ceiling.
 *
 * The ceiling is passed in rather than taken from the series, because two series drawn
 * against different ceilings would be a second axis in disguise — the one thing a chart
 * of two counts must never do.
 *
 * A single value sits in the middle rather than hard against the left edge, where a lone
 * dot reads as the start of a line that is missing.
 */
export function plotPoints(values: number[], max: number, box: PlotBox): Point[] {
  const left = box.padLeft
  const right = box.width - box.padRight
  const top = box.padTop
  const bottom = box.height - box.padBottom
  const span = Math.max(max, 1)
  const usableY = Math.max(bottom - top, 0)
  if (values.length === 1) {
    return [{ x: (left + right) / 2, y: bottom - ((values[0] ?? 0) / span) * usableY }]
  }
  const stride = values.length > 1 ? (right - left) / (values.length - 1) : 0
  return values.map((value, i) => ({
    x: left + stride * i,
    y: bottom - (Math.max(value, 0) / span) * usableY
  }))
}

/** An SVG path through the points. Empty for an empty series, so nothing is drawn. */
export function linePath(points: Point[]): string {
  if (!points.length) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ')
}

/**
 * The same line closed down onto the baseline, for the wash under it. Empty for fewer
 * than two points: a filled area under a single dot would be a sliver of nothing.
 */
export function areaPath(points: Point[], baseline: number): string {
  if (points.length < 2) return ''
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return ''
  return `${linePath(points)} L${round(last.x)} ${round(baseline)} L${round(first.x)} ${round(baseline)} Z`
}

/**
 * The dash pattern that draws a ring filled to `value` percent.
 *
 * Returned rather than set, so the one piece of arithmetic behind every progress ring in
 * the view is checkable: a ring that is 30% full must be 30% of its circumference, and
 * an out-of-range value must not wrap around and read as a smaller one.
 */
export function ringDash(value: number, radius: number): { dash: number; gap: number } {
  const circumference = 2 * Math.PI * radius
  const filled = (Math.min(Math.max(value, 0), 100) / 100) * circumference
  return { dash: Math.round(filled * 100) / 100, gap: Math.round((circumference - filled) * 100) / 100 }
}

/** Ticks a reader can hold in their head: 0, then a round step up to the ceiling. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0]
  const raw = max / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw) ?? magnitude * 10
  const ticks: number[] = []
  for (let at = 0; at <= max + step / 2; at += step) ticks.push(Math.round(at * 100) / 100)
  return ticks
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
