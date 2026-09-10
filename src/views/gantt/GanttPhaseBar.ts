import { parsePlainDate } from '../../dates'
import type { PhaseSpan } from '../../store/Phase'
import { svgEl } from '../../utils'
import { dateToX, ROW_HEIGHT, type TimelineCfg } from './TimelineConfig'

const BRACKET_HEIGHT = 9
const OVERRUN_HEIGHT = 4

/** The x range a pair of dates covers, end inclusive. Null when either is unreadable. */
function extent(cfg: TimelineCfg, start: string, due: string): { x: number; width: number } | null {
  const from = parsePlainDate(start)
  const to = parsePlainDate(due)
  if (!from || !to) return null
  const x = dateToX(cfg, from)
  // The end day belongs to the phase, so the bar covers it rather than stopping at it.
  const end = dateToX(cfg, to.add({ days: 1 }))
  return { x, width: Math.max(end - x, 2) }
}

/**
 * A phase's summary bar: a flat bracket with tails turned down at each end, the shape
 * every Gantt uses for a summary line so it never reads as a task of its own.
 *
 * When the phase declares dates and the work does not fit inside them, the work's own
 * span is drawn as a thin bar underneath, the part that runs past the declaration
 * marked apart. Saying "lot 1 ends in February" is worth nothing if the chart hides
 * that its tasks run into March.
 */
export function phaseBracket(cfg: TimelineCfg, span: PhaseSpan, y: number): SVGGElement {
  const g = svgEl('g', { class: 'pm-gantt-phase' })
  const main = extent(cfg, span.start, span.due)
  if (!main) return g

  const top = y + ROW_HEIGHT / 2 - BRACKET_HEIGHT
  const { x, width } = main
  const tail = Math.min(6, width / 2)
  g.appendChild(
    svgEl('path', {
      d:
        `M ${x} ${top + BRACKET_HEIGHT} L ${x} ${top} L ${x + width} ${top} L ${x + width} ${top + BRACKET_HEIGHT} ` +
        `L ${x + width - tail} ${top + BRACKET_HEIGHT * 0.55} L ${x + tail} ${top + BRACKET_HEIGHT * 0.55} Z`,
      class: 'pm-gantt-phase-bracket'
    })
  )

  const rolled = span.overruns ? extent(cfg, span.rolledStart || span.start, span.rolledDue || span.due) : null
  if (rolled) {
    g.appendChild(
      svgEl('rect', {
        x: rolled.x,
        y: top + BRACKET_HEIGHT + 3,
        width: rolled.width,
        height: OVERRUN_HEIGHT,
        rx: 2,
        class: 'pm-gantt-phase-actual'
      })
    )
    // Only the part outside the declaration is called out; the rest is on plan.
    const overrunStart = Math.max(rolled.x, x + width)
    if (rolled.x + rolled.width > x + width) {
      g.appendChild(
        svgEl('rect', {
          x: overrunStart,
          y: top + BRACKET_HEIGHT + 3,
          width: rolled.x + rolled.width - overrunStart,
          height: OVERRUN_HEIGHT,
          rx: 2,
          class: 'pm-gantt-phase-overrun'
        })
      )
    }
    if (rolled.x < x) {
      g.appendChild(
        svgEl('rect', {
          x: rolled.x,
          y: top + BRACKET_HEIGHT + 3,
          width: Math.min(x, rolled.x + rolled.width) - rolled.x,
          height: OVERRUN_HEIGHT,
          rx: 2,
          class: 'pm-gantt-phase-overrun'
        })
      )
    }
  }
  return g
}
