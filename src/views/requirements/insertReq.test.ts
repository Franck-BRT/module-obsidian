import { describe, expect, it } from 'vitest'
import { idsInBlock, insertRequirement, reqBlockAt } from './insertReq'

const note = (text: string): string[] => text.split('\n')

describe('reqBlockAt', () => {
  const doc = note('# Spécification\n\nDu texte.\n\n```pm-req\nREQ-SYS-0001\n```\n\nEncore du texte.\n')

  it('finds the block the cursor is inside', () => {
    expect(reqBlockAt(doc, 5)).toMatchObject({ open: 4, close: 6, closed: true })
  })

  it('counts either fence as being in the block', () => {
    expect(reqBlockAt(doc, 4)).not.toBeNull()
    expect(reqBlockAt(doc, 6)).not.toBeNull()
  })

  it('finds nothing outside it', () => {
    expect(reqBlockAt(doc, 2)).toBeNull()
    expect(reqBlockAt(doc, 8)).toBeNull()
  })

  it('does not mistake another kind of block for this one', () => {
    expect(reqBlockAt(note('```js\nconst a = 1\n```\n'), 1)).toBeNull()
  })

  // A fence looks the same opening and closing, so the only way to know which one a line
  // sits after is to have read the ones before it.
  it('is not fooled by a code block above it', () => {
    const doc2 = note('```js\nconst a = 1\n```\n\n```pm-req\nREQ-SYS-0001\n```\n')
    expect(reqBlockAt(doc2, 1)).toBeNull()
    expect(reqBlockAt(doc2, 5)).toMatchObject({ open: 4 })
  })

  it('handles a block that is still being typed', () => {
    const doc2 = note('texte\n```pm-req\nREQ-SYS-0001')
    expect(reqBlockAt(doc2, 2)).toMatchObject({ open: 1, closed: false })
  })

  it('finds a block fenced with tildes', () => {
    expect(reqBlockAt(note('~~~pm-req\nREQ-SYS-0001\n~~~\n'), 1)).toMatchObject({ open: 0, close: 2 })
  })

  // A note about markdown quotes fences as text. A tilde inside a backtick block is
  // content, and taking it for a closing fence shifts every block after it by one.
  it('does not let a fence of another kind close a block it is inside', () => {
    const doc = note('```text\n~~~\n```\n\n```pm-req\nREQ-SYS-0001\n```\n')
    expect(reqBlockAt(doc, 1)).toBeNull()
    expect(reqBlockAt(doc, 5)).toMatchObject({ open: 4, close: 6 })
  })
})

describe('idsInBlock', () => {
  it('reads the identifiers a block already quotes, however they were written', () => {
    const doc = note('```pm-req\nids: REQ-SYS-0001, REQ-SYS-0002\nREQ-ELEC-0001\nlang: en\n```\n')
    const block = reqBlockAt(doc, 1)
    expect(block).not.toBeNull()
    expect(block && idsInBlock(doc, block)).toEqual(['REQ-SYS-0001', 'REQ-SYS-0002', 'REQ-ELEC-0001'])
  })
})

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
