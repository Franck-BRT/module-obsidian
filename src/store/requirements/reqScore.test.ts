import { describe, expect, it } from 'vitest'
import { addLink, makeRequirement, markLinksToward, setText } from './Requirement'
import { assessRequirement, axisWeight, QUALITY_AXES, type QualityAxisId, type QualityReport } from './reqScore'

const LANGS = ['fr', 'en']

/** A requirement with nothing wrong with it, so each test can break one thing. */
function perfect() {
  let requirement = makeRequirement({
    id: 'REQ-SYS-0001',
    title: 'Trappe',
    sourceLang: 'fr',
    category: 'SYS',
    type: 'functional',
    status: 'approved',
    criticality: 'high',
    verification: 'test',
    source: 'Cahier des charges §4.2',
    rationale: "Pour permettre l'évacuation.",
    owner: 'franck'
  })
  requirement = setText(requirement, 'fr', "L'opérateur doit ouvrir la trappe en moins de 3 s.", 'franck')
  requirement = setText(requirement, 'en', 'The operator shall open the hatch in under 3 s.', 'franck')
  return addLink(requirement, 'satisfied-by', 'task-42')
}

function axis(report: QualityReport, id: QualityAxisId) {
  const found = report.axes.find((entry) => entry.id === id)
  if (!found) throw new Error(`no axis ${id}`)
  return found
}

describe('the weights', () => {
  it('sum to one, so the score is a fraction and not a point total', () => {
    const total = QUALITY_AXES.reduce((sum, id) => sum + axisWeight(id), 0)
    expect(total).toBeCloseTo(1, 10)
  })

  // A requirement stated badly is wrong; one stated well with an empty rationale is
  // merely unfinished.
  it('weigh the wording above the record', () => {
    const wording = axisWeight('singular') + axisWeight('unambiguous') + axisWeight('verifiable')
    const record = axisWeight('complete') + axisWeight('traceable') + axisWeight('attributable')
    expect(wording).toBeGreaterThan(record)
  })
})

describe('assessRequirement', () => {
  it('gives five stars to a requirement with nothing wrong with it', () => {
    const report = assessRequirement(perfect(), LANGS)
    expect(report.score).toBe(1)
    expect(report.stars).toBe(5)
    expect(report.axes.every((entry) => entry.misses.length === 0)).toBe(true)
  })

  // The alternative is a blank statement rated three stars for having a category.
  it('gives nothing to a requirement with no words in it', () => {
    const empty = makeRequirement({ id: 'REQ-SYS-0002', category: 'SYS', type: 'functional', status: 'draft' })
    const report = assessRequirement(empty, LANGS)
    expect(report.score).toBe(0)
    expect(report.stars).toBe(0)
  })

  it('judges the wording that governs, not whichever one was written first', () => {
    let requirement = makeRequirement({ id: 'REQ-SYS-0003', sourceLang: 'en' })
    // The translation first, and a poor one: only reading the declared source language
    // gets this right.
    requirement = setText(requirement, 'fr', 'Le système ouvre la trappe.', 'a')
    requirement = setText(requirement, 'en', 'The system shall open the hatch in under 3 s.', 'a')
    expect(Object.keys(requirement.text)[0]).toBe('fr')
    expect(axis(assessRequirement(requirement, LANGS), 'singular').score).toBe(1)
  })

  it('judges a bad original however well it was translated', () => {
    let requirement = makeRequirement({ id: 'REQ-SYS-0004', sourceLang: 'fr' })
    requirement = setText(requirement, 'fr', 'Le système ouvre la trappe.', 'a')
    requirement = setText(requirement, 'en', 'The system shall open the hatch in under 3 s.', 'a')
    expect(axis(assessRequirement(requirement, LANGS), 'singular').score).toBe(0)
  })

  describe('singular', () => {
    it('is nothing when the sentence obliges nobody to anything', () => {
      const vague = setText(makeRequirement({ sourceLang: 'fr' }), 'fr', 'Le système ouvre la trappe.', 'a')
      expect(axis(assessRequirement(vague, LANGS), 'singular')).toMatchObject({ score: 0, misses: ['no-modal'] })
    })

    it('is low when two obligations wear one identifier', () => {
      const two = setText(
        makeRequirement({ sourceLang: 'fr' }),
        'fr',
        'Le système doit ouvrir la trappe et doit journaliser 3 événements.',
        'a'
      )
      expect(axis(assessRequirement(two, LANGS), 'singular').score).toBe(0.3)
    })

    // Stating none is the worse of the two: there is nothing there to fix.
    it('is worse for none than for two', () => {
      const none = setText(makeRequirement({ sourceLang: 'fr' }), 'fr', 'Le système ouvre la trappe.', 'a')
      const two = setText(
        makeRequirement({ sourceLang: 'fr' }),
        'fr',
        'Le système doit ouvrir et doit journaliser 3 fois.',
        'a'
      )
      expect(axis(assessRequirement(none, LANGS), 'singular').score).toBeLessThan(
        axis(assessRequirement(two, LANGS), 'singular').score
      )
    })
  })

  describe('unambiguous', () => {
    it('costs more for an undecided figure than for a long sentence', () => {
      const undecided = setText(makeRequirement({ sourceLang: 'fr' }), 'fr', 'Le système doit tenir TBD kg.', 'a')
      const long = setText(
        makeRequirement({ sourceLang: 'fr' }),
        'fr',
        `Le système doit ${'traiter chaque événement entrant distinct '.repeat(12)}en 3 s.`,
        'a'
      )
      expect(axis(assessRequirement(undecided, LANGS), 'unambiguous').score).toBeLessThan(
        axis(assessRequirement(long, LANGS), 'unambiguous').score
      )
    })

    it('names what cost it', () => {
      const vague = setText(
        makeRequirement({ sourceLang: 'fr' }),
        'fr',
        'Le système doit répondre de manière appropriée en 3 s.',
        'a'
      )
      expect(axis(assessRequirement(vague, LANGS), 'unambiguous').misses).toContain('weak-word')
    })
  })

  describe('verifiable', () => {
    // A method with no figure is half an answer, and so is a figure with no method.
    it('takes half for a missing method and half for a missing figure', () => {
      const noMethod = { ...perfect(), verification: 'none' as const }
      expect(axis(assessRequirement(noMethod, LANGS), 'verifiable').score).toBe(0.5)

      let vague = makeRequirement({ sourceLang: 'fr', verification: 'test' })
      vague = setText(vague, 'fr', 'Le système doit être plus rapide que la version précédente.', 'a')
      expect(axis(assessRequirement(vague, LANGS), 'verifiable').score).toBe(0.5)
    })
  })

  describe('attributable', () => {
    it('falls when the obligation binds nobody', () => {
      let passive = makeRequirement({ sourceLang: 'fr', owner: 'franck' })
      passive = setText(passive, 'fr', 'Les données doivent être chiffrées avant 3 h.', 'a')
      expect(axis(assessRequirement(passive, LANGS), 'attributable')).toMatchObject({
        score: 0.4,
        misses: ['passive-no-actor']
      })
    })

    it('falls a little when nobody answers for it', () => {
      const ownerless = { ...perfect(), owner: '' }
      expect(axis(assessRequirement(ownerless, LANGS), 'attributable').score).toBe(0.8)
    })
  })

  describe('complete', () => {
    it('counts the fields that are filled', () => {
      const bare = { ...perfect(), source: '', rationale: '' }
      const entry = axis(assessRequirement(bare, LANGS), 'complete')
      expect(entry.misses).toEqual(['source', 'rationale'])
      expect(entry.score).toBeCloseTo(6 / 8, 10)
    })

    it('counts a language that was never written', () => {
      let only = makeRequirement({ ...perfect(), text: {} })
      only = setText(only, 'fr', "L'opérateur doit ouvrir la trappe en moins de 3 s.", 'a')
      expect(axis(assessRequirement(only, LANGS), 'complete').misses).toEqual(['text.en'])
    })

    // Neither has anybody answerable for it, which is the point of keeping the library.
    it('does not count a translation that has fallen behind its source', () => {
      const moved = setText(perfect(), 'fr', "L'opérateur doit ouvrir la trappe en moins de 5 s.", 'a')
      expect(axis(assessRequirement(moved, LANGS), 'complete').misses).toEqual(['text.en'])
    })

    it('does not count a machine wording nobody has read', () => {
      let machine = makeRequirement({ ...perfect(), text: {} })
      machine = setText(machine, 'fr', "L'opérateur doit ouvrir la trappe en moins de 3 s.", 'a')
      machine = setText(machine, 'en', 'The operator shall open the hatch in under 3 s.', 'llm', 'machine')
      expect(axis(assessRequirement(machine, LANGS), 'complete').misses).toEqual(['text.en'])
    })
  })

  describe('traceable', () => {
    it('is nothing when the requirement is tied to nothing', () => {
      const loose = { ...perfect(), links: [] }
      expect(axis(assessRequirement(loose, LANGS), 'traceable')).toMatchObject({ score: 0, misses: ['links'] })
    })

    it('is little when the only relation says nothing about structure', () => {
      const sideways = { ...perfect(), links: [{ kind: 'conflicts-with' as const, to: 'REQ-SYS-0009' }] }
      expect(axis(assessRequirement(sideways, LANGS), 'traceable').score).toBe(0.4)
    })

    // A relation somebody has to re-check is still more than no relation at all.
    it('costs a link the far end moved under, without costing everything', () => {
      const suspect = markLinksToward(addLink(perfect(), 'derives-from', 'REQ-SYS-0000'), 'REQ-SYS-0000')
      const entry = axis(assessRequirement(suspect, LANGS), 'traceable')
      expect(entry.score).toBeCloseTo(0.7, 10)
      expect(entry.misses).toEqual(['suspect'])
    })
  })

  describe('the rating', () => {
    it('falls as things go wrong', () => {
      const good = assessRequirement(perfect(), LANGS).score
      const worse = assessRequirement({ ...perfect(), verification: 'none', links: [] }, LANGS).score
      expect(worse).toBeLessThan(good)
    })

    it('rounds to whole stars', () => {
      for (const report of [assessRequirement(perfect(), LANGS), assessRequirement(makeRequirement(), LANGS)]) {
        expect(Number.isInteger(report.stars)).toBe(true)
        expect(report.stars).toBeGreaterThanOrEqual(0)
        expect(report.stars).toBeLessThanOrEqual(5)
      }
    })

    it('hands back the findings it judged on, so nothing is computed twice', () => {
      const vague = setText(makeRequirement({ sourceLang: 'fr' }), 'fr', 'Le système ouvre la trappe.', 'a')
      expect(assessRequirement(vague, LANGS).findings.map((finding) => finding.rule)).toContain('no-modal')
    })
  })
})
