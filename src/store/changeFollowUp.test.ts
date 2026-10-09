import { describe, expect, it } from 'vitest'
import { makeTask, type TaskChange } from '../types'
import { emptyChange, recordDecision } from './change'
import { approvesProposal, changeDigest, closesChange, implementationLines, nextIssue } from './changeFollowUp'

const ticket = (number: string, over: Partial<TaskChange> = {}, title = number) =>
  makeTask({ title, type: 'change', change: emptyChange({ number, ...over }) })

describe('the next issue of a document', () => {
  it('counts on a number, its zeros kept, and on a letter', () => {
    expect(nextIssue('02')).toBe('03')
    expect(nextIssue('9')).toBe('10')
    expect(nextIssue('2-15')).toBe('2-16')
    expect(nextIssue('A')).toBe('B')
    expect(nextIssue('b')).toBe('c')
    expect(nextIssue('Z')).toBe('AA')
    expect(nextIssue('AZ')).toBe('BA')
  })

  it('starts at what is given when there is none yet', () => {
    expect(nextIssue('')).toBe('A')
    expect(nextIssue('  ', '1')).toBe('1')
  })
})

describe('what follows a decision', () => {
  it('offers the proposal’s own list as the tickets, else one named after the change', () => {
    const listed = ticket('DM-004', {
      proposal: 'Remplacer le joint :\n- Commander le joint IP67\n2. Monter et tester\nfin'
    })
    expect(implementationLines(listed)).toEqual(['Commander le joint IP67', 'Monter et tester'])
    expect(implementationLines(ticket('DM-005', { proposal: 'Texte libre' }, 'Joint'))).toEqual(['DM-005 — Joint'])
  })

  it('knows a proposal approved, and a change closed, from the decision just taken', () => {
    const waitingPm = ticket('DM-001', {
      submittedOn: '2026-09-01',
      rounds: [{ round: 0, decision: 'accepted', date: '2026-09-02', comment: '' }]
    })
    const approved = { change: recordDecision(waitingPm.change as TaskChange, 1, 'accepted', '2026-10-01') }
    expect(approvesProposal(waitingPm, approved)).toBe(true)
    expect(closesChange(waitingPm, approved)).toBe(false)
    const closed = { change: recordDecision(approved.change, 2, 'accepted', '2026-10-09') }
    expect(closesChange(approved, closed)).toBe(true)
    const postponed = { change: recordDecision(waitingPm.change as TaskChange, 1, 'postponed', '2026-10-01') }
    expect(approvesProposal(waitingPm, postponed)).toBe(false)
  })
})

describe('a project’s changes on its dashboard', () => {
  it('counts the next sitting by group, the proposals overdue, and the month’s closures', () => {
    const accepted = (date: string) => [{ round: 0 as const, decision: 'accepted' as const, date, comment: '' }]
    const tasks = [
      ticket('DM-001', { submittedOn: '2026-08-01', group: 1 }),
      ticket('DM-002', { submittedOn: '2026-08-01', group: 1, rounds: accepted('2026-08-20') }),
      ticket('DM-003', { submittedOn: '2026-10-01', group: 2, rounds: accepted('2026-10-01') }),
      ticket('DM-004', { submittedOn: '2026-10-01' }),
      ticket('DM-005', {
        submittedOn: '2026-08-01',
        rounds: [
          ...accepted('2026-08-02'),
          { round: 1, decision: 'accepted', date: '2026-09-01', comment: '' },
          { round: 2, decision: 'accepted', date: '2026-10-03', comment: '' }
        ]
      }),
      ticket('DM-006'),
      ticket('DM-007', {
        submittedOn: '2026-08-01',
        rounds: [{ round: 0, decision: 'rejected', date: '2026-08-02', comment: '' }]
      })
    ]
    const digest = changeDigest(tasks, '2026-10-09')
    expect(digest.open).toBe(5)
    expect(digest.nextBoard).toEqual([
      { group: 1, count: 2 },
      { group: 2, count: 1 },
      { group: 0, count: 1 }
    ])
    expect(digest.toExamine).toBe(4)
    expect(digest.stale.map((one) => [one.task.change?.number, one.days])).toEqual([['DM-002', 50]])
    expect(digest.closedThisMonth).toBe(1)
  })
})
