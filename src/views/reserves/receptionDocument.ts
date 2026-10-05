import type { Task } from '../../types'
import { DOCX_TEXT_WIDTH, para, type DocxBlock, type DocxCell, type DocxDocument } from '../../store/docx'
import { isLateReserve, orderReserves, reserveCompany, reserveOf, reserveSummary } from '../../store/reserve'
import { formatDateLetter, formatDateShort } from '../../dates'
import { t } from '../../i18n'
import { phaseLabel, reserveCountText, severityLabel, stateLabel } from './reserveLabels'

export interface ReceptionContext {
  project: string
  /** YYYY-MM-DD. */
  date: string
}

/** Twentieths of a point for each column, the description taking what the others leave. */
function columns(widths: number[], stretch: number): (text: string, at: number, bold?: boolean) => DocxCell {
  const total = widths.reduce((sum, width) => sum + width, 0)
  widths[stretch] += DOCX_TEXT_WIDTH - total
  return (text, at, bold = false) => ({ runs: [{ text, ...(bold ? { bold: true } : {}) }], width: widths[at] })
}

/**
 * The handover report: the reserves, by contractor, each with its number, where, which
 * trade, what, how serious, by when it must be lifted and where it stands — then the
 * blocks the client, the architect and the contractors sign. For Word and PDF alike.
 */
export function receptionDocument(tasks: Task[], context: ReceptionContext): DocxDocument {
  const reserves = orderReserves(tasks)
  const summary = reserveSummary(reserves, context.date)
  const blocks: DocxBlock[] = [
    para('Title', t('reception.title')),
    para('Heading2', context.project),
    para(
      'Meta',
      [t('reception.date', { date: formatDateLetter(context.date) }), reserveCountText(summary)].join(' · ')
    ),
    para('Normal', t('reception.intro'))
  ]
  if (!reserves.length) blocks.push(para('Normal', t('reception.noReserve')))
  const phases = new Set(reserves.map((task) => reserveOf(task).phase))
  for (const company of summary.byCompany) {
    const list = reserves.filter((task) => reserveCompany(task) === company.company)
    blocks.push(para('Heading1', company.company || t('reserve.noCompany')))
    blocks.push(para('Meta', reserveCountText(company)))
    const cell = columns([800, 1400, 1500, 2400, 1200, 1100, 1300], 3)
    blocks.push({
      kind: 'table',
      header: [
        t('reserve.number'),
        t('reserve.location'),
        t('reserve.lot'),
        t('reception.description'),
        t('reserve.severity'),
        t('reception.liftBy'),
        t('reserve.state')
      ].map((text, at) => cell(text, at, true)),
      rows: list.map((task) => {
        const reserve = reserveOf(task)
        const late = isLateReserve(task, context.date)
        const what = [
          task.title,
          phases.size > 1 ? phaseLabel(reserve.phase) : '',
          reserve.photos.length ? t('reception.photos', { count: reserve.photos.length }) : ''
        ]
          .filter(Boolean)
          .join(' — ')
        const state = [
          stateLabel(reserve.state),
          reserve.state === 'lifted' && reserve.liftedOn ? formatDateShort(reserve.liftedOn) : '',
          late ? t('reception.late') : ''
        ]
          .filter(Boolean)
          .join(' ')
        return [
          cell(reserve.number || '—', 0),
          cell(reserve.location || '—', 1),
          cell(reserve.lot || '—', 2),
          cell(what, 3),
          cell(severityLabel(reserve.severity), 4, reserve.severity === 'blocking'),
          cell(task.due ? formatDateShort(task.due) : '—', 5),
          cell(state, 6, late)
        ]
      })
    })
  }
  // The signatures: the client and the architect, then each contractor named.
  blocks.push(para('Heading1', t('reception.signatures')))
  const space = `${t('reception.signHere')}\n\n\n\n`
  const companies = summary.byCompany.map((one) => one.company).filter(Boolean)
  const signers = [
    t('reception.client'),
    t('reception.architect'),
    ...(companies.length ? companies : [t('reception.contractor')])
  ]
  // Rows of three, or of two when three would leave a last row with a single block.
  const across = signers.length <= 3 ? signers.length : signers.length % 3 === 1 ? 2 : 3
  const width = Math.floor(DOCX_TEXT_WIDTH / across)
  const sign = columns(
    Array.from({ length: across }, () => width),
    0
  )
  const slots = Array.from({ length: across }, (_, at) => at)
  for (let at = 0; at < signers.length; at += across) {
    const row = signers.slice(at, at + across)
    blocks.push({
      kind: 'table',
      header: slots.map((one) => sign(row[one] ?? '', one, true)),
      rows: [slots.map((one) => sign(row[one] ? space : '', one))]
    })
  }
  blocks.push(para('Meta', t('reception.footer')))
  return { title: `${t('reception.title')} — ${context.project}`, blocks }
}
