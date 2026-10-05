import { beforeAll, describe, expect, it } from 'vitest'
import { setLocale } from '../../i18n'
import { buildDocx } from '../../store/docx'
import { buildPdf, pdfString } from '../../store/pdf'
import { emptyReserve } from '../../store/reserve'
import { makeTask, type Task } from '../../types'
import { receptionDocument } from './receptionDocument'

beforeAll(() => setLocale('fr'))

const reserve = (
  title: string,
  company: string,
  number: string,
  over: Partial<Task> = {},
  state = 'open' as const
): Task =>
  makeTask({
    title,
    type: 'reserve',
    start: '',
    due: '2026-10-10',
    assignees: company ? [company] : [],
    reserve: emptyReserve({ number, location: 'Bât. A', lot: 'Lot 08', state }),
    ...over
  })

describe('the handover report', () => {
  it('lists the reserves by contractor, late ones said so, with a signature block for each', () => {
    const tasks = [
      reserve('Peinture écaillée', 'Peintures du Sud', 'R-002'),
      reserve('Plinthe manquante', 'Menuiserie Nord', 'R-001', { due: '2026-09-20' }),
      reserve('Trace au plafond', 'Peintures du Sud', 'R-003', {
        reserve: emptyReserve({ number: 'R-003', severity: 'blocking', photos: ['a.png', 'b.png'] })
      })
    ]
    const doc = receptionDocument(tasks, { project: 'Bâtiment B12', date: '2026-10-02' })
    expect(doc.title).toBe('Procès-verbal de réception — Bâtiment B12')
    const tables = doc.blocks.filter((block) => block.kind === 'table')
    // Two contractors, then the signatures: client, architect and the first contractor, then the second.
    expect(tables).toHaveLength(4)
    for (const table of tables) expect(table.header.reduce((sum, cell) => sum + cell.width, 0)).toBe(9638)
    const text = JSON.stringify(doc.blocks)
    expect(text.indexOf('Peintures du Sud')).toBeLessThan(text.indexOf('Menuiserie Nord'))
    expect(text).toContain('(en retard)')
    expect(text).toContain('2 photos')
    expect(text).toContain('Maître d’ouvrage')
    const first = tables[0]
    expect(first.rows.map((row) => row[0].runs[0].text)).toEqual(['R-002', 'R-003'])
    expect(buildDocx(doc).length).toBeGreaterThan(1000)
    const pdf = Array.from(buildPdf(doc), (byte) => String.fromCharCode(byte)).join('')
    expect(pdf).toContain(pdfString('Peintures').slice(1, -1))
  })

  it('says when there is no reserve', () => {
    const doc = receptionDocument([], { project: 'B12', date: '2026-10-02' })
    expect(JSON.stringify(doc.blocks)).toContain('Réception prononcée sans réserve.')
  })
})
