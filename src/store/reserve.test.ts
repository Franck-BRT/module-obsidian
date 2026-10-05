import type { App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../test/fakeVault'
import { DEFAULT_SETTINGS, DEFAULT_STATUSES, makeTask, type Task, type TaskReserve } from '../types'
import { ProjectStore } from './ProjectStore'
import { projectMetrics } from './Metrics'
import {
  emptyReserve,
  isLateReserve,
  moveReserve,
  nextReserveNumber,
  nextReserveState,
  orderReserves,
  readReservePhase,
  readReserveState,
  recordReserveChase,
  reserveMail,
  reserveSummary,
  statusForReserve
} from './reserve'

const TODAY = '2026-10-05'
const reserve = (title: string, over: Partial<TaskReserve>, task: Partial<Task> = {}): Task =>
  makeTask({ title, type: 'reserve', start: '', reserve: emptyReserve(over), ...task })

const list = [
  reserve(
    'Éclat de béton sur voile',
    { number: 'R-002', location: 'RDC — hall' },
    { assignees: ['Garonne Bâtiment'], due: '2026-10-01' }
  ),
  reserve(
    'Prise non fixée',
    { number: 'R-010', location: 'R+1 — bureau 12', state: 'declared' },
    { assignees: ['Électricité Sud'], due: '2026-10-20' }
  ),
  reserve(
    'Joint de dilatation absent',
    { number: 'R-001', severity: 'major' },
    { assignees: ['Garonne Bâtiment'], due: '2026-10-15' }
  ),
  reserve(
    'Peinture reprise',
    { number: 'R-003', state: 'lifted' },
    { assignees: ['Garonne Bâtiment'], due: '2026-09-20' }
  )
]

describe('the punch list', () => {
  it('numbers the next reserve past the highest, and reads by number', () => {
    expect(nextReserveNumber(list)).toBe('R-011')
    expect(nextReserveNumber([])).toBe('R-001')
    expect(orderReserves(list).map((one) => one.reserve?.number)).toEqual(['R-001', 'R-002', 'R-003', 'R-010'])
  })

  it('notes the days a reserve is said lifted, then seen lifted, and forgets them when it opens again', () => {
    const said = moveReserve(emptyReserve(), 'declared', '2026-10-03')
    expect(said).toMatchObject({ state: 'declared', declaredOn: '2026-10-03', liftedOn: '' })
    const seen = moveReserve(said, 'lifted', '2026-10-05')
    expect(seen).toMatchObject({ declaredOn: '2026-10-03', liftedOn: '2026-10-05' })
    expect(moveReserve(seen, 'open', '2026-10-06')).toMatchObject({ declaredOn: '', liftedOn: '' })
    expect(['open', 'declared', 'lifted'].map((one) => nextReserveState(one as never))).toEqual([
      'declared',
      'lifted',
      'open'
    ])
  })

  it('is late past its day until seen lifted, and its ticket done once it is', () => {
    expect(list.map((one) => isLateReserve(one, TODAY))).toEqual([true, false, false, false])
    expect(statusForReserve('lifted', 'todo', DEFAULT_STATUSES)).toBe('done')
    expect(statusForReserve('open', 'done', DEFAULT_STATUSES)).toBe('todo')
    expect(statusForReserve('declared', 'in-progress', DEFAULT_STATUSES)).toBeNull()
  })

  it('counts by contractor, those with the most still open first', () => {
    const summary = reserveSummary(list, TODAY)
    expect(summary).toMatchObject({ total: 4, open: 2, declared: 1, lifted: 1, late: 1 })
    expect(summary.byCompany.map((one) => [one.company, one.open, one.late])).toEqual([
      ['Garonne Bâtiment', 2, 1],
      ['Électricité Sud', 0, 0]
    ])
  })

  it('writes the contractor a mail of what is still open, the late first, and notes the chase once a day', () => {
    const garonne = list.filter((one) => one.assignees[0] === 'Garonne Bâtiment')
    const mail = reserveMail(
      garonne,
      { project: 'B12', askedBy: '2026-10-12', today: TODAY },
      {
        date: (iso) => iso,
        subject: (project) => `Réserves ${project}`,
        greeting: 'Bonjour,',
        intro: () => 'Restent à lever :',
        line: (one) => `${one.number} ${one.title}${one.late ? ' (en retard)' : ''}`,
        ask: (date) => `Avant le ${date}.`,
        closing: 'Cordialement,'
      }
    )
    expect(mail.body).toContain('- R-002 Éclat de béton sur voile (en retard)\n- R-001 Joint de dilatation absent')
    expect(mail.body).not.toContain('Peinture')
    const chased = recordReserveChase(recordReserveChase(emptyReserve(), TODAY), TODAY)
    expect(chased.chases).toEqual([TODAY])
  })

  it('reads states and phases in either language', () => {
    expect(['Levée', 'déclarée levée', 'à lever', '?'].map(readReserveState)).toEqual([
      'lifted',
      'declared',
      'open',
      null
    ])
    expect(['OPR', 'Réception', 'GPA', 'plus tard'].map(readReservePhase)).toEqual(['opr', 'reception', 'gpa', null])
  })
})

describe('a reserve', () => {
  it('is kept in its note whole, and not counted as work', async () => {
    const fake = makeFakeApp({ liveMetadataCache: true })
    const app = fake.app as unknown as App
    const store = new ProjectStore(app, () => DEFAULT_SETTINGS)
    const project = await store.createProject('Bâtiment B12', 'Work')
    const task = reserve('Éclat de béton sur voile', {
      number: 'R-002',
      phase: 'reception',
      location: 'RDC — hall',
      lot: 'Lot 02',
      severity: 'major',
      raisedOn: '2026-10-01',
      photos: ['Work/Bâtiment B12/photo.jpg'],
      chases: ['2026-10-03']
    })
    await store.insertTask(project, task)
    const reread = (await new ProjectStore(app, () => DEFAULT_SETTINGS).loadProjectByPath(project.filePath))?.tasks[0]
    expect(reread?.reserve).toEqual(task.reserve)
    const metrics = projectMetrics({ tasks: list, statuses: DEFAULT_STATUSES, priorities: [], today: TODAY })
    expect(metrics.total).toBe(0)
  })
})
