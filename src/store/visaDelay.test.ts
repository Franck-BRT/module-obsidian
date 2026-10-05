import { describe, expect, it } from 'vitest'
import { makeDocument, makeTask, type DocumentMeta } from '../types'
import { visaWaits, visaWaitsOf, waitWords } from './visaDelay'

const TODAY = '2026-10-05'
const version = (at: string) => ({ version: 1, file: 'f.pdf', at: `${at}T09:00:00.000Z`, by: '', note: '' })
const doc = (meta: Partial<DocumentMeta>, title = 'Note de calcul') =>
  makeTask({
    title,
    type: 'document',
    start: '',
    document: makeDocument({ file: 'f.pdf', state: 'received', ...meta })
  })

describe('the visas a document waits for', () => {
  it('are owed by each reviewer from the deposit, the days counted', () => {
    const waits = visaWaitsOf(doc({ approvers: ['Anne', 'Paul'], versions: [version('2026-09-15')] }), TODAY, 15)
    expect(waits.map((one) => [one.approver, one.received, one.due, one.late])).toEqual([
      ['Anne', '2026-09-15', '2026-09-30', 5],
      ['Paul', '2026-09-15', '2026-09-30', 5]
    ])
  })

  it('no longer from one who signed this issue, but again from one who signed the issue before', () => {
    const task = doc({
      approvers: ['Anne', 'Paul'],
      versions: [version('2026-09-01'), { ...version('2026-10-01'), version: 2 }],
      approvals: [
        { by: 'Anne', at: '2026-10-02T10:00:00.000Z', verdict: 'approved', note: '' },
        { by: 'Paul', at: '2026-09-05T10:00:00.000Z', verdict: 'observations', note: '' }
      ]
    })
    expect(visaWaitsOf(task, TODAY, 15).map((one) => [one.approver, one.late])).toEqual([['Paul', -11]])
  })

  it('takes the document’s own delay, and waits for whoever reviews when nobody is named', () => {
    const [wait] = visaWaitsOf(doc({ versions: [version('2026-10-01')], visaDays: 8 }), TODAY, 15)
    expect(wait).toMatchObject({ approver: '', due: '2026-10-09', late: -4 })
    expect(visaWaitsOf(doc({ state: 'approved', versions: [version('2026-10-01')] }), TODAY, 15)).toEqual([])
  })

  it('are none for a document expected, obsolete or never deposited', () => {
    expect(visaWaitsOf(doc({ state: 'expected', versions: [version('2026-10-01')] }), TODAY, 15)).toEqual([])
    expect(visaWaitsOf(doc({ state: 'obsolete', versions: [version('2026-10-01')] }), TODAY, 15)).toEqual([])
    expect(visaWaitsOf(doc({ approvers: ['Anne'] }), TODAY, 15)).toEqual([])
  })

  it('are listed the latest first, and said in a few words', () => {
    const waits = visaWaits(
      [
        doc({ approvers: ['Anne'], versions: [version('2026-10-01')] }, 'B'),
        doc({ approvers: ['Anne'], versions: [version('2026-09-01')] }, 'A')
      ],
      TODAY,
      () => 15
    )
    expect(waits.map((one) => one.task.title)).toEqual(['A', 'B'])
    const words = { left: (n: number) => `J-${n}`, today: 'aujourd’hui', late: (n: number) => `+${n} j` }
    expect([3, 0, -2].map((late) => waitWords({ late }, words))).toEqual(['+3 j', 'aujourd’hui', 'J-2'])
  })
})
