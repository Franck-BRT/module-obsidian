import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeDocument, makeTask } from '../../types'
import { foldLine, icsCalendar, icsEvents, icsText, ICS_KINDS, type IcsWords } from './ics'

const words: IcsWords = {
  project: 'B12',
  meeting: (title) => title,
  milestone: (title) => `◆ ${title}`,
  due: (title) => `Échéance : ${title}`,
  decision: (title) => `Décision : ${title}`,
  document: (title) => `Document : ${title}`,
  reserve: (title) => `Réserve : ${title}`,
  phase: (title) => `Lot : ${title}`,
  category: (kind) => kind,
  people: (names) => names.join(', ')
}

describe('the calendar file', () => {
  it('escapes text and folds long lines at 75 octets', () => {
    expect(icsText('a, b; c\\d\ne')).toBe(String.raw`a\, b\; c\\d\ne`)
    const long = `SUMMARY:${'é'.repeat(60)}`
    const folded = foldLine(long).split('\r\n ')
    expect(folded.length).toBe(2)
    for (const part of folded) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75)
    expect(folded.join('')).toBe(long)
  })

  it('holds the meetings at their hours, the milestones, and what is due and still open', () => {
    const tasks = [
      makeTask({
        id: 'lot',
        title: 'Gros œuvre',
        type: 'phase',
        start: '',
        subtasks: [
          makeTask({ id: 'a', title: 'Coulage', start: '2026-10-14', due: '2026-10-16', assignees: ['Garonne'] }),
          makeTask({ id: 'b', title: 'Fini', start: '', due: '2026-10-10', status: 'done' })
        ]
      }),
      makeTask({ id: 'm', title: 'Radier coulé', type: 'milestone', start: '', due: '2026-10-16' }),
      makeTask({
        id: 'r',
        title: 'Réunion n°5',
        type: 'meeting',
        start: '',
        due: '2026-10-15',
        startTime: '09:00',
        endTime: '10:30'
      }),
      makeTask({
        id: 'd',
        title: 'Plan',
        type: 'document',
        start: '',
        due: '2026-10-20',
        document: makeDocument({ reference: 'PL-1', issuer: 'BET' })
      })
    ]
    const events = icsEvents(tasks, DEFAULT_STATUSES, ICS_KINDS, words)
    expect(events.map((event) => [event.summary, event.start, event.end])).toEqual([
      ['Lot : Gros œuvre', '2026-10-10', '2026-10-17'],
      ['Réunion n°5', '2026-10-15T09:00', '2026-10-15T10:30'],
      ['◆ Radier coulé', '2026-10-16', '2026-10-17'],
      ['Échéance : Coulage', '2026-10-16', '2026-10-17'],
      ['Document : PL-1 — Plan', '2026-10-20', '2026-10-21']
    ])
    expect(icsEvents(tasks, DEFAULT_STATUSES, ['milestones'], words)).toHaveLength(1)

    const file = icsCalendar('B12', events, new Date('2026-10-12T08:00:00Z'))
    expect(file.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(file).toContain(
      'UID:r-meetings@black-projects\r\nDTSTAMP:20261012T080000Z\r\nDTSTART:20261015T090000\r\nDTEND:20261015T103000'
    )
    expect(file).toContain('DTSTART;VALUE=DATE:20261016\r\nDTEND;VALUE=DATE:20261017')
    expect(file).toContain('DESCRIPTION:B12\\nGaronne')
    expect(file.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(file).not.toMatch(/[^\r]\n/)
  })
})
