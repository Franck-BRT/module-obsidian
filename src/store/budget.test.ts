import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUSES, makeProject, makeTask, type Task } from '../types'
import { budgetCurve, budgetFigures, emptyBudget, hasBudget, projectBudget } from './budget'
import { b12Tasks } from '../views/demo/demoContent'
import { mapRawToTask, parseAmount } from './YamlHydrator'
import { buildTaskFrontmatter } from './YamlSerializer'

const lot = (title: string, start: string, due: string, budget?: Task['budget']): Task =>
  makeTask({
    id: title,
    title,
    type: 'phase',
    start: '',
    due: '',
    subtasks: [makeTask({ title: `${title} work`, start, due })],
    budget
  })

describe('a lot’s budget', () => {
  it('reads amounts as people write them', () => {
    expect(parseAmount('12 500,50 €')).toBe(12500.5)
    expect(parseAmount('12,500.50')).toBe(12500.5)
    expect(parseAmount('12.500')).toBe(12500)
    expect(parseAmount('1.250.000')).toBe(1250000)
    expect(parseAmount('0.5')).toBe(0.5)
    expect(parseAmount('1,5')).toBe(1.5)
    expect(parseAmount('-3 000 HT')).toBe(-3000)
    expect(parseAmount(42)).toBe(42)
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })

  it('reckons what remains to commit and where it ends, an estimate overriding what the budget leaves', () => {
    const budget = emptyBudget({
      amount: 100_000,
      commitments: [
        { date: '2026-09-01', label: 'Marché', company: 'A', amount: 80_000 },
        { date: '2026-09-20', label: 'Avenant 1', company: 'A', amount: 5_000 }
      ],
      invoices: [{ date: '2026-09-30', label: 'Situation 1', company: 'A', amount: 30_000 }]
    })
    expect(budgetFigures(budget)).toEqual({
      budget: 100_000,
      committed: 85_000,
      invoiced: 30_000,
      toCommit: 15_000,
      forecast: 100_000,
      variance: 0
    })
    expect(budgetFigures({ ...budget, toCommit: 25_000 })).toMatchObject({ forecast: 110_000, variance: 10_000 })
    // Committed past the budget: nothing remains, the overrun shows.
    expect(budgetFigures({ ...budget, amount: 80_000 })).toMatchObject({ toCommit: 0, variance: 5_000 })
    expect(hasBudget({ budget })).toBe(true)
    expect(hasBudget({ budget: emptyBudget() })).toBe(false)
  })

  it('is kept in the phase’s note and read back', () => {
    const budget = emptyBudget({
      amount: 50_000,
      toCommit: 2_000,
      commitments: [{ date: '2026-09-01', label: 'Marché', company: 'A', amount: 48_000 }],
      invoices: []
    })
    const fm = buildTaskFrontmatter(lot('L', '2026-09-01', '2026-09-30', budget), makeProject('P', 'P.md'), null, {
      link: (path, title) => `[[${path}|${title}]]`,
      dependency: () => null
    })
    expect(fm.budget).toEqual(budget)
    const back = mapRawToTask({
      ...fm,
      budget: {
        amount: '50 000',
        commitments: [{ date: '2026-09-01', label: 'M', amount: '1 000,5' }, { amount: 'x' }]
      }
    })
    expect(back.budget).toEqual({
      amount: 50_000,
      commitments: [{ date: '2026-09-01', label: 'M', company: '', amount: 1000.5 }],
      invoices: []
    })
  })

  it('adds up the lots and draws the curve up to today', () => {
    const tasks = [
      lot(
        'A',
        '2026-09-01',
        '2026-09-30',
        emptyBudget({
          amount: 30_000,
          commitments: [{ date: '2026-08-20', label: 'Marché', company: 'X', amount: 28_000 }],
          invoices: [{ date: '2026-09-15', label: 'S1', company: 'X', amount: 10_000 }]
        })
      ),
      lot('B', '2026-10-01', '2026-10-30', emptyBudget({ amount: 60_000 })),
      lot('C', '2026-10-01', '2026-10-30')
    ]
    const budget = projectBudget(tasks)
    expect(budget.lots).toHaveLength(3)
    expect(budget.total).toMatchObject({ budget: 90_000, committed: 28_000, toCommit: 62_000, forecast: 90_000 })
    const curve = budgetCurve(budget.lots, DEFAULT_STATUSES, '2026-09-20')
    expect(curve[0].date).toBe('2026-08-20')
    expect(curve[curve.length - 1]).toMatchObject({ date: '2026-10-30', planned: 90_000, committed: null })
    const today = curve.find((point) => point.date === '2026-09-20')
    expect(today).toMatchObject({ committed: 28_000, invoiced: 10_000, planned: 20_000 })
    expect(budgetCurve(projectBudget([lot('D', '', '')]).lots, DEFAULT_STATUSES, '2026-09-20')).toEqual([])
  })

  it('adds up to the demonstration’s overrun', () => {
    const budget = projectBudget(b12Tasks('2026-10-05'))
    expect(budget.total).toMatchObject({
      budget: 1_950_000,
      committed: 1_901_000,
      invoiced: 397_500,
      forecast: 1_968_000,
      variance: 18_000
    })
  })
})
