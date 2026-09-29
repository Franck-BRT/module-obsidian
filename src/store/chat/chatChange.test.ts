import { describe, expect, it } from 'vitest'
import { makeTask } from '../../types'
import { makeRequirement, setText, type Requirement } from '../requirements/Requirement'
import {
  findTicket,
  parseChange,
  pickOption,
  requirementChange,
  ticketChange,
  verificationOptions,
  withoutOpenChange,
  changeBlocks,
  createChange,
  findProject,
  type CreateContext,
  type ChangeSpec,
  type ReqOptions
} from './chatChange'

const spec = (source: object): ChangeSpec => {
  const read = parseChange(JSON.stringify(source))
  if (!('spec' in read)) throw new Error(`unread: ${read.problem}`)
  return read.spec
}

const reqSpec = (source: object): Extract<ChangeSpec, { kind: 'requirement' }> => {
  const read = spec(source)
  if (read.kind !== 'requirement') throw new Error('not a requirement')
  return read
}

const ticketSpec = (source: object): Extract<ChangeSpec, { kind: 'ticket' }> => {
  const read = spec(source)
  if (read.kind !== 'ticket') throw new Error('not a ticket')
  return read
}

const OPTIONS: ReqOptions = {
  statuses: [
    { id: 'draft', label: 'Brouillon' },
    { id: 'approved', label: 'Approuvée' }
  ],
  types: [{ id: 'performance', label: 'Performance' }],
  criticalities: [
    { id: 'high', label: 'Haute' },
    { id: 'low', label: 'Basse' }
  ],
  verifications: verificationOptions((method) => ({ test: 'Essai', analysis: 'Analyse' })[method] ?? method),
  languages: ['fr', 'en']
}

const requirement = (): Requirement =>
  setText(
    makeRequirement({ id: 'REQ-LOG-0002', title: 'Journaux', status: 'draft', sourceLang: 'fr' }),
    'fr',
    'Le calculateur doit transmettre rapidement les journaux.',
    'Anne'
  )

describe('parseChange', () => {
  it('reads a change to a requirement and one to a ticket', () => {
    expect(
      spec({ requirement: 'REQ-LOG-0002', field: 'text', lang: 'FR', value: 'Nouveau.', why: 'Vérifiable.' })
    ).toEqual({
      kind: 'requirement',
      target: 'REQ-LOG-0002',
      field: 'text',
      lang: 'fr',
      value: 'Nouveau.',
      why: 'Vérifiable.'
    })
    expect(spec({ ticket: 'Soutènement', project: 'Génie civil', field: 'due', value: '2026-10-10' })).toEqual({
      kind: 'ticket',
      target: 'Soutènement',
      project: 'Génie civil',
      changes: [{ field: 'due', value: '2026-10-10' }],
      why: ''
    })
    expect(spec({ ticket: 'T', changes: { start: '2026-09-28', Échéance: '2026-10-09' } })).toMatchObject({
      changes: [
        { field: 'start', value: '2026-09-28' },
        { field: 'due', value: '2026-10-09' }
      ]
    })
  })

  // Asked for the English names, a model answering in French sometimes writes the French.
  it('takes the French names of the fields and keys', () => {
    expect(spec({ exigence: 'REQ-A-0001', field: 'énoncé', langue: 'en', valeur: 'X' })).toMatchObject({
      kind: 'requirement',
      field: 'text',
      lang: 'en',
      value: 'X'
    })
    expect(spec({ ticket: 'T', field: 'Échéance', value: '2026-10-10' })).toMatchObject({
      changes: [{ field: 'due' }]
    })
  })

  it('forgives a second fence around the JSON', () => {
    expect(parseChange('```json\n{"ticket": "T", "field": "progress", "value": 50}\n```')).toMatchObject({
      spec: { kind: 'ticket', changes: [{ field: 'progress', value: 50 }] }
    })
  })

  it('says why a block is not a change', () => {
    expect(parseChange('{"ticket": "T", "field": ')).toEqual({ problem: 'unreadable' })
    expect(parseChange('["a"]')).toEqual({ problem: 'unreadable' })
    expect(parseChange('{"field": "title", "value": "X"}')).toEqual({ problem: 'target' })
    expect(parseChange('{"ticket": "T", "requirement": "R", "field": "title"}')).toEqual({ problem: 'target' })
    // Only what the short list allows: a ticket's description is the reader's prose.
    expect(parseChange('{"ticket": "T", "field": "description", "value": "…"}')).toEqual({ problem: 'field' })
    expect(parseChange('{"ticket": "T", "changes": {"due": "2026-10-10", "description": "…"}}')).toEqual({
      problem: 'field'
    })
    expect(parseChange('{"ticket": "T", "changes": {}}')).toEqual({ problem: 'field' })
    expect(parseChange('{"requirement": "R", "field": "id", "value": "REQ-X"}')).toEqual({ problem: 'field' })
  })
})

describe('pickOption', () => {
  it('finds an entry by its label or its id, whatever the case and accents', () => {
    expect(pickOption(OPTIONS.statuses, 'approuvee')?.id).toBe('approved')
    expect(pickOption(OPTIONS.statuses, ' APPROVED ')?.id).toBe('approved')
    expect(pickOption(OPTIONS.statuses, 'Validée')).toBeNull()
    expect(pickOption(OPTIONS.statuses, '')).toBeNull()
  })
})

describe('requirementChange', () => {
  it('rewrites the source wording as a machine’s, unreviewed, bumping the revision', () => {
    const change = requirementChange(
      reqSpec({
        requirement: 'REQ-LOG-0002',
        field: 'text',
        value: 'Le calculateur doit transmettre les journaux en 10 min.'
      }),
      requirement(),
      OPTIONS
    )
    if (!change.ok) throw new Error(change.problem)
    expect(change.before).toBe('Le calculateur doit transmettre rapidement les journaux.')
    expect(change.applied).toBe(false)
    expect(change.change.lang).toBe('fr')
    const after = change.change.apply(requirement(), 'Anne')
    expect(after.text.fr.body).toBe('Le calculateur doit transmettre les journaux en 10 min.')
    expect(after.text.fr).toMatchObject({ origin: 'machine', reviewed: false, by: 'Anne' })
    expect(after.rev).toBe(requirement().rev + 1)
  })

  it('writes a translation in a language of the library, and refuses one outside it', () => {
    const english = requirementChange(
      reqSpec({ requirement: 'R', field: 'text', lang: 'en', value: 'The computer shall…' }),
      requirement(),
      OPTIONS
    )
    expect(english).toMatchObject({ ok: true, before: '', after: 'The computer shall…', applied: false })
    expect(
      requirementChange(reqSpec({ requirement: 'R', field: 'text', lang: 'de', value: 'Der…' }), requirement(), OPTIONS)
    ).toEqual({ ok: false, problem: 'lang', allowed: ['fr', 'en'] })
  })

  it('takes a status by the label the reader sees, and says which exist when it is not one', () => {
    const change = requirementChange(
      reqSpec({ requirement: 'R', field: 'status', value: 'Approuvée' }),
      requirement(),
      OPTIONS
    )
    if (!change.ok) throw new Error(change.problem)
    expect([change.before, change.after, change.applied]).toEqual(['Brouillon', 'Approuvée', false])
    expect(change.change.apply(requirement(), 'Anne').status).toBe('approved')
    expect(
      requirementChange(reqSpec({ requirement: 'R', field: 'status', value: 'Validée' }), requirement(), OPTIONS)
    ).toEqual({ ok: false, problem: 'unknown', allowed: ['Brouillon', 'Approuvée'] })
  })

  it('takes a criticality and a verification method by their labels', () => {
    const critical = requirementChange(
      reqSpec({ requirement: 'R', field: 'criticality', value: 'haute' }),
      requirement(),
      OPTIONS
    )
    expect(critical.ok && critical.change.apply(requirement(), '').criticality).toBe('high')
    const verified = requirementChange(
      reqSpec({ requirement: 'R', field: 'verification', value: 'Essai' }),
      requirement(),
      OPTIONS
    )
    expect(verified.ok && verified.change.apply(requirement(), '').verification).toBe('test')
  })

  // What makes the card say "applied": the requirement already says what was proposed.
  it('knows when the change is already made', () => {
    const same = requirementChange(
      reqSpec({ requirement: 'R', field: 'text', value: 'Le calculateur doit transmettre rapidement les journaux.' }),
      requirement(),
      OPTIONS
    )
    expect(same).toMatchObject({ ok: true, applied: true })
    expect(
      requirementChange(reqSpec({ requirement: 'R', field: 'status', value: 'draft' }), requirement(), OPTIONS)
    ).toMatchObject({ ok: true, applied: true })
  })

  it('refuses an empty wording or title, and allows an empty rationale', () => {
    expect(requirementChange(reqSpec({ requirement: 'R', field: 'text', value: ' ' }), requirement(), OPTIONS)).toEqual(
      {
        ok: false,
        problem: 'empty'
      }
    )
    expect(requirementChange(reqSpec({ requirement: 'R', field: 'title', value: '' }), requirement(), OPTIONS)).toEqual(
      {
        ok: false,
        problem: 'empty'
      }
    )
    const rationale = requirementChange(
      reqSpec({ requirement: 'R', field: 'rationale', value: 'Parce que.' }),
      requirement(),
      OPTIONS
    )
    expect(rationale.ok && rationale.change.apply(requirement(), '').rationale).toBe('Parce que.')
  })
})

describe('ticketChange', () => {
  const LISTS = {
    statuses: [
      { id: 'todo', label: 'À faire' },
      { id: 'in-progress', label: 'En cours' }
    ],
    priorities: [
      { id: 'high', label: 'Haute' },
      { id: 'medium', label: 'Moyenne' }
    ]
  }
  const task = makeTask({
    id: 'k3j9x2ab',
    title: 'Soutènement',
    start: '2026-09-14',
    due: '2026-09-26',
    progress: 60,
    assignees: ['Bruno']
  })
  const change = (source: object) => ticketChange(ticketSpec({ ticket: 'Soutènement', ...source }), task, LISTS)

  it('moves a due date, and says what waits on it may have to move too', () => {
    expect(change({ field: 'due', value: '2026-10-10' })).toEqual({
      ok: true,
      rows: [{ field: 'due', before: '2026-09-26', after: '2026-10-10', applied: false }],
      applied: false,
      change: { patch: { due: '2026-10-10' }, reschedule: true }
    })
  })

  // A task moved two weeks later: read one at a time, its new start would fall after its
  // old due and be refused. Taken together, the pair is checked as it will be.
  it('moves a task in time, its start and due together', () => {
    expect(change({ changes: { start: '2026-09-28', due: '2026-10-09' } })).toEqual({
      ok: true,
      rows: [
        { field: 'start', before: '2026-09-14', after: '2026-09-28', applied: false },
        { field: 'due', before: '2026-09-26', after: '2026-10-09', applied: false }
      ],
      applied: false,
      change: { patch: { start: '2026-09-28', due: '2026-10-09' }, reschedule: true }
    })
    expect(change({ changes: { début: '2026-09-28', échéance: '2026-09-20' } })).toEqual({
      ok: false,
      field: 'due',
      problem: 'order'
    })
  })

  it('is applied only once every field says what was proposed', () => {
    expect(change({ changes: { progress: 60, due: '2026-09-26' } })).toMatchObject({ ok: true, applied: true })
    expect(change({ changes: { progress: 60, due: '2026-09-27' } })).toMatchObject({ ok: true, applied: false })
  })

  it('refuses a date that is not one, or that ends a ticket before it starts', () => {
    expect(change({ field: 'due', value: '10/10/2026' })).toEqual({ ok: false, field: 'due', problem: 'date' })
    expect(change({ field: 'due', value: '2026-02-30' })).toEqual({ ok: false, field: 'due', problem: 'date' })
    expect(change({ field: 'due', value: '2026-09-01' })).toEqual({ ok: false, field: 'due', problem: 'order' })
    expect(change({ field: 'start', value: '2026-09-30' })).toEqual({ ok: false, field: 'start', problem: 'order' })
  })

  it('takes a status and a priority by their labels', () => {
    expect(change({ field: 'status', value: 'en cours' })).toMatchObject({
      ok: true,
      rows: [{ before: 'À faire', after: 'En cours' }],
      change: { patch: { status: 'in-progress' }, reschedule: false }
    })
    expect(change({ field: 'priority', value: 'Critique' })).toEqual({
      ok: false,
      field: 'priority',
      problem: 'unknown',
      allowed: ['Haute', 'Moyenne']
    })
  })

  it('reads a progress however it is written, within 0 to 100', () => {
    expect(change({ field: 'progress', value: '80 %' })).toMatchObject({
      ok: true,
      change: { patch: { progress: 80 } }
    })
    expect(change({ field: 'progress', value: 60 })).toMatchObject({ ok: true, applied: true })
    expect(change({ field: 'progress', value: 120 })).toMatchObject({ ok: false, problem: 'progress' })
    expect(change({ field: 'progress', value: 'beaucoup' })).toMatchObject({ ok: false, problem: 'progress' })
  })

  it('reads the people as a list or as one line', () => {
    expect(change({ field: 'assignees', value: ['Bruno', 'Anne', 'Bruno'] })).toMatchObject({
      ok: true,
      rows: [{ before: 'Bruno', after: 'Bruno, Anne' }],
      change: { patch: { assignees: ['Bruno', 'Anne'] } }
    })
    expect(change({ field: 'assignees', value: 'Anne; Chloé' })).toMatchObject({
      change: { patch: { assignees: ['Anne', 'Chloé'] } }
    })
  })
})

describe('findTicket', () => {
  const candidates = [
    { id: 'a1', title: 'Réception', projectPath: 'Génie civil.md', projectTitle: 'Génie civil' },
    { id: 'b2', title: 'Réception', projectPath: 'Équipements.md', projectTitle: 'Équipements' },
    { id: 'c3', title: 'Soutènement', projectPath: 'Génie civil.md', projectTitle: 'Génie civil' }
  ]

  it('finds a ticket by its title, whatever the case and accents', () => {
    expect(findTicket(candidates, 'soutenement', '')).toEqual({ found: candidates[2] })
  })

  // Two tickets with one title are two tickets: the project decides, or nothing is applied.
  it('uses the project to tell two tickets of one title apart, and refuses to guess', () => {
    expect(findTicket(candidates, 'Réception', 'equipements')).toEqual({ found: candidates[1] })
    expect(findTicket(candidates, 'Réception', '')).toEqual({ problem: 'ambiguous', count: 2 })
    expect(findTicket(candidates, 'Réception', 'Autre')).toEqual({ problem: 'ambiguous', count: 2 })
    expect(findTicket(candidates, 'Terrassements', '')).toEqual({ problem: 'none', count: 0 })
  })
})

describe('withoutOpenChange', () => {
  const block = '```pm-change\n{"ticket": "T", "field": "due", "value": "2026-10-10"}\n```'

  it('sets aside a change block that is not finished', () => {
    expect(withoutOpenChange('Je propose :\n\n```pm-change\n{"ticket": "T", "fie', '…')).toBe('Je propose :\n\n*…*')
  })

  it('sets aside a note being written, fenced by four backticks, until it is closed', () => {
    const open = 'Voici la note :\n\n````pm-note\ntitre: CR\n---\n# CR\n\n```\ncode\n```\n'
    expect(withoutOpenChange(open, '…')).toBe('Voici la note :\n\n*…*')
    const closed = open + '\n````\n\nVoilà.'
    expect(withoutOpenChange(closed, '…')).toBe(closed)
  })

  it('leaves a reply alone once its blocks are closed, or when the open block is not a change', () => {
    const done = `Je propose :\n\n${block}\n\nVoilà.`
    expect(withoutOpenChange(done, '…')).toBe(done)
    const code = 'Exemple :\n\n```ts\nconst a = 1'
    expect(withoutOpenChange(code, '…')).toBe(code)
  })

  it('sets aside only the last block, the finished ones before it staying', () => {
    expect(withoutOpenChange(`${block}\n\n\`\`\`pm-change\n{"tic`, '…')).toBe(`${block}\n\n*…*`)
  })

  // A fence opened inside a code sample is part of the sample, not a block of its own.
  it('does not take a fence inside another block for an opening', () => {
    const sample = '````md\n```pm-change\n{}\n```\n````\n\nFin.'
    expect(withoutOpenChange(sample, '…')).toBe(sample)
  })
})

describe('changeBlocks', () => {
  it('finds every finished change block of a reply, and nothing else', () => {
    const reply = [
      'Deux décalages :',
      '```pm-change',
      '{"ticket": "A", "field": "due", "value": "2026-10-10"}',
      '```',
      '```ts',
      'const b = 1',
      '```',
      '~~~pm-change',
      '{"ticket": "B", "field": "progress", "value": 50}',
      '~~~',
      '````md',
      '```pm-change',
      '{"ticket": "exemple"}',
      '```',
      '````',
      '```pm-change',
      '{"ticket": "pas fini"'
    ].join('\n')
    expect(changeBlocks(reply)).toEqual([
      '{"ticket": "A", "field": "due", "value": "2026-10-10"}',
      '{"ticket": "B", "field": "progress", "value": 50}'
    ])
  })
})

describe('creating a ticket', () => {
  const createSpec = (source: object): Extract<ChangeSpec, { kind: 'create' }> => {
    const read = spec(source)
    if (read.kind !== 'create') throw new Error('not a creation')
    return read
  }
  const context: CreateContext = {
    project: { path: 'Work/Génie civil.md', title: 'Génie civil' },
    tickets: [
      { id: 'lot1', title: 'Terrassements', type: 'phase' },
      { id: 'sout', title: 'Soutènement', type: 'task' }
    ],
    statuses: [
      { id: 'todo', label: 'À faire' },
      { id: 'doing', label: 'En cours' }
    ],
    priorities: [
      { id: 'high', label: 'Haute' },
      { id: 'medium', label: 'Moyenne' }
    ],
    types: [
      { id: 'task', label: 'Tâche' },
      { id: 'milestone', label: 'Jalon' },
      { id: 'phase', label: 'Lot' },
      { id: 'document', label: 'Document' }
    ],
    defaultStatus: 'todo',
    defaultPriority: 'medium',
    candidates: [
      { id: 'sout', title: 'Soutènement', projectPath: 'Work/Génie civil.md', projectTitle: 'Génie civil' },
      { id: 'pomp', title: 'Livraison des pompes', projectPath: 'Work/Équipements.md', projectTitle: 'Équipements' },
      { id: 'r1', title: 'Réception', projectPath: 'Work/Génie civil.md', projectTitle: 'Génie civil' },
      { id: 'r2', title: 'Réception', projectPath: 'Work/Équipements.md', projectTitle: 'Équipements' }
    ]
  }

  it('reads a creation, its place and its fields', () => {
    expect(
      createSpec({
        create: 'Radier',
        project: 'Génie civil',
        parent: 'Terrassements',
        changes: { début: '2026-10-19', due: '2026-11-13', personnes: ['Chloé'], après: ['Soutènement'] },
        why: 'Au planning, pas de ticket.'
      })
    ).toEqual({
      kind: 'create',
      title: 'Radier',
      project: 'Génie civil',
      parent: 'Terrassements',
      fields: [
        { field: 'start', value: '2026-10-19' },
        { field: 'due', value: '2026-11-13' },
        { field: 'assignees', value: ['Chloé'] },
        { field: 'after', value: ['Soutènement'] }
      ],
      why: 'Au planning, pas de ticket.'
    })
    expect(parseChange('{"create": "X", "changes": {"description": "…"}}')).toEqual({ problem: 'field' })
    expect(parseChange('{"create": "X", "ticket": "Y"}')).toEqual({ problem: 'target' })
  })

  it('makes a task in its lot, waiting on what it follows, as the editor would start one', () => {
    const made = createChange(
      createSpec({
        create: 'Radier',
        project: 'Génie civil',
        parent: 'terrassements',
        changes: { start: '2026-10-19', due: '2026-11-13', assignees: 'Chloé', after: 'Soutènement' }
      }),
      context
    )
    expect(made).toEqual({
      ok: true,
      rows: [
        { field: 'parent', after: 'Terrassements' },
        { field: 'start', after: '2026-10-19' },
        { field: 'due', after: '2026-11-13' },
        { field: 'assignees', after: 'Chloé' },
        { field: 'after', after: 'Soutènement' }
      ],
      applied: false,
      change: {
        task: {
          title: 'Radier',
          start: '2026-10-19',
          due: '2026-11-13',
          assignees: ['Chloé'],
          type: 'task',
          status: 'todo',
          priority: 'medium',
          dependencies: ['sout']
        },
        parentId: 'lot1',
        reschedule: true
      }
    })
  })

  // Under a ticket that is not a lot, a new one is its subtask — as the editor makes it.
  it('makes a subtask under a ticket, and a milestone on its one day', () => {
    const under = createChange(
      createSpec({ create: 'Blindage', project: 'Génie civil', parent: 'Soutènement' }),
      context
    )
    expect(under).toMatchObject({ ok: true, change: { task: { type: 'subtask', start: '' }, parentId: 'sout' } })
    const milestone = createChange(
      createSpec({ create: 'Réception radier', project: 'Génie civil', changes: { type: 'jalon', due: '2026-11-13' } }),
      context
    )
    expect(milestone).toMatchObject({
      ok: true,
      change: { task: { type: 'milestone', start: '2026-11-13', due: '2026-11-13' }, parentId: null, reschedule: false }
    })
  })

  it('knows it is made once the project holds a ticket of that title', () => {
    expect(createChange(createSpec({ create: 'soutenement', project: 'Génie civil' }), context)).toMatchObject({
      ok: true,
      applied: true
    })
  })

  // What it goes under and what it waits on are found by title, and never guessed.
  it('refuses a parent or a predecessor it cannot find, or that is not the only one', () => {
    expect(createChange(createSpec({ create: 'X', project: 'Génie civil', parent: 'Fondations' }), context)).toEqual({
      ok: false,
      problem: 'parent',
      allowed: ['Fondations']
    })
    const twice = { ...context, tickets: [...context.tickets, { id: 'lot2', title: 'Terrassements', type: 'phase' }] }
    expect(createChange(createSpec({ create: 'X', project: 'Génie civil', parent: 'Terrassements' }), twice)).toEqual({
      ok: false,
      problem: 'parent',
      allowed: ['Terrassements']
    })
    expect(
      createChange(createSpec({ create: 'X', project: 'Génie civil', changes: { after: ['Inconnu'] } }), context)
    ).toEqual({ ok: false, problem: 'after', allowed: ['Inconnu'] })
    // Two "Réception": the one in this project is taken, as a model naming it would mean.
    expect(
      createChange(createSpec({ create: 'X', project: 'Génie civil', changes: { after: ['Réception'] } }), context)
    ).toMatchObject({ ok: true, change: { task: { dependencies: ['r1'] } } })
    // And one in another project can be waited on too.
    expect(
      createChange(
        createSpec({ create: 'X', project: 'Génie civil', changes: { after: 'Livraison des pompes' } }),
        context
      )
    ).toMatchObject({ ok: true, change: { task: { dependencies: ['pomp'] } } })
  })

  it('refuses an unknown type, a date that is not one, and an end before the start', () => {
    expect(createChange(createSpec({ create: 'X', project: 'P', changes: { type: 'Épopée' } }), context)).toEqual({
      ok: false,
      problem: 'unknown',
      allowed: ['Tâche', 'Jalon', 'Lot', 'Document']
    })
    expect(createChange(createSpec({ create: 'X', project: 'P', changes: { due: '13/11/2026' } }), context)).toEqual({
      ok: false,
      problem: 'date'
    })
    expect(
      createChange(
        createSpec({ create: 'X', project: 'P', changes: { start: '2026-11-13', due: '2026-10-19' } }),
        context
      )
    ).toEqual({ ok: false, problem: 'order' })
  })
})

describe('findProject', () => {
  const projects = [
    { path: 'Work/Génie civil.md', title: 'Génie civil' },
    { path: 'Work/Équipements.md', title: 'Équipements' }
  ]

  it('finds a project by its title or its path, and only one', () => {
    expect(findProject(projects, 'genie civil')).toEqual(projects[0])
    expect(findProject(projects, 'Work/Équipements')).toEqual(projects[1])
    expect(findProject(projects, 'Autre')).toBeNull()
    expect(findProject(projects, '')).toBeNull()
    expect(findProject([projects[0]], '')).toEqual(projects[0])
  })
})
