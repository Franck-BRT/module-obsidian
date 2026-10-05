import { beforeAll, describe, expect, it } from 'vitest'
import { setLocale } from '../../i18n'
import { DEFAULT_PRIORITIES, makeDocument, makeTask, seedStatuses, type Task } from '../../types'
import { projectMetrics } from '../../store/Metrics'
import { awaitedDocuments } from '../../store/chasing'
import { pdfString } from '../../store/pdf'
import { fit, PdfCanvas, rgb, tint } from '../../store/pdfCanvas'
import { statusReportPdf } from './statusReportPdf'

const TODAY = '2026-10-02'

/** The file as text, its bytes one character each, as a reader scans it. */
const read = (bytes: Uint8Array): string => Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

/** Every offset of the cross-reference table lands on the object it names. */
function expectSound(text: string): void {
  const start = Number(/startxref\s+(\d+)/.exec(text)?.[1])
  expect(text.slice(start, start + 4)).toBe('xref')
  const count = Number(/xref\n0 (\d+)/.exec(text)?.[1])
  const entries = text
    .slice(start)
    .split('\n')
    .slice(3, 3 + count - 1)
  entries.forEach((entry, at) => {
    const offset = Number(entry.slice(0, 10))
    expect(text.slice(offset, offset + `${at + 1} 0 obj`.length)).toBe(`${at + 1} 0 obj`)
  })
}

beforeAll(() => setLocale('fr'))

describe('the drawing surface', () => {
  it('reads colours, washes them, and cuts a text to a width', () => {
    expect(rgb('#ff0000')).toEqual([1, 0, 0])
    expect(rgb('#0f0')).toEqual([0, 1, 0])
    expect(rgb('var(--color-red)')).toEqual([0.55, 0.55, 0.58])
    expect(tint([0, 0, 0], 0.5)).toEqual([0.5, 0.5, 0.5])
    expect(fit('Réception des fonds de fouille', 10, 60)).toMatch(/…$/)
    expect(fit('Radier', 10, 200)).toBe('Radier')
  })

  it('turns pages as they fill, and numbers each at its foot', () => {
    const canvas = new PdfCanvas(40, { footer: () => 'Pied' })
    for (let line = 0; line < 120; line++) {
      canvas.need(14)
      canvas.text(40, canvas.y, `Ligne ${line}`)
      canvas.y += 14
    }
    expect(canvas.pageCount).toBe(3)
    const text = read(canvas.build('Essai'))
    expectSound(text)
    expect(text).toContain('/Count 3')
    expect(text).toContain('(3 / 3)')
    expect(text).toContain('(Pied)')
  })
})

describe('the status report', () => {
  const tasks: Task[] = [
    makeTask({ title: 'Coffrage radier', start: '2026-09-21', due: '2026-09-30', assignees: ['Paul Martin'] }),
    makeTask({
      title: 'Terrassements',
      start: '2026-09-01',
      due: '2026-09-18',
      status: 'done',
      completed: '2026-09-18'
    }),
    makeTask({ title: 'Radier coulé', type: 'milestone', start: '', due: '2026-10-16' }),
    makeTask({
      title: 'Accès chantier bloqué',
      type: 'risk',
      start: '',
      risk: { probability: 4, impact: 4, mitigation: '' }
    }),
    makeTask({
      title: 'Plan de coffrage',
      type: 'document',
      start: '',
      due: '2026-09-18',
      document: makeDocument({ reference: 'PL-002', issuer: 'Garonne Bâtiment', chases: ['2026-09-22'] })
    })
  ]
  const decision = makeTask({
    title: 'Béton C30/37',
    type: 'decision',
    start: '',
    decision: { state: 'decided', date: '2026-09-29', decidedBy: 'COPIL', rationale: 'Exposition XC2.', affects: [] }
  })
  const metrics = projectMetrics({ tasks, statuses: seedStatuses(), priorities: DEFAULT_PRIORITIES, today: TODAY })

  it('is a sound PDF that says the state, the figures, the risks, the decisions and what is late', () => {
    const text = read(
      statusReportPdf(
        {
          title: 'Bâtiment B12',
          today: TODAY,
          metrics,
          decisions: { recent: [decision], pending: [] },
          lateDocuments: awaitedDocuments(tasks, TODAY),
          visas: [
            {
              task: makeTask({
                title: 'Plan d’exécution',
                type: 'document',
                start: '',
                document: makeDocument({ reference: 'PEX-03' })
              }),
              approver: 'Paul Martin',
              received: '2026-09-12',
              due: '2026-09-27',
              late: 5
            }
          ]
        },
        new Date('2026-10-02T08:00:00Z')
      )
    )
    expect(text.startsWith('%PDF-1.7')).toBe(true)
    expectSound(text)
    for (const words of [
      'Bâtiment B12',
      'En retard',
      'Radier coulé',
      'Accès chantier bloqué',
      'Béton C30/37',
      'PL-002 — Plan de coffrage',
      'Visas en attente',
      'PEX-03 — Plan d’exécution',
      '5 j de retard'
    ]) {
      expect(text).toContain(pdfString(words).slice(1, -1))
    }
    // Nothing the fonts cannot draw.
    expect(text).not.toMatch(/\(\?\)|→/)
  })
})
