import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from './Requirement'
import { assessRequirement, axisWeight, type QualityReport } from './reqScore'
import { improvementPlan, planMisses } from './reqAdvice'

function report(over: Partial<QualityReport> = {}): QualityReport {
  return {
    axes: [
      { id: 'singular', score: 1, misses: [] },
      { id: 'unambiguous', score: 0.5, misses: ['weak-word'] },
      { id: 'verifiable', score: 0.5, misses: ['verification'] },
      { id: 'attributable', score: 0.8, misses: ['owner'] },
      { id: 'complete', score: 0.75, misses: ['source', 'rationale'] },
      { id: 'traceable', score: 0, misses: ['links'] }
    ],
    score: 0.6,
    stars: 3,
    findings: [],
    ...over
  }
}

describe('improvementPlan', () => {
  it('ranks by what closing each gap is worth', () => {
    const plan = improvementPlan(report(), 0.8)
    expect(plan.improvements.map((entry) => entry.axis)).toEqual(['unambiguous', 'verifiable', 'traceable'])
  })

  // Two gaps worth the same are not equally worth fixing: a badly worded requirement
  // wants rewriting before it wants a link.
  it('breaks a tie towards the wording', () => {
    const tied = report({
      axes: [
        { id: 'singular', score: 1, misses: [] },
        { id: 'unambiguous', score: 1, misses: [] },
        { id: 'verifiable', score: 0.5, misses: ['verification'] },
        { id: 'attributable', score: 1, misses: [] },
        { id: 'complete', score: 1, misses: [] },
        { id: 'traceable', score: 0, misses: ['links'] }
      ]
    })
    const plan = improvementPlan(tied, 1)
    expect(plan.improvements[0].gain).toBeCloseTo(plan.improvements[1].gain, 10)
    expect(plan.improvements.map((entry) => entry.axis)).toEqual(['verifiable', 'traceable'])
  })

  it('values a gap at its axis weight times what is missing', () => {
    const plan = improvementPlan(report(), 0.8)
    expect(plan.improvements[0].gain).toBeCloseTo(axisWeight('unambiguous') * 0.5, 10)
  })

  // A suggestion worth nothing teaches a reader to stop reading suggestions.
  it('never proposes an axis that is already perfect', () => {
    expect(improvementPlan(report(), 0.8).improvements.some((entry) => entry.axis === 'singular')).toBe(false)
  })

  // Three things to do is a plan; eight is a backlog.
  it('caps the list', () => {
    expect(improvementPlan(report(), 1).improvements).toHaveLength(3)
    expect(improvementPlan(report(), 1, 2).improvements).toHaveLength(2)
  })

  it('says where the listed improvements would land', () => {
    const plan = improvementPlan(report(), 0.8)
    const gains = plan.improvements.reduce((sum, entry) => sum + entry.gain, 0)
    expect(plan.reachable).toBeCloseTo(0.6 + gains, 10)
  })

  it('never claims more than a perfect score', () => {
    expect(improvementPlan(report({ score: 0.95 }), 1).reachable).toBeLessThanOrEqual(1)
  })

  it('says whether they are enough', () => {
    expect(improvementPlan(report(), 0.8).enough).toBe(true)
    expect(improvementPlan(report({ score: 0.1 }), 0.99).enough).toBe(false)
  })

  // A score of exactly the target read back from floating point would otherwise be a
  // coin toss.
  it('counts a score exactly at the target as meeting it', () => {
    const exact = report({ score: 0.1 + 0.7, axes: report().axes })
    expect(improvementPlan(exact, 0.8).met).toBe(true)
  })

  it('proposes nothing to a requirement already past the target', () => {
    const perfect = report({ score: 1, axes: report().axes.map((axis) => ({ ...axis, score: 1, misses: [] })) })
    const plan = improvementPlan(perfect, 0.8)
    expect(plan.met).toBe(true)
    expect(plan.improvements).toEqual([])
  })

  it('works on a real assessment', () => {
    const vague = setText(makeRequirement({ sourceLang: 'fr' }), 'fr', 'Le système ouvre la trappe.', 'a')
    const plan = improvementPlan(assessRequirement(vague, ['fr']), 0.8)
    expect(plan.met).toBe(false)
    expect(plan.improvements.length).toBeGreaterThan(0)
    expect(planMisses(plan)).toContain('no-modal')
  })
})

describe('planMisses', () => {
  it('names everything the plan would fix', () => {
    expect(planMisses(improvementPlan(report(), 0.8))).toEqual(['weak-word', 'verification', 'links'])
  })
})
