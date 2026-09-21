import { describe, expect, it } from 'vitest'
import { DEFAULT_ID_SCHEME, formatReqId, idCategory, isReqId, nextReqId, parseReqId, reqFileName } from './reqId'

describe('reading an identifier', () => {
  it('splits it into its three parts', () => {
    expect(parseReqId('REQ-SYS-0042')).toEqual({ prefix: 'REQ', category: 'SYS', number: 42 })
  })

  it('accepts one typed in lower case', () => {
    expect(parseReqId('req-sys-0042')).toEqual({ prefix: 'REQ', category: 'SYS', number: 42 })
  })

  it('refuses what is not one', () => {
    expect(parseReqId('REQ-SYS')).toBeNull()
    expect(parseReqId('REQ--0042')).toBeNull()
    expect(parseReqId('42')).toBeNull()
    expect(isReqId('')).toBe(false)
  })
})

describe('turning a category into something an id can hold', () => {
  it('drops accents rather than keeping two spellings of one category', () => {
    expect(idCategory('Système')).toBe('SYSTEME')
    expect(idCategory('SYSTEME')).toBe('SYSTEME')
  })

  it('strips everything that cannot sit between two hyphens', () => {
    expect(idCategory('sys/flight')).toBe('SYSFLIGHT')
    expect(idCategory('Interface 2')).toBe('INTERFACE2')
  })

  it('never returns nothing', () => {
    expect(idCategory('   ')).toBe('GEN')
    expect(idCategory('///')).toBe('GEN')
  })
})

describe('allocating the next identifier', () => {
  it('starts at one in an empty category', () => {
    expect(nextReqId(DEFAULT_ID_SCHEME, 'SYS', [])).toBe('REQ-SYS-0001')
  })

  it('follows the highest in that category, ignoring the others', () => {
    const taken = ['REQ-SYS-0001', 'REQ-SYS-0007', 'REQ-INT-0099']
    expect(nextReqId(DEFAULT_ID_SCHEME, 'SYS', taken)).toBe('REQ-SYS-0008')
    expect(nextReqId(DEFAULT_ID_SCHEME, 'INT', taken)).toBe('REQ-INT-0100')
  })

  /**
   * The one that matters. Reusing 42 after its requirement was deleted would re-point
   * every reference that ever named it — in documents this plugin will never see.
   */
  it('never hands back a number a deleted requirement once had', () => {
    const everSeen = ['REQ-SYS-0001', 'REQ-SYS-0042']
    expect(nextReqId(DEFAULT_ID_SCHEME, 'SYS', everSeen)).toBe('REQ-SYS-0043')
  })

  it('clears a number wider than the scheme rather than truncating it', () => {
    expect(nextReqId(DEFAULT_ID_SCHEME, 'SYS', ['REQ-SYS-100000'])).toBe('REQ-SYS-100001')
  })

  it('ignores ids minted under another prefix', () => {
    expect(nextReqId(DEFAULT_ID_SCHEME, 'SYS', ['EXG-SYS-0500'])).toBe('REQ-SYS-0001')
  })

  it('ignores anything that is not an identifier at all', () => {
    expect(nextReqId(DEFAULT_ID_SCHEME, 'SYS', ['', 'notes', 'REQ-SYS'])).toBe('REQ-SYS-0001')
  })

  it('pads to the width the scheme asks for', () => {
    expect(formatReqId({ prefix: 'EXG', width: 3 }, 'sys', 7)).toBe('EXG-SYS-007')
  })
})

describe('the file a requirement lives in', () => {
  it('leads with the id, so a folder sorts like a register', () => {
    expect(reqFileName('REQ-SYS-0042', 'Temps de démarrage')).toBe('REQ-SYS-0042 Temps de démarrage')
  })

  it('drops what a vault refuses in a name', () => {
    expect(reqFileName('REQ-SYS-0042', 'A/B: c?')).toBe('REQ-SYS-0042 A B c')
  })

  it('is just the id when there is no title yet', () => {
    expect(reqFileName('REQ-SYS-0042', '   ')).toBe('REQ-SYS-0042')
  })
})
