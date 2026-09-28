import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES, makeProject, makeTask, type Task } from '../../types'
import {
  currentProject,
  projectContext,
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
        '- LOT-1 Études · Lot · 2026-09-01 → 2026-09-25 · 70 %',
        '  - T-1 Relevé · Done · Medium · 2026-09-01 → 2026-09-10',
        '  - T-2 Note de calcul · In Progress · High · 2026-09-11 → 2026-09-25 · 40 % · @ Anne, Bob · après T-1 · EN RETARD',
        '- M-1 Revue · Jalon · To Do · Medium · 2026-10-02',
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
    expect(late).toEqual(['- A Tâche A · To Do · Medium · 2026-09-27 · EN RETARD'])
  })

  it('names a document’s state and a ticket of a kind of its own', () => {
    const text = projectContext(input([task('D', { type: 'document' })]), WORDS)
    expect(text).toContain('- D Tâche D · Document · Attendu · To Do · Medium')
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
    expect(text).toContain('## Lot chaufferie\n- A-1 Tâche A-1')
    expect(text).toContain('## Lot ventilation\n- B-1 Tâche B-1')
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
    expect(all).toContain('- F-29 ')
    const text = projectContext(input(plan), WORDS, 200)
    expect(text).not.toContain('- F-')
    expect(text).toContain('- LOT Tâche LOT · Lot')
    expect(text).toContain('  - P Tâche P · Done')
    expect(text).toContain('    - OPEN Tâche OPEN · To Do')
    expect(text).toContain('(30 tickets terminés non montrés)')
    expect(text).not.toContain('faute de place')
  })

  it('cuts what is still too long, and says how many were not shown', () => {
    const plan = Array.from({ length: 40 }, (_, at) => task(`O-${at}`))
    const text = projectContext(input(plan), WORDS, 300)
    const shown = text.split('\n').filter((line) => line.startsWith('- O-')).length
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(40)
    expect(text).toContain(`(${40 - shown} autres non montrés faute de place)`)
    const lines = text.slice(text.indexOf('Tickets :')).split('\n')
    expect(lines.filter((line) => line.startsWith('- ')).join('\n').length).toBeLessThanOrEqual(300)
  })
})

describe('currentProject', () => {
  it('is the project of the latest question', () => {
    expect(
      currentProject([
        { role: 'user', project: 'a.md' },
        { role: 'assistant' },
        { role: 'user', project: 'b.md' },
        { role: 'assistant' }
      ])
    ).toBe('b.md')
    expect(currentProject([{ role: 'user', project: 'a.md' }, { role: 'user' }])).toBeUndefined()
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
