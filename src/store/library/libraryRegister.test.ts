import { describe, expect, it } from 'vitest'
import { makeDocument, makeProject, makeTask, type DocumentMeta, type Task } from '../../types'
import { likeness, registerCandidates, registerEntries } from './libraryRegister'

const ticket = (title: string, document: Partial<DocumentMeta>, subtasks: Task[] = []): Task =>
  makeTask({ title, type: 'document', document: makeDocument(document), subtasks })
const version = (n: number, file: string) => ({ version: n, file, at: '2026-09-28', by: '', note: '' })

describe('registerEntries', () => {
  it('finds a file as a ticket’s current file and as an earlier version, in every project', () => {
    const gc = makeProject('Génie civil', 'GC.md')
    const plan = ticket('Plan de coffrage', {
      file: 'Library/_files/Plan B.pdf',
      linked: true,
      versions: [version(1, 'Library/_files/Plan A.pdf'), version(2, 'Library/_files/Plan B.pdf')]
    })
    const nested = ticket('Note de calcul', {
      file: 'Library/_files/NDC.pdf',
      versions: [version(1, 'Library/_files/NDC.pdf')]
    })
    // A ticket that was a document once, and still carries what it held, is not one now.
    const former = makeTask({ title: 'Ancien document', document: makeDocument({ file: 'Library/_files/Vieux.pdf' }) })
    gc.tasks = [plan, makeTask({ title: 'Lot', subtasks: [nested] }), makeTask({ title: 'Tâche' }), former]
    const tunnel = makeProject('Tunnel', 'T.md')
    tunnel.tasks = [ticket('Plan de coffrage (copie)', { file: 'Library/_files/Plan B.pdf', versions: [] })]

    const entries = registerEntries([gc, tunnel])
    expect(
      entries.get('Library/_files/Plan B.pdf')?.map((e) => [e.project.title, e.task.title, e.current, e.version])
    ).toEqual([
      ['Génie civil', 'Plan de coffrage', true, 2],
      ['Tunnel', 'Plan de coffrage (copie)', true, 1]
    ])
    expect(entries.get('Library/_files/Plan A.pdf')?.map((e) => [e.current, e.version])).toEqual([[false, 1]])
    expect(entries.get('Library/_files/NDC.pdf')?.map((e) => e.task.title)).toEqual(['Note de calcul'])
    expect(entries.size).toBe(3)
  })

  it('leaves out a ticket still awaited, which has no file', () => {
    const gc = makeProject('Génie civil', 'GC.md')
    gc.tasks = [ticket('Planning', { state: 'expected' })]
    expect(registerEntries([gc]).size).toBe(0)
  })
})

describe('registerCandidates', () => {
  it('offers the awaited tickets first, the likeliest first among them, then the others', () => {
    const gc = makeProject('Génie civil', 'GC.md')
    const noted = ticket('Note de calcul', { state: 'expected', reference: 'NDC-01' })
    const planning = ticket('Planning génie civil', { state: 'expected', reference: 'PL-02' })
    const received = ticket('Planning ancien', { state: 'received', file: 'x.pdf', reference: 'PL-01' })
    const current = ticket('Planning courant', { state: 'received', file: 'Library/_files/Planning GC indice C.pdf' })
    gc.tasks = [noted, received, planning, current, makeTask({ title: 'Planning' })]
    expect(
      registerCandidates(gc, 'Planning GC indice C', 'Library/_files/Planning GC indice C.pdf').map(
        (task) => task.title
      )
    ).toEqual(['Planning génie civil', 'Note de calcul', 'Planning ancien'])
  })

  it('orders tickets that look alike by reference, numbers read as numbers', () => {
    const gc = makeProject('Génie civil', 'GC.md')
    gc.tasks = [ticket('B', { reference: 'PL-10' }), ticket('A', { reference: 'PL-2' })]
    expect(registerCandidates(gc, 'Sans rapport', 'z.pdf').map((task) => task.title)).toEqual(['A', 'B'])
  })
})

describe('likeness', () => {
  it('counts the words a ticket shares with a document’s title and file name, whatever the accents', () => {
    const planning = ticket('Planning génie civil', { reference: 'PL-02' })
    expect(likeness(planning, 'Planning GC', 'Planning_genie_civil_indC.pdf')).toBe(3)
    expect(likeness(planning, 'Compte rendu', 'CR 12.pdf')).toBe(0)
    // Words of one or two letters — an issue letter, « de » — say nothing about a document.
    expect(likeness(ticket('Plan', { reference: 'A' }), 'Plan A', 'a.pdf')).toBe(1)
    // The reference counts too, as the words it is written with.
    expect(likeness(ticket('Coffrage', { reference: 'PLN-004' }), 'pln-004 coffrage', 'x.pdf')).toBe(3)
  })
})
