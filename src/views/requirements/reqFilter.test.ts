import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from '../../store/requirements/Requirement'
import {
  EMPTY_REQ_FILTER,
  filterRequirements,
  isReqFilterActive,
  matchesReqSearch,
  reqCategories,
  sortRequirements
} from './reqFilter'

const LANGS = ['fr', 'en']

function req(over: Parameters<typeof makeRequirement>[0] = {}) {
  return makeRequirement({ sourceLang: 'fr', ...over })
}

describe('matchesReqSearch', () => {
  it('finds a phrase written in a language the reader is not looking at', () => {
    const requirement = setText(req({ id: 'REQ-SYS-0001' }), 'en', 'The hatch shall open in 3 seconds.', 'a')
    expect(matchesReqSearch(requirement, 'hatch')).toBe(true)
  })

  it('finds a requirement by its id, which is how one is cited', () => {
    expect(matchesReqSearch(req({ id: 'REQ-SYS-0042' }), 'sys-0042')).toBe(true)
  })

  it('finds one by a tag', () => {
    expect(matchesReqSearch(req({ tags: ['sécurité'] }), 'sécu')).toBe(true)
  })

  it('keeps everything when nothing is typed', () => {
    expect(matchesReqSearch(req(), '   ')).toBe(true)
  })

  it('says no rather than yes when nothing matches', () => {
    expect(matchesReqSearch(req({ title: 'Trappe' }), 'moteur')).toBe(false)
  })
})

describe('filterRequirements', () => {
  const approved = req({ id: 'REQ-A-0001', category: 'SYS', type: 'functional', status: 'approved' })
  const draft = req({ id: 'REQ-A-0002', category: 'ELEC', type: 'safety', status: 'draft' })

  it('keeps the whole library when nothing is asked of it', () => {
    expect(filterRequirements([approved, draft], EMPTY_REQ_FILTER, LANGS)).toHaveLength(2)
  })

  it('narrows on a field without touching the rest', () => {
    const out = filterRequirements([approved, draft], { ...EMPTY_REQ_FILTER, status: 'draft' }, LANGS)
    expect(out.map((r) => r.id)).toEqual(['REQ-A-0002'])
  })

  it('applies two narrowings together rather than either of them', () => {
    const state = { ...EMPTY_REQ_FILTER, category: 'SYS', status: 'draft' }
    expect(filterRequirements([approved, draft], state, LANGS)).toEqual([])
  })

  it('singles out a translation that has fallen behind its source', () => {
    let stale = setText(req({ id: 'REQ-A-0003' }), 'fr', 'Version un.', 'a')
    stale = setText(stale, 'en', 'Version one.', 'a')
    stale = setText(stale, 'fr', 'Version deux.', 'a')
    const fresh = setText(setText(req({ id: 'REQ-A-0004' }), 'fr', 'Stable.', 'a'), 'en', 'Stable.', 'a')
    const out = filterRequirements([stale, fresh], { ...EMPTY_REQ_FILTER, flag: 'stale' }, LANGS)
    expect(out.map((r) => r.id)).toEqual(['REQ-A-0003'])
  })

  it('singles out a machine wording nobody has read', () => {
    const machine = setText(setText(req(), 'fr', 'Source.', 'a'), 'en', 'Machine.', 'llm', 'machine')
    const human = setText(setText(req({ id: 'REQ-A-0005' }), 'fr', 'Source.', 'a'), 'en', 'Human.', 'a')
    const out = filterRequirements([machine, human], { ...EMPTY_REQ_FILTER, flag: 'unreviewed' }, LANGS)
    expect(out).toHaveLength(1)
    expect(out[0].text.en.origin).toBe('machine')
  })

  it('singles out a requirement missing one of the languages asked for', () => {
    const only = setText(req({ id: 'REQ-A-0006' }), 'fr', 'Seulement en français.', 'a')
    const both = setText(setText(req({ id: 'REQ-A-0007' }), 'fr', 'Deux.', 'a'), 'en', 'Two.', 'a')
    const out = filterRequirements([only, both], { ...EMPTY_REQ_FILTER, flag: 'missing' }, LANGS)
    expect(out.map((r) => r.id)).toEqual(['REQ-A-0006'])
  })

  it('singles out a link the far end moved under', () => {
    const suspect = req({ id: 'REQ-A-0008', links: [{ kind: 'derives-from', to: 'REQ-B-0001', suspect: true }] })
    const sound = req({ id: 'REQ-A-0009', links: [{ kind: 'derives-from', to: 'REQ-B-0002' }] })
    const out = filterRequirements([suspect, sound], { ...EMPTY_REQ_FILTER, flag: 'suspect' }, LANGS)
    expect(out.map((r) => r.id)).toEqual(['REQ-A-0008'])
  })
  it('singles out a wording a reviewer would stop on', () => {
    const vague = setText(req({ id: 'REQ-A-0010' }), 'fr', 'Le système ouvre la trappe.', 'a')
    const sound = setText(req({ id: 'REQ-A-0011' }), 'fr', 'Le système doit ouvrir la trappe en 3 s.', 'a')
    const out = filterRequirements([vague, sound], { ...EMPTY_REQ_FILTER, flag: 'quality' }, LANGS)
    expect(out.map((r) => r.id)).toEqual(['REQ-A-0010'])
  })

  // A French sentence run through the English rules is found clean, which is worse than
  // not looking at it.
  it('judges each wording in its own language', () => {
    const french = setText(req({ id: 'REQ-A-0012' }), 'fr', 'Le système doit ouvrir la trappe en 3 s.', 'a')
    const out = filterRequirements([french], { ...EMPTY_REQ_FILTER, flag: 'quality' }, LANGS)
    expect(out).toEqual([])
  })
})

describe('isReqFilterActive', () => {
  it('is quiet when nothing is set', () => {
    expect(isReqFilterActive(EMPTY_REQ_FILTER)).toBe(false)
  })

  it('notices a search of nothing but spaces is not a search', () => {
    expect(isReqFilterActive({ ...EMPTY_REQ_FILTER, search: '  ' })).toBe(false)
  })

  it('notices each narrowing', () => {
    expect(isReqFilterActive({ ...EMPTY_REQ_FILTER, criticality: 'high' })).toBe(true)
    expect(isReqFilterActive({ ...EMPTY_REQ_FILTER, flag: 'stale' })).toBe(true)
  })
})

describe('reqCategories', () => {
  it('lists what is used, once each, and never an empty one', () => {
    const list = [req({ category: 'SYS' }), req({ category: '' }), req({ category: 'SYS' }), req({ category: 'ELEC' })]
    expect(reqCategories(list)).toEqual(['ELEC', 'SYS'])
  })
})

describe('sortRequirements', () => {
  it('reads numbers as numbers, so 10 comes after 9', () => {
    const list = [req({ id: 'REQ-SYS-0010' }), req({ id: 'REQ-SYS-0009' })]
    expect(sortRequirements(list, 'id', 'asc', 'fr').map((r) => r.id)).toEqual(['REQ-SYS-0009', 'REQ-SYS-0010'])
  })

  it('breaks a tie on the id, so a redraw never reorders two equals', () => {
    const list = [
      req({ id: 'REQ-SYS-0003', status: 'draft' }),
      req({ id: 'REQ-SYS-0001', status: 'draft' }),
      req({ id: 'REQ-SYS-0002', status: 'draft' })
    ]
    const once = sortRequirements(list, 'status', 'desc', 'fr').map((r) => r.id)
    expect(once).toEqual(['REQ-SYS-0001', 'REQ-SYS-0002', 'REQ-SYS-0003'])
  })

  it('leaves the list it was given alone', () => {
    const list = [req({ id: 'REQ-SYS-0002' }), req({ id: 'REQ-SYS-0001' })]
    sortRequirements(list, 'id', 'asc', 'fr')
    expect(list[0].id).toBe('REQ-SYS-0002')
  })

  it('falls back to the wording when a requirement was never given a title', () => {
    const untitled = setText(req({ id: 'REQ-SYS-0001' }), 'fr', 'Alpha.', 'a')
    const titled = req({ id: 'REQ-SYS-0002', title: 'Bravo' })
    expect(sortRequirements([titled, untitled], 'title', 'asc', 'fr').map((r) => r.id)).toEqual([
      'REQ-SYS-0001',
      'REQ-SYS-0002'
    ])
  })
})
