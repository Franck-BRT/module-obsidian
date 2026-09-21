import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from './Requirement'
import { changedLanguages, revisionTimeline } from './reqHistory'

function threeVersions() {
  let requirement = makeRequirement({ id: 'REQ-A-0001', sourceLang: 'fr' })
  requirement = setText(requirement, 'fr', 'Le système doit ouvrir.', 'franck')
  requirement = setText(requirement, 'fr', 'Le système doit ouvrir en 3 s.', 'franck')
  requirement = setText(requirement, 'fr', 'Le système doit ouvrir en 5 s.', 'claire')
  return requirement
}

describe('revisionTimeline', () => {
  it('has nothing to show for a wording written once', () => {
    const requirement = setText(makeRequirement({ sourceLang: 'fr' }), 'fr', 'Premier jet.', 'a')
    expect(revisionTimeline(requirement, 'fr')).toEqual([])
  })

  it('pairs each recorded state with what came after it', () => {
    const steps = revisionTimeline(threeVersions(), 'fr')
    expect(steps).toHaveLength(2)
    expect(steps[0].before).toBe('Le système doit ouvrir.')
    expect(steps[0].after).toBe('Le système doit ouvrir en 3 s.')
    // The last recorded state is paired with the wording as it stands today.
    expect(steps[1].after).toBe('Le système doit ouvrir en 5 s.')
  })

  it('carries who changed it and at which revision', () => {
    const steps = revisionTimeline(threeVersions(), 'fr')
    expect(steps.map((step) => step.by)).toEqual(['franck', 'claire'])
    expect(steps.map((step) => step.rev)).toEqual([2, 3])
  })

  it('shows what moved rather than only that something did', () => {
    const steps = revisionTimeline(threeVersions(), 'fr')
    expect(steps[1].diff.some((part) => part.kind === 'removed' && part.text.includes('3'))).toBe(true)
    expect(steps[1].diff.some((part) => part.kind === 'added' && part.text.includes('5'))).toBe(true)
  })

  it('keeps one language out of the history of another', () => {
    let requirement = threeVersions()
    requirement = setText(requirement, 'en', 'The system shall open.', 'a')
    requirement = setText(requirement, 'en', 'The system shall open in 5 s.', 'a')
    expect(revisionTimeline(requirement, 'en')).toHaveLength(1)
    expect(revisionTimeline(requirement, 'fr')).toHaveLength(2)
  })

  // The revision number is not an order: several translations can be written at one
  // revision of the source, and what says which came first is that it was appended first.
  it('keeps the order they were written in when a revision is shared', () => {
    let requirement = setText(makeRequirement({ sourceLang: 'fr' }), 'fr', 'Source.', 'a')
    requirement = setText(requirement, 'en', 'One.', 'a')
    requirement = setText(requirement, 'en', 'Two.', 'a')
    requirement = setText(requirement, 'en', 'Three.', 'a')
    const steps = revisionTimeline(requirement, 'en')
    expect(steps.map((step) => step.before)).toEqual(['One.', 'Two.'])
    expect(steps.map((step) => step.after)).toEqual(['Two.', 'Three.'])
  })
})

describe('changedLanguages', () => {
  it('lists the languages that have a history, once each', () => {
    let requirement = threeVersions()
    requirement = setText(requirement, 'en', 'One.', 'a')
    requirement = setText(requirement, 'en', 'Two.', 'a')
    expect(changedLanguages(requirement)).toEqual(['fr', 'en'])
  })

  it('lists none for a requirement nobody has revised', () => {
    expect(changedLanguages(makeRequirement())).toEqual([])
  })
})
