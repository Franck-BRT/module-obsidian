import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addLink, makeRequirement, setText, type Requirement } from './Requirement'
import { addAlias } from './reqAlias'
import { readReqJson, toReqJson } from './reqJson'
import { changedParts, countJsonPlan, planJsonImport } from './reqJsonImport'

const OPTIONS = { exported: '2026-09-24T10:00:00.000Z' }

const req = (over: Parameters<typeof makeRequirement>[0] = {}): Requirement =>
  setText(
    makeRequirement({ id: 'REQ-THERM-0001', title: 'Soute', sourceLang: 'fr', ...over }),
    'fr',
    'Entre 5 et 30 °C.',
    'franck'
  )

// The clock stands still: every requirement here is built twice and compared, and two
// built a millisecond apart differ by the date stamped on their wording — which made
// "nothing changed" fail whenever the millisecond happened to turn between them.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T10:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

/** A file, as the export writes one and the reader reads it back. */
const fileOf = (requirements: Requirement[]) => readReqJson(toReqJson(requirements, OPTIONS))

describe('planning a JSON import', () => {
  it('creates what the library does not hold', () => {
    const plan = planJsonImport(fileOf([req()]), [])
    expect(plan[0]).toMatchObject({ action: 'create', id: 'REQ-THERM-0001' })
  })

  // The file was written from the same record, so an export that comes straight back is
  // an import with nothing to do.
  it('sees that a library exported and re-imported has not moved', () => {
    const library = [req()]
    expect(planJsonImport(fileOf(library), library)[0].action).toBe('unchanged')
  })

  /**
   * A record holds the revision, the history and what each translation was written from,
   * so writing one over an existing requirement is a replacement. Calling it an update
   * is how an import loses somebody's afternoon.
   */
  it('calls a record landing on an existing requirement a replacement', () => {
    const before = req()
    const after = setText(req(), 'fr', 'Entre 5 et 25 °C.', 'franck')
    const plan = planJsonImport(fileOf([after]), [before])
    expect(plan[0].action).toBe('replace')
  })

  it('names what a replacement would change, in the words a reader thinks in', () => {
    const before = req()
    let after = setText(req({ status: 'approved' }), 'en', 'Between 5 and 30 °C.', 'llm', 'machine')
    after = addLink(after, 'derives-from', 'REQ-SYS-0001')
    expect(planJsonImport(fileOf([after]), [before])[0].changes).toEqual(['en', 'links', 'fields'])
  })

  // A requirement that says nothing is not a requirement, whatever else the record holds.
  it('refuses a record with no wording at all', () => {
    const empty = readReqJson(toReqJson([makeRequirement({ id: 'REQ-A-0001', title: 'Vide' })], OPTIONS))
    expect(planJsonImport(empty, [])[0]).toMatchObject({ action: 'invalid', reason: 'no-wording' })
  })

  it('refuses the second record carrying an identifier the first already used', () => {
    const plan = planJsonImport(fileOf([req(), req({ title: 'Deux' })]), [])
    expect(plan.map((row) => row.action)).toEqual(['create', 'invalid'])
    expect(plan[1].reason).toBe('duplicate-id')
  })

  it('counts what the button will write', () => {
    const plan = planJsonImport(fileOf([req(), req({ id: 'REQ-THERM-0002' })]), [req()])
    expect(countJsonPlan(plan)).toEqual({ create: 1, replace: 0, unchanged: 1, invalid: 0 })
  })
})

describe('changedParts', () => {
  it('has nothing to say about a requirement that did not move', () => {
    expect(changedParts(req(), req())).toEqual([])
  })

  // A wording only one of them has is a change, not an absence.
  it('names a language one of them does not have', () => {
    expect(changedParts(req(), setText(req(), 'en', 'Between 5 and 30 °C.', 'a'))).toEqual(['en'])
  })

  // Not the words alone: a translation nobody has read is a different requirement from
  // the same words reviewed.
  it('sees a wording whose origin changed, with the same words', () => {
    const human = setText(req(), 'en', 'Between 5 and 30 °C.', 'a')
    const machine = setText(req(), 'en', 'Between 5 and 30 °C.', 'llm', 'machine')
    expect(changedParts(human, machine)).toEqual(['en'])
  })

  it('names the history and the other names separately from the fields', () => {
    const before = req()
    const after = addAlias(req(), 'OMLX-THERM-0001')
    expect(changedParts(before, after)).toEqual(['fields'])
  })
})
