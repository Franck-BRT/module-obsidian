import { describe, expect, it } from 'vitest'
import { allocateReqId, schemeOf } from './RequirementStore'
import { DEFAULT_REQUIREMENT_SETTINGS } from '../../types'

const SCHEME = { prefix: 'REQ', width: 4 }

describe('allocateReqId', () => {
  it('starts a category at one', () => {
    expect(allocateReqId(SCHEME, 'Système', [], {}).id).toBe('REQ-SYSTEME-0001')
  })

  it('follows on from what the library holds', () => {
    const out = allocateReqId(SCHEME, 'SYS', ['REQ-SYS-0001', 'REQ-SYS-0007'], {})
    expect(out.id).toBe('REQ-SYS-0008')
    expect(out.counters.SYS).toBe(8)
  })

  it('never hands back the id of a deleted requirement', () => {
    // REQ-SYS-0009 existed and was deleted: the library no longer holds it, but the
    // documents that cited it are still out there.
    const out = allocateReqId(SCHEME, 'SYS', ['REQ-SYS-0001'], { SYS: 9 })
    expect(out.id).toBe('REQ-SYS-0010')
    expect(out.counters.SYS).toBe(10)
  })

  it('clears a library imported into a vault whose counters know nothing of it', () => {
    const out = allocateReqId(SCHEME, 'SYS', ['REQ-SYS-0042'], { SYS: 3 })
    expect(out.id).toBe('REQ-SYS-0043')
  })

  it('counts each category on its own', () => {
    const out = allocateReqId(SCHEME, 'ELEC', ['REQ-SYS-0200'], { SYS: 200 })
    expect(out.id).toBe('REQ-ELEC-0001')
    expect(out.counters).toEqual({ SYS: 200, ELEC: 1 })
  })

  it('leaves the counters it was given alone', () => {
    const counters = { SYS: 4 }
    allocateReqId(SCHEME, 'SYS', [], counters)
    expect(counters).toEqual({ SYS: 4 })
  })
})

describe('schemeOf', () => {
  it('takes the settings as given', () => {
    expect(schemeOf(DEFAULT_REQUIREMENT_SETTINGS)).toEqual({ prefix: 'REQ', width: 4 })
  })

  it('makes a typed prefix usable rather than refusing it', () => {
    expect(schemeOf({ ...DEFAULT_REQUIREMENT_SETTINGS, idPrefix: ' ex-ig ' })).toEqual({ prefix: 'EXIG', width: 4 })
  })

  it('falls back rather than minting ids with no prefix or no digits', () => {
    expect(schemeOf({ ...DEFAULT_REQUIREMENT_SETTINGS, idPrefix: '///', idWidth: 0 })).toEqual({
      prefix: 'REQ',
      width: 4
    })
  })
})
