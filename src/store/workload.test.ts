import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeDocument, makeTask, type Task } from '../types'
import { displayName } from '../utils'
import { makeWorkCalendar } from './WorkCalendar'
import { loadLevel, mondayOf, weekStarts, workload, type LoadProject } from './workload'

// A Friday: its week starts on Monday the 28th of September.
const TODAY = '2026-10-02'
const WEEKDAYS = makeWorkCalendar([1, 2, 3, 4, 5])
const options = {
  today: TODAY,
  weeks: 4,
  defaultHoursPerDay: 4,
  meetingHours: 1,
  keyOf: (raw: string) => displayName(raw).toLowerCase()
}
const project = (title: string, tasks: Task[]): LoadProject => ({
  path: `Work/${title}.md`,
  title,
  tasks,
  statuses: DEFAULT_STATUSES,
  calendar: WEEKDAYS
})
const hoursOf = (plan: ReturnType<typeof workload>, name: string): number[] =>
  plan.people.find((person) => person.key === name)?.hours ?? []

describe('the weeks', () => {
  it('start on the Monday of the week holding today', () => {
    expect(mondayOf(TODAY)).toBe('2026-09-28')
    expect(weekStarts(TODAY, 3)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12'])
  })
})

describe('the load of a person', () => {
  it('spreads what is left of an estimate over the working days to its due date', () => {
    const plan = workload(
      [
        project('B12', [
          makeTask({
            title: 'Ferraillage',
            start: '2026-10-05',
            due: '2026-10-16',
            timeEstimate: 40,
            assignees: ['Paul']
          })
        ])
      ],
      options
    )
    expect(hoursOf(plan, 'paul')).toEqual([0, 20, 20, 0])
  })

  it('shares an estimate between its people, and takes its progress off', () => {
    const plan = workload(
      [
        project('B12', [
          makeTask({
            title: 'Ferraillage',
            start: '2026-10-05',
            due: '2026-10-16',
            timeEstimate: 40,
            progress: 50,
            assignees: ['Paul', 'Anne']
          })
        ])
      ],
      options
    )
    expect(hoursOf(plan, 'paul')).toEqual([0, 5, 5, 0])
    expect(hoursOf(plan, 'anne')).toEqual([0, 5, 5, 0])
  })

  it('counts set hours a day for a ticket with no estimate, from today', () => {
    const plan = workload(
      [project('B12', [makeTask({ title: 'Coffrage', start: '2026-10-01', due: '2026-10-06', assignees: ['Paul'] })])],
      options
    )
    // Friday, then Monday and Tuesday.
    expect(hoursOf(plan, 'paul')).toEqual([4, 8, 0, 0])
    expect(plan.people[0].pieces[1][0]).toMatchObject({ title: 'Coffrage', hours: 8, estimated: false })
  })

  it('puts what is left of late work in the current week, said late', () => {
    const plan = workload(
      [
        project('B12', [
          makeTask({ title: 'Plans', start: '', due: '2026-09-25', timeEstimate: 10, assignees: ['Paul'] })
        ])
      ],
      options
    )
    expect(hoursOf(plan, 'paul')).toEqual([10, 0, 0, 0])
    expect(plan.people[0].pieces[0][0].late).toBe(true)
  })

  it('counts a meeting’s own hours for each who attends', () => {
    const meeting = makeTask({
      title: 'Réunion de chantier',
      type: 'meeting',
      start: '',
      due: '2026-10-07',
      startTime: '09:00',
      endTime: '10:30',
      assignees: ['Paul', 'Anne']
    })
    const plan = workload([project('B12', [meeting])], options)
    expect(hoursOf(plan, 'paul')).toEqual([0, 1.5, 0, 0])
    expect(hoursOf(plan, 'anne')).toEqual([0, 1.5, 0, 0])
  })

  it('leaves out what is done, lots, risks, decisions and documents with no estimate', () => {
    const plan = workload(
      [
        project('B12', [
          makeTask({ title: 'Fait', start: '2026-10-05', due: '2026-10-09', status: 'done', assignees: ['Paul'] }),
          makeTask({ title: 'Lot 02', type: 'phase', start: '2026-10-05', due: '2026-10-30', assignees: ['Paul'] }),
          makeTask({ title: 'Gel', type: 'risk', start: '', due: '2026-10-08', assignees: ['Paul'] }),
          makeTask({ title: 'Choix', type: 'decision', start: '', due: '2026-10-08', assignees: ['Paul'] }),
          makeTask({
            title: 'Plan',
            type: 'document',
            start: '',
            due: '2026-10-08',
            assignees: ['Paul'],
            document: makeDocument()
          })
        ])
      ],
      options
    )
    expect(plan.people).toEqual([])
  })

  it('adds up one person across projects, however their name is written, nobody’s work last', () => {
    const plan = workload(
      [
        project('B12', [
          makeTask({
            title: 'A',
            start: '2026-10-05',
            due: '2026-10-09',
            timeEstimate: 10,
            assignees: ['[[People/Paul|Paul]]']
          })
        ]),
        project('C7', [
          makeTask({ title: 'B', start: '2026-10-05', due: '2026-10-09', timeEstimate: 30, assignees: ['Paul'] }),
          makeTask({ title: 'C', start: '2026-10-05', due: '2026-10-09', timeEstimate: 5 }),
          makeTask({ title: 'D', start: '', due: '', timeEstimate: 6, assignees: ['Anne'] })
        ])
      ],
      options
    )
    expect(plan.people.map((person) => person.key)).toEqual(['paul', 'anne', ''])
    expect(hoursOf(plan, 'paul')).toEqual([0, 40, 0, 0])
    expect(plan.people[0].pieces[1].map((piece) => piece.projectTitle)).toEqual(['C7', 'B12'])
    expect(plan.people[1].unscheduled).toMatchObject([{ title: 'D', hours: 6 }])
  })
})

describe('a week against a capacity', () => {
  it('is under, near or over', () => {
    expect(loadLevel(0, 35)).toBe('empty')
    expect(loadLevel(20, 35)).toBe('under')
    expect(loadLevel(32, 35)).toBe('near')
    expect(loadLevel(40, 35)).toBe('over')
  })
})
