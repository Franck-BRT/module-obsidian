import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeDocument, makeTask, type DocumentMeta, type Task } from '../types'
import {
  bordereauRows,
  documentOf,
  isAwaited,
  isDocument,
  nextVersion,
  pendingApprovers,
  recordApproval,
  recordDeposit,
  reopen,
  statusForState
} from './Document'

const doc = (over: Partial<DocumentMeta> = {}): DocumentMeta => makeDocument(over)
const task = (over: Partial<Task> = {}): Task => makeTask({ type: 'document', start: '', ...over })
const deposit = (file: string, at = '2026-03-02T09:00:00.000Z') => ({ file, at, by: 'Ana', note: '' })

describe('depositing a file', () => {
  it('numbers deposits from one, and never reuses a number', () => {
    let meta = recordDeposit(doc(), deposit('_docs/plan.pdf'))
    expect(meta.versions.map((v) => v.version)).toEqual([1])
    meta = recordDeposit(meta, {
      ...deposit('_docs/plan.pdf'),
      archived: { version: 1, file: '_versions/plan-v1.pdf' }
    })
    expect(meta.versions.map((v) => v.version)).toEqual([1, 2])
    expect(nextVersion(meta)).toBe(3)
  })

  it('points the document at the file that just landed', () => {
    const meta = recordDeposit(doc(), deposit('_docs/plan.pdf'))
    expect(meta.file).toBe('_docs/plan.pdf')
  })

  it('remembers where the version it replaced was put away', () => {
    const first = recordDeposit(doc(), deposit('_docs/plan.pdf'))
    const second = recordDeposit(first, {
      ...deposit('_docs/plan.pdf'),
      archived: { version: 1, file: '_docs/_versions/plan-v1.pdf' }
    })
    expect(second.versions[0].file).toBe('_docs/_versions/plan-v1.pdf')
    expect(second.versions[1].file).toBe('_docs/plan.pdf')
  })

  it('answers an expectation: the document is received', () => {
    expect(recordDeposit(doc(), deposit('_docs/plan.pdf')).state).toBe('received')
  })

  it('does not approve a new issue of an approved document on its own', () => {
    const approved = doc({ state: 'approved' })
    expect(recordDeposit(approved, deposit('_docs/plan.pdf')).state).toBe('approved')
  })
})

describe('approvals', () => {
  const at = '2026-03-02T09:00:00.000Z'

  it('waits for every named approver', () => {
    let meta = doc({ state: 'in-review', approvers: ['Ana', 'Bo'] })
    meta = recordApproval(meta, { by: 'Ana', at, verdict: 'approved', note: '' })
    expect(meta.state).toBe('in-review')
    expect(pendingApprovers(meta)).toEqual(['Bo'])
    meta = recordApproval(meta, { by: 'Bo', at, verdict: 'approved', note: '' })
    expect(meta.state).toBe('approved')
  })

  it('lets one refusal outweigh the others', () => {
    let meta = doc({ state: 'in-review', approvers: ['Ana', 'Bo'] })
    meta = recordApproval(meta, { by: 'Ana', at, verdict: 'approved', note: '' })
    meta = recordApproval(meta, { by: 'Bo', at, verdict: 'rejected', note: 'échelle fausse' })
    expect(meta.state).toBe('in-review')
  })

  it('does not approve while a refusal still stands', () => {
    let meta = doc({ state: 'in-review', approvers: ['Ana', 'Bo'] })
    meta = recordApproval(meta, { by: 'Bo', at, verdict: 'rejected', note: '' })
    meta = recordApproval(meta, { by: 'Ana', at, verdict: 'approved', note: '' })
    expect(meta.state).toBe('in-review')
  })

  it('lets someone change their mind, keeping one verdict per person', () => {
    let meta = doc({ state: 'in-review', approvers: ['Bo'] })
    meta = recordApproval(meta, { by: 'Bo', at, verdict: 'rejected', note: '' })
    meta = recordApproval(meta, { by: 'Bo', at, verdict: 'approved', note: '' })
    expect(meta.approvals).toHaveLength(1)
    expect(meta.state).toBe('approved')
  })

  it('approves on the spot when nobody was named, rather than waiting on an empty list', () => {
    const meta = recordApproval(doc({ state: 'in-review' }), { by: 'Ana', at, verdict: 'approved', note: '' })
    expect(meta.state).toBe('approved')
  })

  it('drops the visas when the document is reopened: a visa signs a version', () => {
    const approved = doc({
      state: 'approved',
      approvers: ['Ana'],
      approvals: [{ by: 'Ana', at, verdict: 'approved', note: '' }]
    })
    const again = reopen(approved)
    expect(again.state).toBe('in-review')
    expect(again.approvals).toEqual([])
    expect(pendingApprovers(again)).toEqual(['Ana'])
  })
})

describe('the status a state implies', () => {
  it('reads the palette rather than naming statuses', () => {
    expect(statusForState('approved', DEFAULT_STATUSES)).toBe('done')
    expect(statusForState('expected', DEFAULT_STATUSES)).toBe('todo')
    expect(statusForState('in-review', DEFAULT_STATUSES)).toBe('in-progress')
  })

  it('sends an obsolete document to whatever the palette keeps for abandoned work', () => {
    expect(statusForState('obsolete', DEFAULT_STATUSES)).toBe('cancelled')
  })

  it('says nothing when the palette has nothing to offer', () => {
    expect(statusForState('approved', [])).toBeNull()
  })

  it('falls back to the only open status when a palette has just one', () => {
    const two = DEFAULT_STATUSES.filter((s) => s.id === 'todo' || s.id === 'done')
    expect(statusForState('in-review', two)).toBe('todo')
  })
})

describe('what is still awaited', () => {
  it('counts an expected document whose date has passed', () => {
    expect(isAwaited(task({ due: '2026-03-01', document: doc() }), '2026-03-02')).toBe(true)
  })

  it('leaves alone one that has arrived, however late', () => {
    expect(isAwaited(task({ due: '2026-03-01', document: doc({ state: 'received' }) }), '2026-03-02')).toBe(false)
  })

  it('leaves alone one that is not due yet, and one with no date at all', () => {
    expect(isAwaited(task({ due: '2026-04-01', document: doc() }), '2026-03-02')).toBe(false)
    expect(isAwaited(task({ due: '', document: doc() }), '2026-03-02')).toBe(false)
  })

  it('is not a question you can ask of an ordinary task', () => {
    expect(isAwaited(makeTask({ type: 'task', due: '2026-03-01' }), '2026-03-02')).toBe(false)
  })
})

describe('the bordereau', () => {
  it('lists what is being sent, at which issue, ordered by reference', () => {
    const rows = bordereauRows([
      task({
        title: 'Plan de masse',
        document: doc({
          reference: 'PL-002',
          issue: 'B',
          recipient: 'MOA',
          versions: [{ version: 2, file: 'f', at: '2026-03-02T09:00:00.000Z', by: 'Ana', note: '' }]
        })
      }),
      task({ title: 'CCTP', document: doc({ reference: 'CC-001', issue: 'A', recipient: 'MOA' }) })
    ])
    expect(rows.map((r) => r.reference)).toEqual(['CC-001', 'PL-002'])
    expect(rows[1]).toMatchObject({ title: 'Plan de masse', issue: 'B', version: 'v2', date: '2026-03-02' })
  })

  it('leaves a document with no deposit without a version or a date, rather than inventing one', () => {
    const [row] = bordereauRows([task({ title: 'CCTP', document: doc() })])
    expect(row.version).toBe('')
    expect(row.date).toBe('')
  })

  it('ignores anything that is not a document', () => {
    expect(bordereauRows([makeTask({ type: 'task', title: 'Poser les fondations' })])).toEqual([])
  })
})

describe('reading a ticket', () => {
  it('knows a document from a task', () => {
    expect(isDocument(task())).toBe(true)
    expect(isDocument(makeTask({ type: 'task' }))).toBe(false)
  })

  it('hands back an empty document rather than nothing, so no caller has to test', () => {
    expect(documentOf(makeTask({ type: 'document' })).state).toBe('expected')
  })
})
