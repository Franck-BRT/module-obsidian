import { describe, expect, it } from 'vitest'
import { makeRequirement } from './Requirement'
import {
  addAlias,
  aliasPrefix,
  aliasWithPrefix,
  cleanAliases,
  findByName,
  nameOwner,
  namesOf,
  normalizeAlias,
  removeAlias
} from './reqAlias'

const req = (over: Parameters<typeof makeRequirement>[0] = {}) => makeRequirement({ id: 'REQ-SYS-0001', ...over })

describe('normalizeAlias', () => {
  it('says it the way an identifier is said', () => {
    expect(normalizeAlias('  omlx-sys-0001 ')).toBe('OMLX-SYS-0001')
  })

  // A pm-req block separates the identifiers it quotes with them, so an alias holding
  // one could never be cited.
  it('takes out what a block would read as a separator', () => {
    expect(normalizeAlias('OMLX,SYS;0001')).toBe('OMLX-SYS-0001')
  })

  it('makes one name out of a name written with spaces', () => {
    expect(normalizeAlias('projet alpha 12')).toBe('PROJET-ALPHA-12')
  })

  it('has nothing to say about nothing', () => {
    expect(normalizeAlias('   ')).toBe('')
  })
})

describe('aliasPrefix', () => {
  it('makes a project name citable', () => {
    expect(aliasPrefix('Projet Alpha')).toBe('PROJET-ALPHA')
  })

  // SYSTÈME and SYSTEME must not be two prefixes.
  it('drops accents rather than transliterating them', () => {
    expect(aliasPrefix('Été')).toBe('ETE')
  })
})

describe('aliasWithPrefix', () => {
  it('carries the category and the number over untouched', () => {
    expect(aliasWithPrefix('REQ-SYS-0001', 'OMLX')).toBe('OMLX-SYS-0001')
  })

  it('keeps a number wider than the scheme, because it is still that requirement', () => {
    expect(aliasWithPrefix('REQ-ELEC-100000', 'Projet Alpha')).toBe('PROJET-ALPHA-ELEC-100000')
  })

  it('has nothing to build from an identifier it cannot read, or no prefix', () => {
    expect(aliasWithPrefix('maison', 'OMLX')).toBe('')
    expect(aliasWithPrefix('REQ-SYS-0001', '  ')).toBe('')
  })
})

describe('addAlias', () => {
  it('adds one', () => {
    expect(addAlias(req(), 'omlx-sys-0001').aliases).toEqual(['OMLX-SYS-0001'])
  })

  it('says nothing twice', () => {
    const once = addAlias(req(), 'OMLX-SYS-0001')
    expect(addAlias(once, 'omlx-sys-0001')).toBe(once)
  })

  // An alias equal to the requirement's own id says nothing at all.
  it('refuses the name the requirement already has', () => {
    const before = req()
    expect(addAlias(before, 'req-sys-0001')).toBe(before)
  })

  it('refuses nothing at all', () => {
    const before = req()
    expect(addAlias(before, '  ')).toBe(before)
  })

  it('removes one, and leaves the rest alone', () => {
    const two = addAlias(addAlias(req(), 'A-1'), 'B-2')
    expect(removeAlias(two, 'a-1').aliases).toEqual(['B-2'])
  })

  it('has nothing to remove when it was never there', () => {
    const before = req()
    expect(removeAlias(before, 'A-1')).toBe(before)
  })
})

describe('finding a requirement by name', () => {
  const library = [req({ aliases: ['OMLX-SYS-0001'] }), req({ id: 'REQ-ELEC-0001' })]

  it('finds it by its own identifier', () => {
    expect(findByName(library, 'req-sys-0001')?.id).toBe('REQ-SYS-0001')
  })

  it('finds the same one by the name the project calls it', () => {
    expect(findByName(library, 'OMLX-SYS-0001')?.id).toBe('REQ-SYS-0001')
  })

  it('finds nothing for a name nobody answers to', () => {
    expect(findByName(library, 'OMLX-SYS-0404')).toBeNull()
  })

  it('names who already answers to a name, so a second claim can be refused', () => {
    expect(nameOwner(library, 'OMLX-SYS-0001')?.id).toBe('REQ-SYS-0001')
    expect(nameOwner(library, 'OMLX-SYS-0002')).toBeNull()
  })

  // Asked while editing the requirement that already holds it, which is not a conflict.
  it('does not count the requirement asking', () => {
    expect(nameOwner(library, 'OMLX-SYS-0001', 'REQ-SYS-0001')).toBeNull()
  })

  // The requirement an alias hides is the one that cannot be renamed out of the way.
  it('counts an identifier as taken, not only an alias', () => {
    expect(nameOwner(library, 'REQ-ELEC-0001')?.id).toBe('REQ-ELEC-0001')
  })

  it('answers to its own name first', () => {
    expect(namesOf(req({ aliases: ['A-1'] }))).toEqual(['REQ-SYS-0001', 'A-1'])
  })
})

describe('cleanAliases', () => {
  it('normalizes what was stored', () => {
    expect(cleanAliases([' omlx-sys-0001 ', 'x,1'], 'REQ-SYS-0001')).toEqual(['OMLX-SYS-0001', 'X-1'])
  })

  it('keeps each one once, and never the requirement’s own identifier', () => {
    expect(cleanAliases(['A-1', 'a-1', 'REQ-SYS-0001'], 'REQ-SYS-0001')).toEqual(['A-1'])
  })

  it('makes nothing out of something that is not a list', () => {
    expect(cleanAliases('A-1', 'REQ-SYS-0001')).toEqual([])
  })
})
