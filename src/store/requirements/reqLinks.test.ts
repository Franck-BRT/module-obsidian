import { describe, expect, it } from 'vitest'
import {
  addLink,
  clearSuspect,
  hasSuspectLinks,
  linksOfKind,
  makeRequirement,
  markLinksToward,
  removeLink
} from './Requirement'

const base = () => makeRequirement({ id: 'REQ-SYS-0010' })

describe('addLink', () => {
  it('records a relation', () => {
    const linked = addLink(base(), 'derives-from', 'REQ-SYS-0001')
    expect(linked.links).toEqual([{ kind: 'derives-from', to: 'REQ-SYS-0001' }])
  })

  it('records the same pair once, whatever the casing', () => {
    let requirement = addLink(base(), 'derives-from', 'REQ-SYS-0001')
    requirement = addLink(requirement, 'derives-from', 'req-sys-0001')
    expect(requirement.links).toHaveLength(1)
  })

  it('keeps two kinds of relation to the same requirement apart', () => {
    let requirement = addLink(base(), 'derives-from', 'REQ-SYS-0001')
    requirement = addLink(requirement, 'conflicts-with', 'REQ-SYS-0001')
    expect(requirement.links).toHaveLength(2)
  })

  it('refuses to relate a requirement to itself', () => {
    expect(addLink(base(), 'refines', 'req-sys-0010').links).toEqual([])
  })

  it('refuses a target that is nothing but spaces', () => {
    expect(addLink(base(), 'refines', '   ').links).toEqual([])
  })
})

describe('removeLink', () => {
  it('takes one out and leaves the rest', () => {
    let requirement = addLink(base(), 'derives-from', 'REQ-SYS-0001')
    requirement = addLink(requirement, 'refines', 'REQ-SYS-0002')
    expect(removeLink(requirement, 'derives-from', 'REQ-SYS-0001').links).toEqual([
      { kind: 'refines', to: 'REQ-SYS-0002' }
    ])
  })

  it('changes nothing when there was nothing to take out', () => {
    const requirement = base()
    expect(removeLink(requirement, 'refines', 'REQ-SYS-0404')).toBe(requirement)
  })
})

describe('markLinksToward', () => {
  it('marks what points at the requirement that moved, and nothing else', () => {
    let requirement = addLink(base(), 'derives-from', 'REQ-SYS-0001')
    requirement = addLink(requirement, 'refines', 'REQ-SYS-0002')
    const marked = markLinksToward(requirement, 'REQ-SYS-0001')
    expect(marked.links[0].suspect).toBe(true)
    expect(marked.links[1].suspect).toBeUndefined()
  })

  it('marks every relation to it, not only the first', () => {
    let requirement = addLink(base(), 'derives-from', 'REQ-SYS-0001')
    requirement = addLink(requirement, 'conflicts-with', 'REQ-SYS-0001')
    expect(markLinksToward(requirement, 'REQ-SYS-0001').links.every((link) => link.suspect)).toBe(true)
  })

  // Rewriting the note on every save of every neighbour would be a vault that never
  // settles, and a modification date that means nothing.
  it('changes nothing when the marks are already there', () => {
    const requirement = markLinksToward(addLink(base(), 'refines', 'REQ-SYS-0001'), 'REQ-SYS-0001')
    expect(markLinksToward(requirement, 'REQ-SYS-0001')).toBe(requirement)
  })

  it('changes nothing when nothing points at it', () => {
    const requirement = addLink(base(), 'refines', 'REQ-SYS-0002')
    expect(markLinksToward(requirement, 'REQ-SYS-0001')).toBe(requirement)
  })
})

describe('clearSuspect', () => {
  it('takes the mark off the one that was looked at', () => {
    const requirement = markLinksToward(addLink(base(), 'refines', 'REQ-SYS-0001'), 'REQ-SYS-0001')
    const cleared = clearSuspect(requirement, 'refines', 'REQ-SYS-0001')
    expect(cleared.links[0].suspect).toBeUndefined()
    expect(hasSuspectLinks(cleared)).toBe(false)
  })

  it('leaves the other marks where they are', () => {
    let requirement = addLink(base(), 'refines', 'REQ-SYS-0001')
    requirement = addLink(requirement, 'derives-from', 'REQ-SYS-0002')
    requirement = markLinksToward(markLinksToward(requirement, 'REQ-SYS-0001'), 'REQ-SYS-0002')
    const cleared = clearSuspect(requirement, 'refines', 'REQ-SYS-0001')
    expect(hasSuspectLinks(cleared)).toBe(true)
  })

  it('changes nothing when there was no mark', () => {
    const requirement = addLink(base(), 'refines', 'REQ-SYS-0001')
    expect(clearSuspect(requirement, 'refines', 'REQ-SYS-0001')).toBe(requirement)
  })
})

describe('linksOfKind', () => {
  it('picks out one kind', () => {
    let requirement = addLink(base(), 'satisfied-by', 'task-1')
    requirement = addLink(requirement, 'derives-from', 'REQ-SYS-0001')
    expect(linksOfKind(requirement, 'satisfied-by').map((link) => link.to)).toEqual(['task-1'])
  })
})
