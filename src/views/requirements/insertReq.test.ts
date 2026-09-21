import { describe, expect, it } from 'vitest'
import { insertRequirement } from './insertReq'

const note = (text: string): string[] => text.split('\n')

describe('insertRequirement', () => {
  it('writes a whole block where there is none', () => {
    const doc = note('Du texte.\n\nEncore.\n')
    expect(insertRequirement(doc, 1, 'REQ-SYS-0001')).toEqual({
      insert: '```pm-req\nREQ-SYS-0001\n```\n',
      at: { line: 1, ch: 0 }
    })
  })

  it('extends the block the cursor is in rather than opening a second one', () => {
    const doc = note('```pm-req\nREQ-SYS-0001\n```\n')
    expect(insertRequirement(doc, 1, 'REQ-SYS-0002')).toEqual({
      insert: 'REQ-SYS-0002\n',
      at: { line: 2, ch: 0 }
    })
  })

  it('adds at the end of the list, not wherever the cursor rested', () => {
    const doc = note('```pm-req\nREQ-SYS-0001\nREQ-SYS-0002\nREQ-SYS-0003\n```\n')
    expect(insertRequirement(doc, 1, 'REQ-SYS-0004')?.at.line).toBe(4)
  })

  it('refuses to quote the same requirement twice in one block', () => {
    const doc = note('```pm-req\nids: REQ-SYS-0001\n```\n')
    expect(insertRequirement(doc, 1, 'req-sys-0001')).toBeNull()
  })

  // A line past the end of the note is not a place an editor can be told to write at.
  it('appends after the last line when the block is still being typed', () => {
    const doc = note('texte\n```pm-req\nREQ-SYS-0001')
    expect(insertRequirement(doc, 2, 'REQ-SYS-0002')).toEqual({
      insert: '\nREQ-SYS-0002',
      at: { line: 2, ch: 'REQ-SYS-0001'.length }
    })
  })

  it('still quotes it when the cursor is in a different block', () => {
    const doc = note('```pm-req\nREQ-SYS-0001\n```\n\n```pm-req\nREQ-ELEC-0001\n```\n')
    expect(insertRequirement(doc, 5, 'REQ-SYS-0001')).toMatchObject({ insert: 'REQ-SYS-0001\n' })
  })
})
