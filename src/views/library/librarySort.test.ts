import { describe, expect, it } from 'vitest'
import { makeDocument, makeTask, type DocumentMeta, type Task } from '../../types'
import { LIBRARY_SORT_KEYS, lastDepositAt, orderDocuments } from './librarySort'

const doc = (title: string, meta: Partial<DocumentMeta> = {}, over: Partial<Task> = {}): Task =>
  makeTask({ title, type: 'document', start: '', document: makeDocument(meta), ...over })

const titles = (docs: Task[]): string[] => docs.map((task) => task.title)
const asc = { sortDir: 'asc' } as const
const desc = { sortDir: 'desc' } as const

describe('the order a library lists its documents in', () => {
  it('reads by reference by default, which is the order it always had', () => {
    const docs = [doc('Coupe', { reference: 'PL-002' }), doc('Plan', { reference: 'PL-001' })]
    expect(titles(orderDocuments(docs, { sortKey: 'reference', ...asc }))).toEqual(['Plan', 'Coupe'])
  })

  it('falls back on the title, so two documents at one reference stay put', () => {
    const docs = [doc('Zèbre', { reference: 'PL-001' }), doc('Alpha', { reference: 'PL-001' })]
    expect(titles(orderDocuments(docs, { sortKey: 'reference', ...asc }))).toEqual(['Alpha', 'Zèbre'])
    // Reversing the reference must not reverse the tie-break: the two are equal on the
    // field being read, and their order between themselves is not what was asked for.
    expect(titles(orderDocuments(docs, { sortKey: 'reference', ...desc }))).toEqual(['Alpha', 'Zèbre'])
  })

  it('sends a document with no reference yet to the end, where the old order put it first', () => {
    const docs = [doc('Pas encore référencé'), doc('Plan', { reference: 'PL-001' })]
    expect(titles(orderDocuments(docs, { sortKey: 'reference', ...asc }))).toEqual(['Plan', 'Pas encore référencé'])
  })

  it('leaves the list it was given alone', () => {
    const docs = [doc('Coupe', { reference: 'PL-002' }), doc('Plan', { reference: 'PL-001' })]
    orderDocuments(docs, { sortKey: 'reference', ...asc })
    expect(titles(docs)).toEqual(['Coupe', 'Plan'])
  })

  it('puts what is not filled in last, whichever way round', () => {
    const docs = [doc('Sans indice'), doc('Indice B', { issue: 'B' }), doc('Indice A', { issue: 'A' })]
    expect(titles(orderDocuments(docs, { sortKey: 'issue', ...asc }))).toEqual(['Indice A', 'Indice B', 'Sans indice'])
    // A blank is an absent value, not a small one: reversing must not parade it first.
    expect(titles(orderDocuments(docs, { sortKey: 'issue', ...desc }))).toEqual(['Indice B', 'Indice A', 'Sans indice'])
  })

  it('reads a state by the life of a document, not by the letter', () => {
    const docs = [
      doc('Validé', { state: 'approved' }),
      doc('Attendu', { state: 'expected' }),
      doc('En revue', { state: 'in-review' })
    ]
    expect(titles(orderDocuments(docs, { sortKey: 'state', ...asc }))).toEqual(['Attendu', 'En revue', 'Validé'])
  })

  it('reads the last deposit, the newest first when reversed', () => {
    const version = (n: number, at: string) => ({ version: n, file: `f${n}.pdf`, at, by: 'Ana', note: '' })
    const docs = [
      doc('Ancien', { versions: [version(1, '2026-01-05T09:00:00.000Z')] }),
      doc('Récent', { versions: [version(1, '2026-01-02T09:00:00.000Z'), version(2, '2026-03-02T09:00:00.000Z')] }),
      doc('Jamais déposé')
    ]
    expect(titles(orderDocuments(docs, { sortKey: 'deposited', ...desc }))).toEqual([
      'Récent',
      'Ancien',
      'Jamais déposé'
    ])
  })

  it('reads the last deposit as the latest one, not the first', () => {
    const task = doc('Plan', {
      versions: [
        { version: 1, file: 'a.pdf', at: '2026-01-02T09:00:00.000Z', by: 'Ana', note: '' },
        { version: 2, file: 'b.pdf', at: '2026-03-02T09:00:00.000Z', by: 'Ana', note: '' }
      ]
    })
    expect(lastDepositAt(task)).toBe('2026-03-02T09:00:00.000Z')
    expect(lastDepositAt(doc('Attendu'))).toBe('')
  })

  it('sorts by due date, the undated last', () => {
    const docs = [doc('Sans date'), doc('Mars', {}, { due: '2026-03-10' }), doc('Février', {}, { due: '2026-02-10' })]
    expect(titles(orderDocuments(docs, { sortKey: 'due', ...asc }))).toEqual(['Février', 'Mars', 'Sans date'])
  })

  it('offers the document’s own fields, and none of a task’s', () => {
    expect(LIBRARY_SORT_KEYS[0]).toBe('reference')
    // A register is not a plan: priority and progress answer questions nobody asks of
    // a drawing, and there is no drag order in a library to keep.
    expect(LIBRARY_SORT_KEYS).not.toContain('priority')
    expect(LIBRARY_SORT_KEYS).not.toContain('progress')
    expect(LIBRARY_SORT_KEYS).not.toContain('manual')
  })
})
