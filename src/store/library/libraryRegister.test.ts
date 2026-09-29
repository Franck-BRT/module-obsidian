import { describe, expect, it } from 'vitest'
import { makeDocument, makeProject, makeTask, type DocumentMeta, type Task } from '../../types'
import {
  likeness,
  matchScore,
  proposeMatches,
  registerCandidates,
  registerEntries,
  registerFilesOutside
} from './libraryRegister'

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

describe('matchScore', () => {
  const awaited = (title: string, reference = ''): Task => ticket(title, { state: 'expected', reference })

  it('takes the reference written in the name as all but proof, however it is written', () => {
    expect(matchScore(awaited('Plan de coffrage', 'PL-002'), 'x', 'pl_002 indice B.pdf')).toBeGreaterThanOrEqual(10)
    expect(matchScore(awaited('Plan de coffrage', 'PL-002'), 'PL 002', 'scan.pdf')).toBeGreaterThanOrEqual(10)
    // A short reference is found in too many names to count.
    expect(matchScore(awaited('Note', 'A2'), 'Plan A2', 'a2.pdf')).toBe(0)
  })

  it('wants most of the title’s words, not one word every document of the kind shares', () => {
    expect(matchScore(awaited('Planning génie civil'), 'Planning GC', 'Planning_genie_civil_indC.pdf')).toBe(3)
    expect(matchScore(awaited('Planning génie civil'), 'Planning équipements', 'planning.pdf')).toBe(0)
    expect(matchScore(awaited('Note de calcul du radier'), 'NDC', 'Note de calcul radier.pdf')).toBe(3)
    expect(matchScore(awaited('Note de calcul du radier'), 'Note de calcul des pieux', 'x.pdf')).toBe(0)
    expect(matchScore(awaited('Plan coffrage'), 'Plan de coffrage', 'x.pdf')).toBe(2)
    // An issue, a version, the little words: they say nothing about which document it is.
    expect(matchScore(awaited('Rapport indice version'), 'Rapport', 'indice version.pdf')).toBe(0)
  })

  it('adds the words to the reference', () => {
    expect(matchScore(awaited('Plan de coffrage', 'PLN-004'), 'Plan de coffrage', 'PLN-004.pdf')).toBe(12)
  })
})

describe('proposeMatches', () => {
  const awaited = (title: string, reference = ''): Task => ticket(title, { state: 'expected', reference })
  const subject = (title: string, projects: string[], key = title) => ({
    key,
    title,
    file: `Library/_files/${title}.pdf`,
    projects
  })

  it('offers each file the awaited tickets of its projects it looks like, the likeliest first', () => {
    const gc = makeProject('Génie civil', 'GC.md')
    const coffrage = awaited('Plan de coffrage radier', 'PL-002')
    const ferraillage = awaited('Plan de ferraillage radier')
    // Already received, it is no longer waited for: never proposed, however like it is.
    const received = ticket('Plan de coffrage radier', { state: 'received', file: 'x.pdf', reference: 'PL-002' })
    gc.tasks = [ferraillage, coffrage, received]
    const tunnel = makeProject('Tunnel', 'T.md')
    tunnel.tasks = [awaited('Plan de coffrage radier tunnel')]
    const [proposal] = proposeMatches([subject('PL-002 coffrage radier', ['GC.md'])], [gc, tunnel])
    expect(proposal.candidates.map((c) => c.task.title)).toEqual(['Plan de coffrage radier'])
    expect(proposal.chosen?.task).toBe(coffrage)
  })

  it('lists a file’s candidates the likeliest first', () => {
    const gc = makeProject('Génie civil', 'GC.md')
    // In the order of their titles, the weaker would come first.
    const weaker = awaited('Plan radier')
    const stronger = awaited('Radier coffrage plan', 'PL-002')
    gc.tasks = [weaker, stronger]
    const [proposal] = proposeMatches([subject('PL-002 plan coffrage radier', ['GC.md'])], [gc])
    expect(proposal.candidates.map((c) => c.task)).toEqual([stronger, weaker])
  })

  it('gives a ticket to the file it looks most like, the other its next likeliest', () => {
    const gc = makeProject('Génie civil', 'GC.md')
    const coffrage = awaited('Plan coffrage radier', 'PL-002')
    const ferraillage = awaited('Plan ferraillage radier')
    gc.tasks = [coffrage, ferraillage]
    const proposals = proposeMatches(
      [subject('Plan coffrage ferraillage radier', ['GC.md'], 'a'), subject('PL-002 coffrage radier', ['GC.md'], 'b')],
      [gc]
    )
    const chosen = new Map(proposals.map((p) => [p.subject.key, p.chosen?.task.title]))
    expect(chosen.get('b')).toBe('Plan coffrage radier')
    expect(chosen.get('a')).toBe('Plan ferraillage radier')
  })

  it('looks everywhere for a file of no project, but only by its reference', () => {
    const gc = makeProject('Génie civil', 'GC.md')
    gc.tasks = [awaited('Plan de coffrage radier', 'PL-002'), awaited('Note de calcul radier')]
    const [byReference] = proposeMatches([subject('PL-002', [])], [gc])
    expect(byReference.chosen?.task.title).toBe('Plan de coffrage radier')
    expect(proposeMatches([subject('Note de calcul radier', [])], [gc])).toEqual([])
  })

  it('leaves out a file that looks like nothing awaited, and a ticket no file is left for', () => {
    const gc = makeProject('Génie civil', 'GC.md')
    const only = awaited('Plan coffrage radier')
    gc.tasks = [only]
    const proposals = proposeMatches(
      [
        subject('Plan coffrage radier A', ['GC.md'], 'a'),
        subject('Plan coffrage radier B', ['GC.md'], 'b'),
        subject('Facture', ['GC.md'])
      ],
      [gc]
    )
    expect(proposals.map((p) => p.subject.key)).toEqual(['a', 'b'])
    expect(proposals.filter((p) => p.chosen).map((p) => p.subject.key)).toEqual(['a'])
    expect(proposals[1].candidates.map((c) => c.task)).toEqual([only])
  })
})

describe('registerFilesOutside', () => {
  const gc = makeProject('Génie civil', 'GC.md')
  gc.tasks = [
    ticket('Plan de coffrage', {
      file: 'GC/_docs/Plan.pdf',
      issuer: 'Setec',
      versions: [version(1, 'GC/_docs/_versions/Plan-v1.pdf'), version(2, 'GC/_docs/Plan.pdf')]
    }),
    ticket('Note de calcul', { file: 'Library/_files/NDC.pdf', versions: [version(1, 'Library/_files/NDC.pdf')] }),
    ticket('Planning', { state: 'expected' }),
    makeTask({ title: 'Tâche', document: makeDocument({ file: 'GC/autre.pdf' }) })
  ]
  const tunnel = makeProject('Tunnel', 'T.md')
  tunnel.tasks = [
    ticket('Plan de coffrage partagé', { file: 'GC/_docs/Plan.pdf', versions: [] }),
    ticket('Ancien plan', { file: 'T/_docs/Nouveau.pdf', versions: [version(1, 'GC/_docs/_versions/Plan-v1.pdf')] })
  ]
  const inLibrary = new Set(['Library/_files/NDC.pdf'])

  it('lists the current files the library lacks, one a file, belonging to every register holding it', () => {
    expect(registerFilesOutside([gc, tunnel], inLibrary, false)).toEqual([
      {
        file: 'GC/_docs/Plan.pdf',
        title: 'Plan de coffrage',
        issuer: 'Setec',
        projects: ['GC.md', 'T.md'],
        current: true
      },
      { file: 'T/_docs/Nouveau.pdf', title: 'Ancien plan', issuer: '', projects: ['T.md'], current: true }
    ])
  })

  it('adds the earlier versions when asked, titled with their number', () => {
    const files = registerFilesOutside([gc, tunnel], inLibrary, true)
    expect(files.find((f) => f.file === 'GC/_docs/_versions/Plan-v1.pdf')).toEqual({
      file: 'GC/_docs/_versions/Plan-v1.pdf',
      title: 'Plan de coffrage (v1)',
      issuer: 'Setec',
      projects: ['GC.md', 'T.md'],
      current: false
    })
    expect(files).toHaveLength(3)
  })

  it('takes a file’s title from the register it is current in', () => {
    const later = makeProject('Later', 'L.md')
    later.tasks = [ticket('Nouveau plan', { file: 'GC/_docs/_versions/Plan-v1.pdf', versions: [] })]
    const file = registerFilesOutside([gc, later], inLibrary, true).find(
      (f) => f.file === 'GC/_docs/_versions/Plan-v1.pdf'
    )
    expect(file).toMatchObject({ title: 'Nouveau plan', issuer: '', current: true, projects: ['GC.md', 'L.md'] })
  })
})
