import { describe, expect, it } from 'vitest'
import { orderRisks, readRiskLevel, riskBand, riskLevel, riskMatrix, riskScore } from './risk'

const risk = (title: string, probability: number, impact: number, open = true) => ({
  title,
  open,
  risk: { probability, impact, mitigation: '' }
})

describe('a risk weighed', () => {
  it('keeps its levels within 1 to 4, a risk not weighed being 1 and 1', () => {
    expect(riskLevel(0)).toBe(1)
    expect(riskLevel('3')).toBe(3)
    expect(riskLevel(7)).toBe(4)
    expect(riskLevel(undefined)).toBe(1)
    expect(riskScore({})).toEqual({ probability: 1, impact: 1, score: 1 })
    expect(riskScore({ risk: { probability: 3, impact: 4, mitigation: '' } }).score).toBe(12)
  })

  it('falls in a band by its criticality', () => {
    expect([1, 3, 4, 6, 8, 9, 12, 16].map(riskBand)).toEqual([
      'low',
      'low',
      'medium',
      'medium',
      'high',
      'high',
      'critical',
      'critical'
    ])
  })

  it('is listed the most critical first, the most likely before, those closed last', () => {
    const list = [risk('Gel', 2, 3), risk('Retard centrale', 3, 4), risk('Pollution', 4, 2), risk('Grève', 4, 4, false)]
    expect(orderRisks(list, (one) => one.open).map((one) => one.title)).toEqual([
      'Retard centrale',
      'Pollution',
      'Gel',
      'Grève'
    ])
  })

  it('is counted in its cell of the matrix', () => {
    const cells = riskMatrix([risk('a', 3, 4), risk('b', 3, 4), risk('c', 1, 2)])
    expect(cells[2][3]).toBe(2)
    expect(cells[0][1]).toBe(1)
    expect(cells.flat().reduce((sum, n) => sum + n, 0)).toBe(3)
  })
})

describe('a level as it is written', () => {
  it('is read from a figure or a word of either language, and refused otherwise', () => {
    expect(['1', 2, '3/4', '4 - critique'].map(readRiskLevel)).toEqual([1, 2, 3, 4])
    expect(
      ['Rare', 'possible', 'Probable', 'Quasi certain', 'critique', 'élevé', 'minor', 'almost certain'].map(
        readRiskLevel
      )
    ).toEqual([1, 2, 3, 4, 4, 3, 1, 4])
    expect(readRiskLevel('5')).toBeNull()
    expect(readRiskLevel('beaucoup')).toBeNull()
    expect(readRiskLevel(0)).toBeNull()
  })
})
