import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeTask, type Project } from '../../types'
import {
  asksForStatus,
  planState,
  pointKey,
  statusFacts,
  statusText,
  StatusSnapshots,
  type PlanState,
  type TicketState
} from './statusPoint'

const ticket = (title: string, over: Partial<TicketState> = {}): TicketState => ({
  title,
  project: 'COSMA',
  type: 'task',
  start: '',
  due: '',
  status: 'todo',
  done: false,
  assignees: [],
  ...over
})

const WORDS = {
  heading: (today: string, since: string) => `Point du ${today}${since ? `, depuis le ${since}` : ''}`,
  first: 'Premier point.',
  progress: (done: number, total: number, percent: number) => `${done}/${total} (${percent} %)`,
  late: (count: number) => `En retard (${count})`,
  finished: (count: number) => `Terminés (${count})`,
  shifted: (count: number) => `Décalés (${count})`,
  added: (count: number) => `Nouveaux (${count})`,
  upcoming: (count: number, days: number) => `À venir sous ${days} j (${count})`,
  none: '(aucun)',
  milestone: 'jalon',
  lateBy: (days: number) => `${days} j de retard`
}

describe('the facts of a status point', () => {
  const before: PlanState = {
    a: ticket('Radier', { start: '2026-09-20', due: '2026-10-10' }),
    b: ticket('Dalle', { due: '2026-10-14' }),
    c: ticket('Terrassement', { due: '2026-09-25' })
  }
  const now: PlanState = {
    a: ticket('Radier', { start: '2026-09-20', due: '2026-10-20', assignees: ['Anne'] }),
    b: ticket('Dalle', { due: '2026-10-14' }),
    c: ticket('Terrassement', { due: '2026-09-25', done: true, status: 'done' }),
    d: ticket('Réception', { type: 'milestone', due: '2026-10-12' }),
    e: ticket('Études', { due: '2026-09-28' })
  }

  it('says what is late, what finished, moved and is new since the last point, and what is coming', () => {
    const facts = statusFacts(now, { at: '2026-09-24', state: before }, '2026-10-01')
    expect(facts).toMatchObject({ today: '2026-10-01', since: '2026-09-24', total: 5, done: 1 })
    expect(facts.late.map((one) => one.title)).toEqual(['Études'])
    expect(facts.finished.map((one) => one.title)).toEqual(['Terrassement'])
    expect(facts.shifted).toEqual([{ ticket: now.a, from: '2026-10-10', to: '2026-10-20', days: 10 }])
    expect(facts.added.map((one) => one.title)).toEqual(['Réception', 'Études'])
    // Milestones first, then by date.
    expect(facts.upcoming.map((one) => one.title)).toEqual(['Réception', 'Dalle'])
  })

  it('writes them out for the model, a section a kind, the first point said to be one', () => {
    const text = statusText(statusFacts(now, { at: '2026-09-24', state: before }, '2026-10-01'), WORDS)
    expect(text).toContain('Point du 2026-10-01, depuis le 2026-09-24\n1/5 (20 %)')
    expect(text).toContain('En retard (1)\n- Études · COSMA · 2026-09-28 · 3 j de retard')
    expect(text).toContain('Décalés (1)\n- Radier · COSMA · 2026-10-10 → 2026-10-20 (+10 j)')
    expect(text).toContain('À venir sous 14 j (2)\n- Réception (jalon) · COSMA · 2026-10-12')
    const first = statusText(statusFacts(now, null, '2026-10-01'), WORDS)
    expect(first).toContain('Premier point.')
    expect(first).not.toContain('Décalés')
  })

  it('knows a question asking for one, in either language', () => {
    expect(asksForStatus('Fais le point d’avancement du projet')).toBe(true)
    expect(asksForStatus('Qu’est-ce qui a changé depuis le dernier point ?')).toBe(true)
    expect(asksForStatus('Write a status report')).toBe(true)
    expect(asksForStatus('Quand le radier est-il coulé ?')).toBe(false)
  })
})

describe('the plan photographed at each point', () => {
  it('compares with the last point of an earlier day, and keeps one a day', async () => {
    const files = new Map<string, string>()
    const storage = {
      read: (name: string) => Promise.resolve(files.get(name) ?? null),
      write: (name: string, data: string) => {
        files.set(name, data)
        return Promise.resolve()
      }
    }
    const key = pointKey(['B.md', 'A.md', 'B.md'])
    expect(key).toBe('A.md|B.md')
    const points = new StatusSnapshots(storage)
    await points.ready()
    expect(points.baseline(key, '2026-09-24')).toBeNull()
    await points.record(key, '2026-09-24', { a: ticket('Radier') })
    await points.record(key, '2026-10-01', { a: ticket('Radier', { due: '2026-10-20' }) })
    // Asked again the same day: compared with the week before, not with itself.
    await points.record(key, '2026-10-01', { a: ticket('Radier', { due: '2026-10-21' }) })
    const again = new StatusSnapshots(storage)
    await again.ready()
    expect(again.baseline(key, '2026-10-01')?.at).toBe('2026-09-24')
    expect(again.baseline(key, '2026-10-08')?.state.a.due).toBe('2026-10-21')
  })
})

describe('the plan as a point reads it', () => {
  it('takes every ticket of the projects, under lots too, leaving lots and the archive out', () => {
    const lot = makeTask({ title: 'Lot 1', type: 'phase', start: '' })
    lot.subtasks = [makeTask({ title: 'Radier', due: '2026-10-20', assignees: ['Anne'] })]
    const done = makeTask({ title: 'Études', status: 'done', start: '' })
    const filed = makeTask({ title: 'Ancien', archived: true, start: '' })
    const project = { title: 'COSMA', tasks: [lot, done, filed] } as unknown as Project
    const state = planState([project], () => DEFAULT_STATUSES)
    expect(Object.values(state).map((one) => [one.title, one.project, one.done])).toEqual([
      ['Radier', 'COSMA', false],
      ['Études', 'COSMA', true]
    ])
  })
})
