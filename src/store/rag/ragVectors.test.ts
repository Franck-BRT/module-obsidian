import { describe, expect, it } from 'vitest'
import { cosine } from '../llm/protocol'
import { fuseRanks, quantize, similarity, topIndexes, unit } from './ragVectors'

describe('vectors as bytes', () => {
  it('keeps the cosine to the third decimal', () => {
    const a = Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.37) * 3)
    const b = Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.37 + 0.4) * 0.5 + Math.cos(i) * 0.2)
    expect(Math.abs(similarity(unit(a), quantize(b)) - cosine(a, b))).toBeLessThan(0.005)
    expect(similarity(unit(a), quantize(a))).toBeCloseTo(1, 2)
  })

  it('writes each number as a byte, at unit length, and makes nothing of a zero vector', () => {
    expect([...quantize([3, 4])]).toEqual([76, 102])
    expect([...quantize([0, 0])]).toEqual([0, 0])
    expect([...unit([0, 0])]).toEqual([0, 0])
    expect(similarity(unit([1, 0]), quantize([1, 0, 0]))).toBe(0)
  })
})

describe('topIndexes', () => {
  it('gives the highest first, the earlier first when equal, leaving out what is not a number', () => {
    expect(topIndexes([0.1, 0.9, 0.5, 0.9, Number.NEGATIVE_INFINITY, Number.NaN], 3)).toEqual([1, 3, 2])
    expect(topIndexes([], 3)).toEqual([])
  })
})

describe('fuseRanks', () => {
  it('puts first what both rankings found high, and keeps what only one found', () => {
    expect(
      fuseRanks([
        ['a', 'b', 'c'],
        ['b', 'd', 'a']
      ])
    ).toEqual(['b', 'a', 'd', 'c'])
    // Found first by one, not at all by the other: after one found well by both.
    expect(fuseRanks([['x', 'y'], ['y']])).toEqual(['y', 'x'])
  })

  it('adds what a bonus gives', () => {
    expect(fuseRanks([['a', 'b']], 60, (item) => (item === 'b' ? 1 : 0))).toEqual(['b', 'a'])
  })
})
