import type { Task } from '../../types'
import type { ProjectMetrics } from '../../store/Metrics'
import type { ChaseItem } from '../../store/chasing'
import type { VisaWait } from '../../store/visaDelay'
import { waitText } from '../visa/visaWaitWords'
import { decisionDay, decisionOf } from '../../store/decision'
import { BLACK, fit, GREY, LIGHT, PdfCanvas, rgb, tint, WHITE, type Rgb } from '../../store/pdfCanvas'
import { niceTicks } from './chartGeometry'
import { BAND_COLOR, impactLabel, probabilityLabel } from '../risks/riskLabels'
import { formatDate, formatDateLetter, formatDateShort } from '../../dates'
import { displayName } from '../../utils'
import { t } from '../../i18n'

/**
 * The dashboard as a PDF to send: who reads it has no Obsidian, often no time, and a
 * question — is it on time, and if not, on what. So the answer comes first, in words and
 * in colour; then the figures a review asks for; then the curve, the lots, the
 * milestones, the risks and their matrix, the decisions, who carries the work and what
 * is still awaited from others. Every colour agrees with words beside it: a report is
 * printed in black and white as often as not.
 */

export interface StatusReportInput {
  title: string
  /** What the report is about, under its title: a project, a programme. */
  subtitle?: string
  today: string
  metrics: ProjectMetrics
  decisions: { recent: Task[]; pending: Task[] }
  lateDocuments: ChaseItem[]
  /** The visas owed on documents received, the latest past its day first. */
  visas?: VisaWait[]
}

const NAVY: Rgb = [0.12, 0.23, 0.37]
const ACCENT: Rgb = [0.16, 0.42, 0.78]
const HEALTH: Record<ProjectMetrics['health']['level'], Rgb> = {
  'on-track': rgb('#15803d'),
  'at-risk': rgb('#ca8a04'),
  late: rgb('#dc2626')
}
const MILESTONE: Record<ProjectMetrics['milestones'][number]['state'], Rgb> = {
  done: rgb('#15803d'),
  late: rgb('#dc2626'),
  soon: rgb('#ca8a04'),
  later: rgb('#6b7280')
}
const RED = rgb('#dc2626')

function healthLabel(level: ProjectMetrics['health']['level']): string {
  switch (level) {
    case 'on-track':
      return t('kpi.health.on-track')
    case 'at-risk':
      return t('kpi.health.at-risk')
    case 'late':
      return t('kpi.health.late')
  }
}

function healthWhy(m: ProjectMetrics): string {
  if (m.health.late) return t('kpi.whyLate', { count: m.health.late })
  if (m.health.overrunningPhases) return t('kpi.whyOverrun', { count: m.health.overrunningPhases })
  if (m.health.lateDocs) return t('kpi.whyDocs', { count: m.health.lateDocs })
  if (m.health.criticalRisks) return t('kpi.whyRisks', { count: m.health.criticalRisks })
  return t('kpi.whyFine', { count: m.open })
}

function milestoneLabel(state: ProjectMetrics['milestones'][number]['state']): string {
  switch (state) {
    case 'done':
      return t('kpi.milestone.done')
    case 'late':
      return t('kpi.milestone.late')
    case 'soon':
      return t('kpi.milestone.soon')
    case 'later':
      return t('kpi.milestone.later')
  }
}

class Report {
  readonly c: PdfCanvas

  constructor(private input: StatusReportInput) {
    this.c = new PdfCanvas(40, {
      header: (canvas) => {
        canvas.text(canvas.margin, canvas.margin - 22, `${t('kpi.reportTitle')} — ${input.title}`, {
          size: 8,
          color: GREY
        })
        canvas.y = canvas.margin
      },
      footer: () => `${t('kpi.reportTitle')} — ${input.title} — ${formatDate(input.today)}`
    })
  }

  get m(): ProjectMetrics {
    return this.input.metrics
  }

  private get left(): number {
    return this.c.margin
  }

  private get width(): number {
    return this.c.contentWidth
  }

  /** A section's title, kept with at least `keep` points of what follows it. */
  private section(title: string, keep = 60): void {
    this.c.need(28 + keep)
    this.c.y += 10
    this.c.text(this.left, this.c.y, title, { size: 12, bold: true, color: NAVY })
    this.c.y += 17
    this.c.line(
      [
        [this.left, this.c.y],
        [this.left + this.width, this.c.y]
      ],
      { stroke: LIGHT, line: 0.8 }
    )
    this.c.y += 8
  }

  /** The band across the top: what, which project, when. */
  head(): void {
    const c = this.c
    c.rect(0, 0, c.width, 86, { fill: NAVY })
    c.text(this.left, 20, t('kpi.reportTitle').toUpperCase(), { size: 8.5, bold: true, color: tint(NAVY, 0.6) })
    c.text(this.left, 34, fit(this.input.title, 20, this.width - 150, true), { size: 20, bold: true, color: WHITE })
    if (this.input.subtitle) {
      c.text(this.left, 60, fit(this.input.subtitle, 9.5, this.width - 150), { size: 9.5, color: tint(NAVY, 0.7) })
    }
    const right = this.left + this.width
    c.text(right, 22, formatDateLetter(this.input.today), { size: 10, bold: true, color: WHITE, align: 'right' })
    const span = this.m.span.start
      ? `${formatDateShort(this.m.span.start)} – ${formatDateShort(this.m.span.due || this.m.span.start)}`
      : t('kpi.noDates')
    c.text(right, 38, `${t('kpi.window')} : ${span}`, { size: 8.5, color: tint(NAVY, 0.7), align: 'right' })
    c.y = 104
  }

  /** The answer first: on time or not, and why. */
  health(): void {
    const c = this.c
    const level = this.m.health.level
    const colour = HEALTH[level]
    c.rect(this.left, c.y, this.width, 30, { fill: tint(colour, 0.85) })
    c.rect(this.left, c.y, 5, 30, { fill: colour })
    const label = healthLabel(level)
    const at = c.text(this.left + 16, c.y + 9, label, { size: 12, bold: true, color: colour })
    c.text(this.left + 24 + at, c.y + 11, `— ${healthWhy(this.m)}`, { size: 10, color: BLACK })
    c.y += 44
  }

  /** The figures a weekly review asks for, a tile each. */
  tiles(): void {
    const c = this.c
    const m = this.m
    const tiles: { value: string; label: string; note?: string; alert?: boolean }[] = [
      { value: `${m.progress} %`, label: t('common.progress') },
      { value: `${m.done} / ${m.total}`, label: t('kpi.doneWord') },
      { value: String(m.late), label: t('kpi.late'), alert: m.late > 0 },
      { value: String(m.dueSoon), label: t('kpi.dueSoon') },
      {
        value: String(m.documents.awaited),
        label: t('kpi.awaitedDocs'),
        note: m.documents.late ? t('report.lateNote', { count: m.documents.late }) : '',
        alert: m.documents.late > 0
      },
      {
        value: String(m.risks.open),
        label: t('kpi.risks'),
        note: m.risks.byBand.critical ? t('report.criticalNote', { count: m.risks.byBand.critical }) : '',
        alert: m.risks.byBand.critical > 0
      }
    ]
    const gap = 8
    const width = (this.width - gap * (tiles.length - 1)) / tiles.length
    tiles.forEach((tile, at) => {
      const x = this.left + at * (width + gap)
      c.rect(x, c.y, width, 68, { fill: [0.96, 0.97, 0.98], stroke: LIGHT })
      c.text(x + 9, c.y + 8, tile.value, { size: 18, bold: true, color: tile.alert ? RED : NAVY })
      c.paragraph(x + 9, c.y + 31, width - 16, tile.label, { size: 7.5, color: GREY }, 2)
      if (tile.note) c.text(x + 9, c.y + 54, fit(tile.note, 7, width - 16, true), { size: 7, bold: true, color: RED })
    })
    c.y += 80
    // The progress as one bar under them.
    c.text(this.left, c.y, t('report.overall'), { size: 8.5, color: GREY })
    const barX = this.left + 110
    const barWidth = this.width - 150
    c.rect(barX, c.y + 1, barWidth, 9, { fill: LIGHT })
    c.rect(barX, c.y + 1, (barWidth * Math.min(100, m.progress)) / 100, 9, { fill: ACCENT })
    c.text(this.left + this.width, c.y, `${m.progress} %`, { size: 9, bold: true, align: 'right' })
    c.y += 20
  }

  /** The planned and the done, as two lines over time; beside it, where the tickets stand. */
  burnAndStatus(): void {
    const c = this.c
    const m = this.m
    const leftWidth = this.width * 0.58
    const rightX = this.left + leftWidth + 20
    const rightWidth = this.width - leftWidth - 20
    c.need(210)
    const top = c.y
    // The curve.
    c.text(this.left, top, t('kpi.burnTitle'), { size: 11, bold: true, color: NAVY })
    const points = m.burn.points
    const box = { x: this.left + 26, y: top + 30, width: leftWidth - 30, height: 120 }
    if (points.length < 2) {
      c.paragraph(this.left, top + 24, leftWidth, t('kpi.burnEmpty'), { size: 9, color: GREY })
    } else {
      const max = Math.max(1, ...points.map((p) => Math.max(p.planned, p.done)))
      const ticks = niceTicks(max)
      const ceiling = ticks[ticks.length - 1] || max
      const xAt = (at: number): number => box.x + (box.width * at) / (points.length - 1)
      const yAt = (value: number): number => box.y + box.height - (box.height * value) / ceiling
      for (const tick of ticks) {
        c.line(
          [
            [box.x, yAt(tick)],
            [box.x + box.width, yAt(tick)]
          ],
          { stroke: LIGHT, line: 0.5 }
        )
        c.text(box.x - 4, yAt(tick) - 4, String(tick), { size: 7, color: GREY, align: 'right' })
      }
      const done = points.map((p, at): [number, number] => [xAt(at), yAt(p.done)])
      c.polygon([...done, [xAt(points.length - 1), yAt(0)], [xAt(0), yAt(0)]], { fill: tint(ACCENT, 0.85) })
      c.line(
        points.map((p, at): [number, number] => [xAt(at), yAt(p.planned)]),
        { stroke: GREY, line: 1.2, dash: [3, 2] }
      )
      c.line(done, { stroke: ACCENT, line: 1.6 })
      // Today, where it falls.
      const todayAt = points.findIndex((p) => p.date >= this.input.today)
      if (todayAt > 0) {
        const x = xAt(todayAt)
        c.line(
          [
            [x, box.y],
            [x, box.y + box.height]
          ],
          { stroke: RED, line: 0.6, dash: [1.5, 1.5] }
        )
        c.text(x, box.y - 9, t('report.today'), { size: 6.5, color: RED, align: 'center' })
      }
      c.text(box.x, box.y + box.height + 4, formatDateShort(points[0].date), { size: 7, color: GREY })
      c.text(box.x + box.width, box.y + box.height + 4, formatDateShort(points[points.length - 1].date), {
        size: 7,
        color: GREY,
        align: 'right'
      })
      // Its legend, under the curve.
      const legendY = box.y + box.height + 16
      c.line(
        [
          [box.x, legendY + 4],
          [box.x + 14, legendY + 4]
        ],
        { stroke: GREY, line: 1.2, dash: [3, 2] }
      )
      const planned = c.text(box.x + 18, legendY, t('kpi.seriesPlanned'), { size: 7.5, color: GREY })
      const doneX = box.x + 30 + planned
      c.line(
        [
          [doneX, legendY + 4],
          [doneX + 14, legendY + 4]
        ],
        { stroke: ACCENT, line: 1.6 }
      )
      c.text(doneX + 18, legendY, t('kpi.seriesDone'), { size: 7.5, color: GREY })
    }

    // Where the tickets stand: one bar of their statuses, and its legend.
    c.text(rightX, top, t('kpi.breakdown'), { size: 11, bold: true, color: NAVY })
    const slices = m.byStatus.filter((slice) => slice.count > 0)
    const total = slices.reduce((sum, slice) => sum + slice.count, 0)
    let y = top + 22
    if (total) {
      let x = rightX
      for (const slice of slices) {
        const width = (rightWidth * slice.count) / total
        c.rect(x, y, width, 14, { fill: rgb(slice.color) })
        x += width
      }
      y += 24
      for (const slice of slices) {
        c.rect(rightX, y + 1, 8, 8, { fill: rgb(slice.color) })
        c.text(rightX + 13, y, fit(slice.label, 8.5, rightWidth - 60), { size: 8.5 })
        c.text(rightX + rightWidth, y, `${slice.count} · ${Math.round((slice.count / total) * 100)} %`, {
          size: 8.5,
          color: GREY,
          align: 'right'
        })
        y += 14
      }
    } else c.text(rightX, y, t('kpi.nothing'), { size: 9, color: GREY })
    c.y = Math.max(top + 190, y + 8)
  }

  /** Each lot, its progress as a bar, said in red when it overruns its dates. */
  phases(): void {
    const phases = this.m.phases
    if (!phases.length) return
    this.section(t('kpi.phases'))
    const c = this.c
    const barX = this.left + 175
    const barWidth = this.width - 175 - 120
    for (const phase of phases) {
      c.need(18)
      c.text(this.left, c.y, fit(phase.title, 9, 165), { size: 9 })
      c.rect(barX, c.y + 1, barWidth, 9, { fill: LIGHT })
      c.rect(barX, c.y + 1, (barWidth * Math.min(100, phase.progress)) / 100, 9, {
        fill: phase.overruns ? RED : ACCENT
      })
      c.text(barX + barWidth + 6, c.y, `${phase.progress} %`, { size: 8.5, bold: true })
      const due = phase.due ? formatDateShort(phase.due) : '—'
      c.text(this.left + this.width, c.y, phase.overruns ? `${due} · ${t('kpi.overruns')}` : due, {
        size: 8.5,
        color: phase.overruns ? RED : GREY,
        align: 'right'
      })
      c.y += 17
    }
  }

  /** The milestones on a line of time, numbered, and listed with their state. */
  milestones(): void {
    const marks = this.m.milestones.filter((mark) => mark.date)
    if (!this.m.milestones.length) return
    this.section(t('kpi.milestones'), 70)
    const c = this.c
    if (marks.length) {
      const first = Date.parse(marks[0].date)
      const last = Date.parse(marks[marks.length - 1].date)
      const spread = Math.max(1, last - first)
      const lineY = c.y + 16
      const x0 = this.left + 10
      const x1 = this.left + this.width - 10
      c.line(
        [
          [x0, lineY],
          [x1, lineY]
        ],
        { stroke: LIGHT, line: 2 }
      )
      const todayX = x0 + ((Date.parse(this.input.today) - first) / spread) * (x1 - x0)
      if (todayX > x0 && todayX < x1) {
        c.line(
          [
            [todayX, lineY - 12],
            [todayX, lineY + 12]
          ],
          { stroke: RED, line: 0.7, dash: [1.5, 1.5] }
        )
        c.text(todayX, lineY + 14, t('report.today'), { size: 6.5, color: RED, align: 'center' })
      }
      marks.forEach((mark, at) => {
        const x = marks.length === 1 ? (x0 + x1) / 2 : x0 + ((Date.parse(mark.date) - first) / spread) * (x1 - x0)
        const r = 5
        c.polygon(
          [
            [x, lineY - r],
            [x + r, lineY],
            [x, lineY + r],
            [x - r, lineY]
          ],
          { fill: MILESTONE[mark.state], stroke: WHITE, line: 0.8 }
        )
        c.text(x, lineY - 17, String(at + 1), { size: 7, bold: true, color: MILESTONE[mark.state], align: 'center' })
      })
      c.y = lineY + 28
    }
    let at = 0
    for (const mark of this.m.milestones) {
      c.need(14)
      const number = mark.date ? `${++at}.` : '·'
      c.text(this.left, c.y, number, { size: 8.5, bold: true, color: MILESTONE[mark.state] })
      c.text(this.left + 20, c.y, mark.date ? formatDateShort(mark.date) : t('kpi.noDate'), { size: 8.5, color: GREY })
      c.text(this.left + 80, c.y, fit(mark.title, 9, this.width - 170), { size: 9 })
      c.text(this.left + this.width, c.y, milestoneLabel(mark.state), {
        size: 8.5,
        bold: true,
        color: MILESTONE[mark.state],
        align: 'right'
      })
      c.y += 14
    }
  }

  /** The matrix of the open risks, and beside it the worst of them by name. */
  risks(): void {
    const risks = this.m.risks
    if (!risks.open && !risks.closed) return
    this.section(t('kpi.risksTitle'), 150)
    const c = this.c
    const top = c.y + 12
    const cell = 26
    const gridX = this.left + 30
    // Probability up the side, the likeliest on top; impact along the bottom.
    for (let p = 4; p >= 1; p--) {
      const y = top + (4 - p) * (cell + 2)
      c.text(gridX - 6, y + 8, String(p), { size: 8, color: GREY, align: 'right' })
      for (let i = 1; i <= 4; i++) {
        const score = p * i
        const band = score >= 12 ? 'critical' : score >= 8 ? 'high' : score >= 4 ? 'medium' : 'low'
        const count = risks.matrix[p - 1][i - 1]
        const x = gridX + (i - 1) * (cell + 2)
        c.rect(x, y, cell, cell, { fill: tint(rgb(BAND_COLOR[band]), count ? 0.35 : 0.85) })
        if (count) c.text(x + cell / 2, y + 8, String(count), { size: 10, bold: true, color: BLACK, align: 'center' })
      }
    }
    const below = top + 4 * (cell + 2)
    for (let i = 1; i <= 4; i++) {
      c.text(gridX + (i - 1) * (cell + 2) + cell / 2, below + 2, String(i), { size: 8, color: GREY, align: 'center' })
    }
    c.text(gridX + 2 * (cell + 2) - 1, below + 13, t('risk.impact'), { size: 7.5, color: GREY, align: 'center' })
    c.text(this.left, top - 13, t('risk.probability'), { size: 7, color: GREY })

    // The worst by name.
    const listX = gridX + 4 * (cell + 2) + 24
    const listWidth = this.left + this.width - listX
    let y = top - 12
    if (!risks.top.length) c.text(listX, y, t('kpi.risksNoneOpen', { count: risks.closed }), { size: 9, color: GREY })
    for (const risk of risks.top.slice(0, 6)) {
      const colour = rgb(BAND_COLOR[risk.band])
      c.rect(listX, y, 24, 16, { fill: colour })
      c.text(listX + 12, y + 3.5, String(risk.score), { size: 9, bold: true, color: WHITE, align: 'center' })
      c.text(listX + 32, y, fit(risk.title, 9, listWidth - 32, true), { size: 9, bold: true })
      const owner = risk.assignees.map(displayName).join(', ')
      const detail = [
        `${probabilityLabel(risk.probability)} × ${impactLabel(risk.impact)}`,
        owner,
        risk.mitigation ? `${t('risk.mitigation')} : ${risk.mitigation}` : t('report.noMitigation')
      ]
        .filter(Boolean)
        .join(' — ')
      c.text(listX + 32, y + 11, fit(detail, 7.5, listWidth - 32), {
        size: 7.5,
        color: risk.mitigation ? GREY : RED
      })
      y += 26
    }
    if (risks.top.length > 6) {
      c.text(listX + 32, y, t('kpi.risksMore', { count: risks.top.length - 6 }), { size: 7.5, color: GREY })
      y += 12
    }
    c.y = Math.max(below + 28, y + 4)
  }

  /** The decisions taken lately, and those still to take. */
  decisions(): void {
    const { recent, pending } = this.input.decisions
    if (!recent.length && !pending.length) return
    this.section(t('report.decisions'))
    const c = this.c
    const list = (title: string, tasks: Task[], pendingList: boolean): void => {
      if (!tasks.length) return
      c.need(30)
      c.text(this.left, c.y, title, { size: 9, bold: true, color: GREY })
      c.y += 14
      for (const task of tasks) {
        const decision = decisionOf(task)
        const late = pendingList && !!task.due && task.due < this.input.today
        c.need(14)
        const day = pendingList ? task.due : decisionDay(task)
        c.text(this.left, c.y, day ? formatDateShort(day) : '—', { size: 8.5, color: late ? RED : GREY })
        c.text(this.left + 60, c.y, fit(task.title, 9, this.width - 200), { size: 9 })
        const by = decision.decidedBy ? t('decision.by', { name: displayName(decision.decidedBy) }) : ''
        c.text(this.left + this.width, c.y, late ? [t('decision.late'), by].filter(Boolean).join(' · ') : by, {
          size: 8.5,
          color: late ? RED : GREY,
          align: 'right'
        })
        c.y += 13
        if (!pendingList && decision.rationale) {
          c.y += c.paragraph(
            this.left + 60,
            c.y - 1,
            this.width - 60,
            decision.rationale,
            { size: 7.5, color: GREY },
            2
          )
        }
      }
      c.y += 4
    }
    list(t('report.decisionsTaken'), recent, false)
    list(t('report.decisionsPending'), pending, true)
  }

  /** Who carries the open work, the late part of it in red. */
  people(): void {
    const rows = this.m.byAssignee.filter((row) => row.total > row.done)
    if (!rows.length) return
    this.section(t('kpi.workload'))
    const c = this.c
    const most = Math.max(...rows.map((row) => row.total - row.done), 1)
    const barX = this.left + 150
    const barWidth = this.width - 150 - 110
    for (const row of rows.slice(0, 15)) {
      c.need(16)
      const open = row.total - row.done
      c.text(this.left, c.y, fit(row.name ? displayName(row.name) : t('kpi.unassigned'), 9, 140), { size: 9 })
      const width = (barWidth * open) / most
      c.rect(barX, c.y + 1, width, 9, { fill: tint(ACCENT, 0.3) })
      if (row.late) c.rect(barX, c.y + 1, (barWidth * row.late) / most, 9, { fill: RED })
      const words = [t('report.openCount', { count: open }), row.late ? t('kpi.lateCount', { count: row.late }) : '']
      c.text(this.left + this.width, c.y, words.filter(Boolean).join(' · '), {
        size: 8.5,
        color: row.late ? RED : GREY,
        align: 'right'
      })
      c.y += 15
    }
  }

  /** The visas owed on the documents received: by whom, since when, by when. */
  visas(waits: VisaWait[]): void {
    this.section(t('visa.waitsTitle'))
    const c = this.c
    for (const wait of waits.slice(0, 20)) {
      c.need(14)
      const meta = wait.task.document
      const name = [meta?.reference, wait.task.title, meta?.issue ? t('chase.mail.issue', { issue: meta.issue }) : '']
        .filter(Boolean)
        .join(' — ')
      c.text(this.left, c.y, fit(name, 9, this.width * 0.46), { size: 9 })
      c.text(
        this.left + this.width * 0.48,
        c.y,
        fit(wait.approver ? displayName(wait.approver) : t('visa.noReviewerNamed'), 8.5, this.width * 0.2),
        { size: 8.5, color: GREY }
      )
      c.text(
        this.left + this.width,
        c.y,
        `${t('visa.received')} ${formatDateShort(wait.received)} · ${t('visa.due')} ${formatDateShort(wait.due)} · ${waitText(wait)}`,
        { size: 8.5, color: wait.late > 0 ? RED : GREY, align: 'right' }
      )
      c.y += 14
    }
    if (waits.length > 20) {
      c.text(this.left, c.y, t('report.more', { count: waits.length - 20 }), { size: 8, color: GREY })
    }
  }

  /** What others still owe, past its date: by whom, since when, how often chased. */
  documents(): void {
    const late = this.input.lateDocuments
    if (!late.length) return
    this.section(t('report.lateDocuments'))
    const c = this.c
    for (const item of late.slice(0, 20)) {
      c.need(14)
      const name = [item.reference, item.title].filter(Boolean).join(' — ')
      c.text(this.left, c.y, fit(name, 9, this.width * 0.48), { size: 9 })
      c.text(this.left + this.width * 0.5, c.y, fit(displayName(item.issuer) || '—', 8.5, this.width * 0.22), {
        size: 8.5,
        color: GREY
      })
      const chased = item.chases.length ? ` · ${t('report.chased', { count: item.chases.length })}` : ''
      c.text(
        this.left + this.width,
        c.y,
        `${formatDateShort(item.due)} · ${t('chase.daysLate', { count: item.daysLate })}${chased}`,
        { size: 8.5, color: RED, align: 'right' }
      )
      c.y += 14
    }
    if (late.length > 20) {
      c.text(this.left, c.y, t('report.more', { count: late.length - 20 }), { size: 8, color: GREY })
    }
  }
}

/** The visas owed, by document and reviewer, the late ones in red. */
function visas(report: Report, input: StatusReportInput): void {
  const waits = input.visas ?? []
  if (!waits.length) return
  report.visas(waits)
}

/** The status report, as a PDF file. */
export function statusReportPdf(input: StatusReportInput, at = new Date()): Uint8Array {
  const report = new Report(input)
  report.head()
  report.health()
  report.tiles()
  report.burnAndStatus()
  report.phases()
  report.milestones()
  report.risks()
  report.decisions()
  report.people()
  report.documents()
  visas(report, input)
  return report.c.build(`${t('kpi.reportTitle')} — ${input.title}`, at)
}
