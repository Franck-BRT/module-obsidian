import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES, makeDocument, makeProject, makeTask, type Task } from '../../types'
import {
  collectionParts,
  currentCollections,
  currentProjects,
  projectContext,
  projectShare,
  PROJECT_BUDGET,
  withoutNested,
  projectParts,
  type ProjectContextInput,
  type ProjectWords
} from './chatProject'

const WORDS: ProjectWords = {
  heading: (title, path) => `Projet joint : ${title} (${path})`,
  program: 'programme',
  field: {
    description: 'Description',
    team: 'Équipe',
    zones: 'Zones',
    span: 'Période',
    summary: 'Bilan',
    tickets: 'Tickets'
  },
  summary: ({ total, done, progress, late, soon }) =>
    `${total} tickets, ${done} terminés, ${progress} %, ${late} en retard, ${soon} bientôt`,
  type: (type) => ({ milestone: 'Jalon', phase: 'Lot', document: 'Document' })[type] ?? type,
  docState: (state) => ({ expected: 'Attendu' })[state] ?? state,
  late: 'EN RETARD',
  after: 'après',
  reference: 'réf.',
  issue: 'indice',
  file: 'fichier',
  noTickets: '(aucun ticket)',
  doneLeft: (count) => `(${count} tickets terminés non montrés)`,
  left: (count) => `(${count} autres non montrés faute de place)`
}

const TODAY = '2026-09-28'

const task = (id: string, overrides: Partial<Task> = {}): Task =>
  makeTask({ id, title: `Tâche ${id}`, start: '', ...overrides })

const input = (tasks: Task[], overrides: Partial<ProjectContextInput> = {}): ProjectContextInput => ({
  title: 'Refonte chaufferie',
  path: 'Projets/Refonte chaufferie.md',
  program: false,
  description: '',
  team: [],
  zones: [],
  parts: [{ title: 'Refonte chaufferie', path: 'Projets/Refonte chaufferie.md', tasks }],
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  today: TODAY,
  ...overrides
})

describe('projectContext', () => {
  it('writes the project, its figures, and every ticket in its tree', () => {
    const plan = [
      task('LOT-1', {
        title: 'Études',
        type: 'phase',
        subtasks: [
          task('T-1', { title: 'Relevé', status: 'done', start: '2026-09-01', due: '2026-09-10' }),
          task('T-2', {
            title: 'Note de calcul',
            status: 'in-progress',
            priority: 'high',
            start: '2026-09-11',
            due: '2026-09-25',
            progress: 40,
            assignees: ['Anne', 'Bob'],
            dependencies: ['T-1']
          })
        ]
      }),
      task('M-1', { title: 'Revue', type: 'milestone', due: '2026-10-02' })
    ]
    const text = projectContext(
      input(plan, { description: 'Remplacer la chaudière.', team: ['Anne', 'Bob'], zones: ['Bât. B'] }),
      WORDS
    )
    expect(text).toBe(
      [
        'Projet joint : Refonte chaufferie (Projets/Refonte chaufferie.md)',
        '<project path="Projets/Refonte chaufferie.md">',
        '# Refonte chaufferie',
        'Description : Remplacer la chaudière.',
        'Équipe : Anne, Bob',
        'Zones : Bât. B',
        'Période : 2026-09-01 → 2026-10-02',
        'Bilan : 3 tickets, 1 terminés, 47 %, 1 en retard, 1 bientôt',
        '',
        'Tickets :',
        '- Études · Lot · 2026-09-01 → 2026-09-25 · 70 %',
        '  - Relevé · Done · Medium · 2026-09-01 → 2026-09-10',
        '  - Note de calcul · In Progress · High · 2026-09-11 → 2026-09-25 · 40 % · @ Anne, Bob · après Relevé · EN RETARD',
        '- Revue · Jalon · To Do · Medium · 2026-10-02',
        '</project>'
      ].join('\n')
    )
  })

  // Late is said in words, and only of work still to do: a finished ticket past its date is
  // history, and today's is not late yet.
  it('calls late only what is open and past its date', () => {
    const text = projectContext(
      input([
        task('A', { due: '2026-09-27' }),
        task('B', { due: TODAY }),
        task('C', { due: '2026-09-01', status: 'done' }),
        task('D', { due: '2026-09-01', status: 'cancelled' })
      ]),
      WORDS
    )
    const late = text.split('\n').filter((line) => line.includes('EN RETARD'))
    expect(late).toEqual(['- Tâche A · To Do · Medium · 2026-09-27 · EN RETARD'])
  })

  it('names a document’s state and a ticket of a kind of its own', () => {
    const text = projectContext(input([task('D', { type: 'document' })]), WORDS)
    expect(text).toContain('- Tâche D · Document · Attendu · To Do · Medium')
  })

  // What a document is known by: its reference, its revision mark, its file — not the
  // identifier the plugin keys it by.
  it('names a document by what the trade calls it', () => {
    const plan = [
      task('k3j9x2ab', {
        title: 'Plan de ventilation',
        type: 'document',
        document: makeDocument({
          state: 'received',
          reference: 'PL-VEN-001',
          issue: 'B',
          file: 'Projets/Ligne 6/_docs/PL-VEN-001 indice B.pdf'
        })
      })
    ]
    expect(projectContext(input(plan), WORDS)).toContain(
      '- Plan de ventilation · Document · received · réf. PL-VEN-001 · indice B · fichier PL-VEN-001 indice B.pdf · To Do'
    )
  })

  // A ticket's identifier is a random string: shown to a model, it is what the model
  // quotes back, and the reader cannot tell one ticket from another by it.
  it('never shows a ticket’s identifier, and names what a ticket waits for by its title', () => {
    const plan = [
      task('q8z1m0rt', {
        title: 'Terrassements',
        type: 'phase',
        subtasks: [
          task('a7c2kq9d', { title: 'Déblais' }),
          task('p4x8w2ne', { title: 'Soutènement', dependencies: ['a7c2kq9d', 'x0elsewh', 'gone1234'] })
        ]
      })
    ]
    const text = projectContext(
      input(plan, { titleOf: (id) => (id === 'x0elsewh' ? 'Livraison des pompes' : undefined) }),
      WORDS
    )
    for (const id of ['q8z1m0rt', 'a7c2kq9d', 'p4x8w2ne', 'x0elsewh', 'gone1234']) expect(text).not.toContain(id)
    expect(text).toContain('après Déblais, Livraison des pompes')
  })

  it('writes a programme’s projects each under its own name', () => {
    const text = projectContext(
      input([], {
        program: true,
        parts: [
          { title: 'Lot chaufferie', path: 'a.md', tasks: [task('A-1')] },
          { title: 'Lot ventilation', path: 'b.md', tasks: [task('B-1')] }
        ]
      }),
      WORDS
    )
    expect(text).toContain('# Refonte chaufferie (programme)')
    expect(text).toContain('## Lot chaufferie\n- Tâche A-1')
    expect(text).toContain('## Lot ventilation\n- Tâche B-1')
    expect(text).toContain('Bilan : 2 tickets')
  })

  it('says when there is nothing to show', () => {
    expect(projectContext(input([]), WORDS)).toContain('Tickets :\n(aucun ticket)\n</project>')
  })

  it('keeps a long description to its opening', () => {
    const text = projectContext(input([], { description: 'x'.repeat(3000) }), WORDS)
    expect(text).toContain(`Description : ${'x'.repeat(1500)}…\n`)
  })

  // Over the budget, the work still to do goes first: finished leaves make room, the lots
  // and parents holding open work stay, and the model is told what it was not shown.
  it('leaves the finished tickets out first when they do not all fit', () => {
    const done = Array.from({ length: 30 }, (_, at) => task(`F-${at}`, { status: 'done' }))
    const plan = [
      task('LOT', { type: 'phase', subtasks: [task('P', { status: 'done', subtasks: [task('OPEN')] })] }),
      ...done
    ]
    const all = projectContext(input(plan), WORDS, 100_000)
    expect(all).toContain('- Tâche F-29 ')
    const text = projectContext(input(plan), WORDS, 200)
    expect(text).not.toContain('- Tâche F-')
    expect(text).toContain('- Tâche LOT · Lot')
    expect(text).toContain('  - Tâche P · Done')
    expect(text).toContain('    - Tâche OPEN · To Do')
    expect(text).toContain('(30 tickets terminés non montrés)')
    expect(text).not.toContain('faute de place')
  })

  it('cuts what is still too long, and says how many were not shown', () => {
    const plan = Array.from({ length: 40 }, (_, at) => task(`O-${at}`))
    const text = projectContext(input(plan), WORDS, 300)
    const shown = text.split('\n').filter((line) => line.startsWith('- Tâche O-')).length
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(40)
    expect(text).toContain(`(${40 - shown} autres non montrés faute de place)`)
    const lines = text.slice(text.indexOf('Tickets :')).split('\n')
    expect(lines.filter((line) => line.startsWith('- ')).join('\n').length).toBeLessThanOrEqual(300)
  })
})

describe('currentProjects', () => {
  it('is the projects of the latest question', () => {
    expect(
      currentProjects([
        { role: 'user', projects: ['a.md'] },
        { role: 'assistant' },
        { role: 'user', projects: ['b.md', 'c.md'] },
        { role: 'assistant' }
      ])
    ).toEqual(['b.md', 'c.md'])
    expect(currentProjects([{ role: 'user', projects: ['a.md'] }, { role: 'user' }])).toEqual([])
  })
})

describe('several projects', () => {
  // A programme brings the projects under it: one of them attached beside it is not
  // written a second time.
  it('are each written once', () => {
    const ancestors: Record<string, string[]> = { 'gc.md': ['l6.md'], 'eq.md': ['l6.md'], 'l6.md': [] }
    const of = (path: string): string[] => ancestors[path] ?? []
    expect(withoutNested(['gc.md', 'l6.md', 'autre.md', 'gc.md'], of)).toEqual(['l6.md', 'autre.md'])
    expect(withoutNested(['gc.md', 'eq.md'], of)).toEqual(['gc.md', 'eq.md'])
  })

  it('share the room, each keeping enough to be read', () => {
    expect(projectShare(1)).toBe(PROJECT_BUDGET)
    expect(projectShare(2)).toBe(PROJECT_BUDGET)
    expect(projectShare(4)).toBe(PROJECT_BUDGET / 2)
    expect(projectShare(20)).toBe(6000)
  })
})

describe('projectParts', () => {
  it('puts the project asked about first, then the ones under it, without the archive', () => {
    const programme = { ...makeProject('Zénith', 'Zenith.md'), program: true }
    const alpha = makeProject('Alpha', 'Alpha.md')
    alpha.tasks = [
      task('A-1', { subtasks: [task('A-2', { archived: true }), task('A-3')] }),
      task('A-4', { archived: true })
    ]
    const beta = makeProject('Beta', 'Beta.md')
    beta.tasks = [task('B-1')]
    // Sorted by title, as the store gives them: the programme is not first by luck.
    const parts = projectParts(programme, [alpha, beta, programme])
    expect(parts.map((part) => part.title)).toEqual(['Alpha', 'Beta'])
    expect(parts[0].tasks.map((one) => one.id)).toEqual(['A-1'])
    expect(parts[0].tasks[0].subtasks.map((one) => one.id)).toEqual(['A-3'])
    // The project itself is left as it was: the view that loaded it still shows it.
    expect(alpha.tasks[0].subtasks).toHaveLength(2)
  })

  it('keeps a programme that holds tickets after all, first', () => {
    const programme = { ...makeProject('Zénith', 'Zenith.md'), program: true }
    programme.tasks = [task('Z-1')]
    const alpha = makeProject('Alpha', 'Alpha.md')
    expect(projectParts(programme, [alpha, programme]).map((part) => part.title)).toEqual(['Zénith', 'Alpha'])
  })
})

describe('collectionParts', () => {
  it('writes a collection’s tickets under the projects that hold them, without the archive', () => {
    const alpha = makeProject('Alpha', 'Alpha.md')
    const late = task('A-1', { subtasks: [task('A-2'), task('A-3', { archived: true })] })
    alpha.tasks = [late, task('A-4')]
    const beta = makeProject('Beta', 'Beta.md')
    beta.tasks = [task('B-1', { subtasks: [task('B-2')] })]
    const gamma = makeProject('Gamma', 'Gamma.md')
    gamma.tasks = [task('G-1')]
    // The roots the collection gathers: a ticket in Alpha, a subtask in Beta, an archived one.
    const parts = collectionParts(
      [late, beta.tasks[0].subtasks[0], task('X', { archived: true })],
      [alpha, beta, gamma]
    )
    expect(parts.map((part) => [part.title, part.tasks.map((one) => one.id)])).toEqual([
      ['Alpha', ['A-1']],
      ['Beta', ['B-2']]
    ])
    expect(parts[0].tasks[0].subtasks.map((one) => one.id)).toEqual(['A-2'])
  })

  it('is what the latest question was asked about', () => {
    expect(currentCollections([{ role: 'user', collections: ['c.md'] }, { role: 'assistant' }])).toEqual(['c.md'])
    expect(currentCollections([{ role: 'user', collections: ['c.md'] }, { role: 'user' }])).toEqual([])
  })
})
