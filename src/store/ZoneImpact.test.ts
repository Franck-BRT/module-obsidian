import { describe, expect, it } from 'vitest'
import {
  affects,
  dueImpactNotices,
  worstLevel,
  impactsByTask,
  impactsForProjects,
  otherSide,
  spanOf,
  vaultOccupancies,
  zoneImpacts,
  type ImpactInputs,
  type ImpactLevel,
  type ProjectImpactRole,
  type ZoneOccupancy
} from './ZoneImpact'

let seq = 0
const at = (
  project: string,
  zone: string,
  start: string,
  due = start,
  title = `t${++seq}`,
  role: ProjectImpactRole = 'both',
  level: ImpactLevel = 'caution'
): ZoneOccupancy => ({
  taskId: `${project}-${title}`,
  title,
  projectPath: `P/${project}.md`,
  projectTitle: project,
  zone,
  start,
  due,
  role,
  level
})

const pairs = (occupancies: ZoneOccupancy[]): string[] =>
  zoneImpacts(occupancies)
    .map((impact) => `${impact.zone}: ${impact.a.taskId}×${impact.b.taskId} ${impact.from}→${impact.to}`)
    .sort()

describe('the days a ticket stands in a zone', () => {
  it('runs from its start to its due date', () => {
    expect(spanOf({ start: '2026-04-06', due: '2026-04-10' })).toEqual({ start: '2026-04-06', due: '2026-04-10' })
  })

  /** A milestone marks one day; a deadline with no start is at least there on the day. */
  it('is the one day it has when it has only one', () => {
    expect(spanOf({ start: '', due: '2026-04-10' })).toEqual({ start: '2026-04-10', due: '2026-04-10' })
    expect(spanOf({ start: '2026-04-06', due: '' })).toEqual({ start: '2026-04-06', due: '2026-04-06' })
  })

  it('is nowhere when the ticket has no date at all', () => {
    expect(spanOf({ start: '', due: '' })).toBeNull()
  })

  /** Reversed dates are a typo, not a span running backwards, and must not vanish. */
  it('straightens a span someone typed the wrong way round', () => {
    expect(spanOf({ start: '2026-04-10', due: '2026-04-06' })).toEqual({ start: '2026-04-06', due: '2026-04-10' })
  })
})

describe('two projects in one zone', () => {
  it('reports a crossing', () => {
    const impacts = zoneImpacts([
      at('lancement', 'RN7', '2026-04-06', '2026-04-10', 'transfert'),
      at('voirie', 'RN7', '2026-04-08', '2026-04-14', 'reprise')
    ])
    expect(impacts).toHaveLength(1)
    expect(impacts[0]).toMatchObject({ zone: 'RN7', from: '2026-04-08', to: '2026-04-10' })
  })

  it('says nothing when the zones differ', () => {
    expect(pairs([at('a', 'RN7', '2026-04-06', '2026-04-10'), at('b', 'RN12', '2026-04-06', '2026-04-10')])).toEqual([])
  })

  it('says nothing when the dates do not meet', () => {
    expect(pairs([at('a', 'RN7', '2026-04-06', '2026-04-10'), at('b', 'RN7', '2026-04-11', '2026-04-14')])).toEqual([])
  })

  /** A project already knows what it is doing to itself; saying so would bury the news. */
  it('says nothing about one project crossing itself', () => {
    expect(pairs([at('a', 'RN7', '2026-04-06', '2026-04-10'), at('a', 'RN7', '2026-04-08', '2026-04-14')])).toEqual([])
  })

  it('counts a single shared day', () => {
    const impacts = zoneImpacts([
      at('a', 'RN7', '2026-04-06', '2026-04-10'),
      at('b', 'RN7', '2026-04-10', '2026-04-14')
    ])
    expect(impacts).toHaveLength(1)
    expect(impacts[0]).toMatchObject({ from: '2026-04-10', to: '2026-04-10' })
  })

  /** A launch day is a single date, and it is exactly the kind that must be caught. */
  it('catches a one-day ticket falling inside a long one', () => {
    const impacts = zoneImpacts([
      at('chantier', 'RN7', '2026-04-01', '2026-04-30'),
      at('lancement', 'RN7', '2026-04-15')
    ])
    expect(impacts).toHaveLength(1)
    expect(impacts[0]).toMatchObject({ from: '2026-04-15', to: '2026-04-15' })
  })

  it('reports each pair once, not once per side', () => {
    expect(
      pairs([at('a', 'RN7', '2026-04-06', '2026-04-10', 'x'), at('b', 'RN7', '2026-04-07', '2026-04-09', 'y')])
    ).toHaveLength(1)
  })

  it('reports every pair when three projects meet', () => {
    const three = [
      at('a', 'RN7', '2026-04-06', '2026-04-20', 'x'),
      at('b', 'RN7', '2026-04-08', '2026-04-12', 'y'),
      at('c', 'RN7', '2026-04-10', '2026-04-11', 'z')
    ]
    expect(zoneImpacts(three)).toHaveLength(3)
  })

  /** The sweep drops what has ended; a ticket after the gap must still be compared. */
  it('does not lose a crossing that comes after a gap in the zone', () => {
    const found = pairs([
      at('a', 'RN7', '2026-01-01', '2026-01-05', 'early'),
      at('b', 'RN7', '2026-06-01', '2026-06-10', 'later'),
      at('c', 'RN7', '2026-06-05', '2026-06-06', 'meets')
    ])
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('2026-06-05→2026-06-06')
  })

  /**
   * The sweep drops what has ended. It must drop only that: a long ticket still running
   * has to survive a short one beside it expiring, or every later crossing with it is
   * silently lost — which is the one failure this whole feature cannot afford.
   */
  it('keeps a long ticket in view when a short one beside it ends', () => {
    const found = pairs([
      at('chantier', 'RN7', '2026-04-01', '2026-04-30', 'long'),
      at('livraison', 'RN7', '2026-04-02', '2026-04-03', 'court'),
      at('lancement', 'RN7', '2026-04-10', '2026-04-12', 'apres')
    ])
    expect(found).toHaveLength(2)
    expect(found.some((line) => line.includes('apres'))).toBe(true)
  })

  it('handles a zone with one ticket, and no tickets at all', () => {
    expect(zoneImpacts([at('a', 'RN7', '2026-04-06')])).toEqual([])
    expect(zoneImpacts([])).toEqual([])
  })

  it('leaves the list it was given alone', () => {
    const given = [at('b', 'RN7', '2026-04-08'), at('a', 'RN7', '2026-04-06')]
    const before = given.map((o) => o.taskId)
    zoneImpacts(given)
    expect(given.map((o) => o.taskId)).toEqual(before)
  })
})

describe('reading an impact from one side', () => {
  const mine = at('lancement', 'RN7', '2026-04-06', '2026-04-10', 'transfert')
  const theirs = at('voirie', 'RN7', '2026-04-08', '2026-04-14', 'reprise')
  const impacts = zoneImpacts([mine, theirs])

  it('finds every impact a ticket is in, from either side', () => {
    const byTask = impactsByTask(impacts)
    expect(byTask.get(mine.taskId)).toHaveLength(1)
    expect(byTask.get(theirs.taskId)).toHaveLength(1)
  })

  it('answers with the far end, never the near one', () => {
    expect(otherSide(impacts[0], mine.taskId).taskId).toBe(theirs.taskId)
    expect(otherSide(impacts[0], theirs.taskId).taskId).toBe(mine.taskId)
  })

  it('keeps the impacts touching the projects in view', () => {
    expect(impactsForProjects(impacts, ['P/lancement.md'])).toHaveLength(1)
    expect(impactsForProjects(impacts, ['P/autre.md'])).toHaveLength(0)
  })
})

describe('placing the whole vault in its zones', () => {
  const project = (
    path: string,
    zones: string[] = [],
    template = false,
    role: ProjectImpactRole = 'both',
    level: ImpactLevel = 'caution'
  ) => ({ path, title: path, zones, template, role, level })
  const task = (over: Partial<ImpactInputs['tasks'][number]> = {}): ImpactInputs['tasks'][number] => ({
    id: 't',
    title: 't',
    projectPath: 'P/a.md',
    start: '2026-04-06',
    due: '2026-04-10',
    status: 'todo',
    zones: [],
    archived: false,
    ...over
  })
  const run = (over: Partial<ImpactInputs>): ZoneOccupancy[] =>
    vaultOccupancies({ tasks: [], projects: [project('P/a.md')], isComplete: (s) => s === 'done', ...over })

  it('uses the ticket own zones when it names any', () => {
    const found = run({ tasks: [task({ zones: ['RN7', 'RN12'] })] })
    expect(found.map((o) => o.zone)).toEqual(['RN7', 'RN12'])
  })

  /** Declared once for a project that is entirely in one place. */
  it('falls back to the project zones when the ticket names none', () => {
    const found = run({ tasks: [task()], projects: [project('P/a.md', ['Quai 3'])] })
    expect(found.map((o) => o.zone)).toEqual(['Quai 3'])
  })

  it('lets a ticket override its project rather than adding to it', () => {
    const found = run({ tasks: [task({ zones: ['RN7'] })], projects: [project('P/a.md', ['Quai 3'])] })
    expect(found.map((o) => o.zone)).toEqual(['RN7'])
  })

  it('leaves out what is not in play', () => {
    const projects = [project('P/a.md', ['RN7']), project('P/t.md', ['RN7'], true)]
    expect(run({ tasks: [task({ start: '', due: '' })], projects })).toEqual([])
    expect(run({ tasks: [task({ archived: true })], projects })).toEqual([])
    expect(run({ tasks: [task({ status: 'done' })], projects })).toEqual([])
    expect(run({ tasks: [task({ projectPath: 'P/t.md' })], projects })).toEqual([])
    expect(run({ tasks: [task({ projectPath: null })], projects })).toEqual([])
  })

  it('says nothing at all when no zone has been declared anywhere', () => {
    expect(run({ tasks: [task()] })).toEqual([])
  })
})

describe('a project that only ever disturbs', () => {
  const launch = (start: string, due = start) => at('lancement', 'RN7', start, due, 'jour-J', 'emitter')
  const works = (start: string, due = start) => at('voirie', 'RN7', start, due, 'reprise', 'both')

  /** A launch day decides the date; everything else works around it. */
  it('still disturbs the projects it meets', () => {
    const impacts = zoneImpacts([launch('2026-04-15'), works('2026-04-10', '2026-04-20')])
    expect(impacts).toHaveLength(1)
    expect(affects(impacts[0], 'voirie-reprise')).toBe(true)
  })

  it('is not itself disturbed by them', () => {
    const impacts = zoneImpacts([launch('2026-04-15'), works('2026-04-10', '2026-04-20')])
    expect(affects(impacts[0], 'lancement-jour-J')).toBe(false)
    // And so it carries no warning of its own.
    expect(impactsByTask(impacts).get('lancement-jour-J')).toBeUndefined()
    expect(impactsByTask(impacts).get('voirie-reprise')).toHaveLength(1)
  })

  it('has nothing to say to another project that also only disturbs', () => {
    const other = at('essais', 'RN7', '2026-04-14', '2026-04-16', 'essai', 'emitter')
    expect(zoneImpacts([launch('2026-04-15'), other])).toEqual([])
  })

  it('disturbs one that only listens', () => {
    const listener = at('bureau', 'RN7', '2026-04-14', '2026-04-16', 'revue', 'receiver')
    const impacts = zoneImpacts([launch('2026-04-15'), listener])
    expect(impacts).toHaveLength(1)
    expect(affects(impacts[0], 'bureau-revue')).toBe(true)
    expect(affects(impacts[0], 'lancement-jour-J')).toBe(false)
  })

  it('leaves two ordinary projects disturbing each other both ways', () => {
    const impacts = zoneImpacts([
      works('2026-04-10', '2026-04-20'),
      at('autre', 'RN7', '2026-04-15', '2026-04-16', 'x')
    ])
    expect(impacts[0].direction).toBe('both')
    expect(affects(impacts[0], 'voirie-reprise')).toBe(true)
    expect(affects(impacts[0], 'autre-x')).toBe(true)
  })

  it('says nothing at all between two projects that only listen', () => {
    const a = at('bureau', 'RN7', '2026-04-14', '2026-04-16', 'a', 'receiver')
    const b = at('etudes', 'RN7', '2026-04-15', '2026-04-15', 'b', 'receiver')
    expect(zoneImpacts([a, b])).toEqual([])
  })
})

describe('which crossings are worth a notice', () => {
  const impacts = (from: string, to: string, role: ProjectImpactRole = 'both') =>
    zoneImpacts([at('a', 'RN7', from, to, 'mine', role), at('b', 'RN7', from, to, 'theirs')])
  const none = (): boolean => false

  it('announces one running today', () => {
    expect(dueImpactNotices(impacts('2026-04-01', '2026-04-30'), '2026-04-10', '2026-04-17', none)).toHaveLength(2)
  })

  it('announces one starting inside the window', () => {
    expect(dueImpactNotices(impacts('2026-04-15', '2026-04-16'), '2026-04-10', '2026-04-17', none)).toHaveLength(2)
  })

  it('says nothing about one beyond the window', () => {
    expect(dueImpactNotices(impacts('2026-05-15', '2026-05-16'), '2026-04-10', '2026-04-17', none)).toEqual([])
  })

  /** Saying so would only teach the reader to dismiss these without reading them. */
  it('says nothing about one already over', () => {
    expect(dueImpactNotices(impacts('2026-03-01', '2026-03-05'), '2026-04-10', '2026-04-17', none)).toEqual([])
  })

  /** The one the emitter-only role exists to stop. */
  it('tells only the side being disturbed', () => {
    const notices = dueImpactNotices(impacts('2026-04-15', '2026-04-16', 'emitter'), '2026-04-10', '2026-04-17', none)
    expect(notices).toHaveLength(1)
    expect(notices[0].affected.projectTitle).toBe('b')
    expect(notices[0].other.projectTitle).toBe('a')
  })

  it('never says the same thing twice', () => {
    const list = impacts('2026-04-15', '2026-04-16')
    const said = new Set<string>()
    const first = dueImpactNotices(list, '2026-04-10', '2026-04-17', (key) => said.has(key))
    for (const notice of first) said.add(notice.key)
    expect(dueImpactNotices(list, '2026-04-10', '2026-04-17', (key) => said.has(key))).toEqual([])
  })

  /** A date that moves is news again, so the key has to carry the window. */
  it('says it again once the crossing has moved', () => {
    const said = new Set(
      dueImpactNotices(impacts('2026-04-15', '2026-04-16'), '2026-04-10', '2026-04-17', none).map((n) => n.key)
    )
    const moved = dueImpactNotices(impacts('2026-04-14', '2026-04-16'), '2026-04-10', '2026-04-17', (k) => said.has(k))
    expect(moved).toHaveLength(2)
  })
})

describe('how grave a crossing is', () => {
  const launch = (level: ImpactLevel) => at('lancement', 'RN7', '2026-04-15', '2026-04-15', 'jour-J', 'emitter', level)
  const works = (level: ImpactLevel = 'caution') =>
    at('voirie', 'RN7', '2026-04-10', '2026-04-20', 'reprise', 'both', level)

  /** The whole point: a launch is blocking for whatever it lands on. */
  it('takes the level of the side doing the disturbing', () => {
    expect(zoneImpacts([launch('blocking'), works('info')])[0].level).toBe('blocking')
  })

  it('is not softened by a mild thing being disturbed', () => {
    expect(zoneImpacts([launch('caution'), works('info')])[0].level).toBe('caution')
  })

  it('takes the graver of the two when each disturbs the other', () => {
    const a = at('a', 'RN7', '2026-04-10', '2026-04-20', 'x', 'both', 'info')
    const b = at('b', 'RN7', '2026-04-15', '2026-04-16', 'y', 'both', 'blocking')
    expect(zoneImpacts([a, b])[0].level).toBe('blocking')
  })

  it('ranks the three, and answers the graver of any two', () => {
    expect(worstLevel('info', 'blocking')).toBe('blocking')
    expect(worstLevel('blocking', 'caution')).toBe('blocking')
    expect(worstLevel('caution', 'info')).toBe('caution')
    expect(worstLevel('info', 'info')).toBe('info')
  })

  it('lets a ticket overrule the level its project declares', () => {
    const found = vaultOccupancies({
      tasks: [
        {
          id: 'a',
          title: 'a',
          projectPath: 'P/a.md',
          start: '2026-04-06',
          due: '2026-04-10',
          status: 'todo',
          zones: [],
          archived: false
        },
        {
          id: 'b',
          title: 'b',
          projectPath: 'P/a.md',
          start: '2026-04-06',
          due: '2026-04-10',
          status: 'todo',
          zones: [],
          level: 'blocking',
          archived: false
        }
      ],
      projects: [{ path: 'P/a.md', title: 'a', zones: ['rn7'], template: false, role: 'both', level: 'info' }],
      isComplete: () => false
    })
    expect(found.map((o) => o.level)).toEqual(['info', 'blocking'])
  })
})
