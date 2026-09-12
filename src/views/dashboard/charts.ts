import { svgEl } from '../../utils'
import { areaPath, linePath, niceTicks, plotPoints, ringDash, type PlotBox } from './chartGeometry'
import { formatDateShort } from '../../dates'
import type { BurnPoint } from '../../store/Metrics'
import { t } from '../../i18n'

/**
 * The project's advancement as one figure inside a ring.
 *
 * A single ratio against a limit: a meter, not a chart. The number is the point, the
 * ring only gives it a shape, so the number is set large and the ring stays thin.
 */
export function progressRing(parent: HTMLElement, value: number, caption: string): void {
  const size = 132
  const radius = 54
  const svg = svgEl('svg', { class: 'pm-kpi-ring', viewBox: `0 0 ${size} ${size}`, role: 'img' })
  svg.appendChild(svgEl('title', {})).textContent = `${caption} — ${value}%`
  const common = { cx: size / 2, cy: size / 2, r: radius, fill: 'none', 'stroke-width': 10 }
  svg.appendChild(svgEl('circle', { ...common, class: 'pm-kpi-ring-track' }))
  const { dash, gap } = ringDash(value, radius)
  svg.appendChild(
    svgEl('circle', {
      ...common,
      class: 'pm-kpi-ring-fill',
      'stroke-linecap': 'round',
      'stroke-dasharray': `${dash} ${gap}`,
      transform: `rotate(-90 ${size / 2} ${size / 2})`
    })
  )
  parent.appendChild(svg)
  const inner = parent.createDiv('pm-kpi-ring-figure').createDiv('pm-kpi-ring-inner')
  inner.createSpan({ cls: 'pm-kpi-ring-value', text: String(value) })
  inner.createSpan({ cls: 'pm-kpi-ring-unit', text: '%' })
}

export interface BurnChartProps {
  points: BurnPoint[]
  /** Said under the chart when some finished work carries no date to place it on. */
  undatedDone: number
  /**
   * The width to draw at, in the pixels the chart will actually occupy.
   *
   * The plot is built in those pixels rather than in a fixed box stretched to fit: a
   * viewBox scaled sideways turns an end dot into an ellipse and the date labels into
   * wide type, which is how a chart ends up looking subtly wrong with no single thing
   * to point at.
   */
  width: number
}

/**
 * The plan against the work: everything due by a date, everything finished by it.
 *
 * Two series of the same thing — tickets — so one axis carries both, and the gap
 * between the lines is the reading. The plan is drawn in grey as context and the work in
 * the accent colour: the story is one line, and emphasis says which.
 */
export function burnChart(parent: HTMLElement, props: BurnChartProps): void {
  const { points } = props
  if (points.length < 2) {
    parent.createDiv({ cls: 'pm-kpi-empty', text: t('kpi.burnEmpty') })
    return
  }
  const box: PlotBox = {
    width: Math.max(props.width, 280),
    height: 220,
    padTop: 14,
    padRight: 16,
    padBottom: 26,
    padLeft: 34
  }
  const ceiling = Math.max(...points.map((p) => Math.max(p.planned, p.done)), 1)
  const ticks = niceTicks(ceiling)
  const top = ticks[ticks.length - 1] ?? ceiling
  const planned = plotPoints(
    points.map((p) => p.planned),
    top,
    box
  )
  const done = plotPoints(
    points.map((p) => p.done),
    top,
    box
  )
  const baseline = box.height - box.padBottom

  const svg = svgEl('svg', {
    class: 'pm-kpi-chart',
    viewBox: `0 0 ${box.width} ${box.height}`,
    role: 'img'
  })
  svg.appendChild(svgEl('title', {})).textContent = t('kpi.burnTitle')

  // Hairline, solid, one step off the surface: the grid carries the values that are not
  // directly labelled and nothing more.
  for (const tick of ticks) {
    const y = baseline - (tick / Math.max(top, 1)) * (baseline - box.padTop)
    svg.appendChild(
      svgEl('line', { class: 'pm-kpi-grid', x1: box.padLeft, x2: box.width - box.padRight, y1: y, y2: y })
    )
    const label = svgEl('text', { class: 'pm-kpi-tick', x: box.padLeft - 6, y: y + 3, 'text-anchor': 'end' })
    label.textContent = String(tick)
    svg.appendChild(label)
  }

  svg.appendChild(svgEl('path', { class: 'pm-kpi-line-planned', d: linePath(planned), fill: 'none' }))
  svg.appendChild(svgEl('path', { class: 'pm-kpi-area', d: areaPath(done, baseline) }))
  svg.appendChild(svgEl('path', { class: 'pm-kpi-line-done', d: linePath(done), fill: 'none' }))

  const endPlanned = planned[planned.length - 1]
  const endDone = done[done.length - 1]
  const last = points[points.length - 1]
  if (endDone && last) {
    svg.appendChild(svgEl('circle', { class: 'pm-kpi-dot-done', cx: endDone.x, cy: endDone.y, r: 5 }))
  }
  if (endPlanned && last) {
    svg.appendChild(svgEl('circle', { class: 'pm-kpi-dot-planned', cx: endPlanned.x, cy: endPlanned.y, r: 5 }))
  }

  // The first and last dates only: a label under every point is unread noise.
  for (const [at, point] of [
    [0, points[0]],
    [points.length - 1, last]
  ] as const) {
    if (!point) continue
    const x = planned[at]?.x ?? box.padLeft
    const label = svgEl('text', {
      class: 'pm-kpi-tick',
      x,
      y: box.height - 8,
      'text-anchor': at === 0 ? 'start' : 'end'
    })
    label.textContent = formatDateShort(point.date)
    svg.appendChild(label)
  }

  parent.appendChild(svg)

  const legend = parent.createDiv('pm-kpi-legend')
  legendKey(legend, 'pm-kpi-key-done', t('kpi.seriesDone'), last?.done ?? 0)
  legendKey(legend, 'pm-kpi-key-planned', t('kpi.seriesPlanned'), last?.planned ?? 0)
  if (props.undatedDone) {
    parent.createDiv({ cls: 'pm-kpi-note', text: t('kpi.undatedDone', { count: props.undatedDone }) })
  }
}

function legendKey(parent: HTMLElement, cls: string, label: string, value: number): void {
  const key = parent.createDiv('pm-kpi-legend-key')
  key.createSpan({ cls: `pm-kpi-swatch ${cls}` })
  key.createSpan({ cls: 'pm-kpi-legend-label', text: label })
  key.createSpan({ cls: 'pm-kpi-legend-value', text: String(value) })
}

export interface BarRow {
  label: string
  /** What the row says it is worth: a count, or a percentage with its sign. */
  value: string
  /** The share the bar fills, 0–100. Kept apart from the value: the two differ on a
   *  row showing "3 of 8 done", where the number is 3 and the bar is 37. */
  share: number
  color?: string
  detail?: string
  onClick?: () => void
}

/**
 * A list of labelled bars — the form a breakdown takes here.
 *
 * One row per class, each with its name and its count in text beside it, rather than
 * segments of one bar telling classes apart by colour alone: two of the palette's
 * default statuses are close enough that a reader with ordinary colour vision has
 * trouble separating them, so colour reinforces a labelled row and never carries it.
 */
export function barList(parent: HTMLElement, rows: BarRow[]): void {
  const list = parent.createDiv('pm-kpi-bars')
  for (const row of rows) {
    const line = list.createDiv('pm-kpi-bar-row')
    if (row.onClick) {
      line.addClass('pm-kpi-bar-row--link')
      line.setAttr('role', 'button')
      line.setAttr('tabindex', '0')
      line.addEventListener('click', row.onClick)
      line.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          row.onClick?.()
        }
      })
    }
    const head = line.createDiv('pm-kpi-bar-head')
    if (row.color) head.createSpan({ cls: 'pm-kpi-swatch' }).setCssProps({ '--pm-kpi-color': row.color })
    head.createSpan({ cls: 'pm-kpi-bar-label', text: row.label })
    if (row.detail) head.createSpan({ cls: 'pm-kpi-bar-detail', text: row.detail })
    head.createSpan({ cls: 'pm-kpi-bar-value', text: row.value })
    const track = line.createDiv('pm-kpi-bar-track')
    const fill = track.createDiv('pm-kpi-bar-fill')
    fill.setCssProps({
      '--pm-kpi-share': `${Math.min(Math.max(row.share, 0), 100)}%`,
      ...(row.color ? { '--pm-kpi-color': row.color } : {})
    })
  }
}
