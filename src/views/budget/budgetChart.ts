import { svgEl } from '../../utils'
import { linePath, niceTicks, plotPoints, type PlotBox } from '../dashboard/chartGeometry'
import type { BudgetPoint } from '../../store/budget'
import { formatDateShort } from '../../dates'
import { formatMoney, formatMoneyShort } from './money'
import { t } from '../../i18n'

/**
 * The project's money over time, three cumulated amounts on one axis — they are the same
 * thing, euros —: the budget as the lots' dates spread it, in grey as the context; what
 * is committed and what is invoiced, up to today, in colour. Where the lots are forecast
 * to end, when it is not their budget, is a dashed line across. Each week answers a
 * hover with its three figures.
 */
export function budgetChart(parent: HTMLElement, points: BudgetPoint[], forecast: number, width: number): void {
  if (points.length < 2) {
    parent.createDiv({ cls: 'pm-kpi-empty', text: t('budget.curveEmpty') })
    return
  }
  const box: PlotBox = {
    width: Math.max(width, 300),
    height: 230,
    padTop: 14,
    padRight: 16,
    padBottom: 26,
    padLeft: 64
  }
  const ceiling = Math.max(forecast, ...points.map((p) => Math.max(p.planned, p.committed ?? 0, p.invoiced ?? 0)), 1)
  const ticks = niceTicks(ceiling)
  const top = ticks[ticks.length - 1] ?? ceiling
  const baseline = box.height - box.padBottom
  const yOf = (value: number): number => baseline - (value / Math.max(top, 1)) * (baseline - box.padTop)
  const planned = plotPoints(
    points.map((p) => p.planned),
    top,
    box
  )
  // Drawn up to today only: what is not known yet has no line.
  const known = points.filter((p) => p.committed !== null).length
  const committed = plotPoints(
    points.map((p) => p.committed ?? 0),
    top,
    box
  ).slice(0, known)
  const invoiced = plotPoints(
    points.map((p) => p.invoiced ?? 0),
    top,
    box
  ).slice(0, known)

  const svg = svgEl('svg', {
    class: 'pm-kpi-chart pm-budget-chart',
    viewBox: `0 0 ${box.width} ${box.height}`,
    role: 'img'
  })
  svg.appendChild(svgEl('title', {})).textContent = t('budget.curveTitle')
  for (const tick of ticks) {
    const y = yOf(tick)
    svg.appendChild(
      svgEl('line', { class: 'pm-kpi-grid', x1: box.padLeft, x2: box.width - box.padRight, y1: y, y2: y })
    )
    const label = svgEl('text', { class: 'pm-kpi-tick', x: box.padLeft - 6, y: y + 3, 'text-anchor': 'end' })
    label.textContent = formatMoneyShort(tick)
    svg.appendChild(label)
  }
  const budget = points[points.length - 1]?.planned ?? 0
  if (forecast > 0 && Math.round(forecast) !== Math.round(budget)) {
    const y = yOf(forecast)
    svg.appendChild(
      svgEl('line', { class: 'pm-budget-forecast-line', x1: box.padLeft, x2: box.width - box.padRight, y1: y, y2: y })
    )
    const label = svgEl('text', {
      class: 'pm-budget-forecast-label',
      x: box.width - box.padRight,
      y: y - 4,
      'text-anchor': 'end'
    })
    label.textContent = t('budget.forecastLine', { amount: formatMoney(forecast) })
    svg.appendChild(label)
  }
  svg.appendChild(svgEl('path', { class: 'pm-kpi-line-planned', d: linePath(planned), fill: 'none' }))
  svg.appendChild(svgEl('path', { class: 'pm-budget-line-invoiced', d: linePath(invoiced), fill: 'none' }))
  svg.appendChild(svgEl('path', { class: 'pm-kpi-line-done', d: linePath(committed), fill: 'none' }))
  const endCommitted = committed[committed.length - 1]
  const endInvoiced = invoiced[invoiced.length - 1]
  if (endInvoiced) {
    svg.appendChild(svgEl('circle', { class: 'pm-budget-dot-invoiced', cx: endInvoiced.x, cy: endInvoiced.y, r: 4.5 }))
  }
  if (endCommitted) {
    svg.appendChild(svgEl('circle', { class: 'pm-kpi-dot-done', cx: endCommitted.x, cy: endCommitted.y, r: 4.5 }))
  }

  for (const at of [0, points.length - 1]) {
    const point = points[at]
    if (!point) continue
    const label = svgEl('text', {
      class: 'pm-kpi-tick',
      x: planned[at]?.x ?? box.padLeft,
      y: box.height - 8,
      'text-anchor': at === 0 ? 'start' : 'end'
    })
    label.textContent = formatDateShort(point.date)
    svg.appendChild(label)
  }

  // The hover layer: a band per sample, wider than any mark, its figures in its title.
  const stride = planned.length > 1 ? planned[1].x - planned[0].x : box.width
  points.forEach((point, at) => {
    const x = planned[at]?.x ?? 0
    const band = svgEl('rect', {
      class: 'pm-budget-hover',
      x: x - stride / 2,
      y: box.padTop,
      width: stride,
      height: baseline - box.padTop
    })
    band.appendChild(svgEl('title', {})).textContent = [
      formatDateShort(point.date),
      `${t('budget.seriesPlanned')} : ${formatMoney(point.planned)}`,
      point.committed === null ? '' : `${t('budget.committed')} : ${formatMoney(point.committed)}`,
      point.invoiced === null ? '' : `${t('budget.invoiced')} : ${formatMoney(point.invoiced)}`
    ]
      .filter(Boolean)
      .join('\n')
    svg.appendChild(band)
  })
  parent.appendChild(svg)

  const last = points[known - 1]
  const legend = parent.createDiv('pm-kpi-legend')
  const key = (cls: string, label: string, value: number): void => {
    const one = legend.createDiv('pm-kpi-legend-key')
    one.createSpan({ cls: `pm-kpi-swatch ${cls}` })
    one.createSpan({ cls: 'pm-kpi-legend-label', text: label })
    one.createSpan({ cls: 'pm-kpi-legend-value', text: formatMoney(value) })
  }
  key('pm-kpi-key-done', t('budget.committed'), last?.committed ?? 0)
  key('pm-budget-key-invoiced', t('budget.invoiced'), last?.invoiced ?? 0)
  key('pm-kpi-key-planned', t('budget.seriesPlanned'), last?.planned ?? 0)
}
