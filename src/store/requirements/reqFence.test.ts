import { describe, expect, it } from 'vitest'
import { idsInBlock, reqBlockAt, reqBlockRanges, reqSpecsIn } from './reqFence'

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

describe('reqBlockRanges', () => {
  it('finds every block a note holds, in order', () => {
    const doc = note('```pm-req\nREQ-A\n```\n\ntexte\n\n```pm-req\nREQ-B\n```\n')
    expect(reqBlockRanges(doc).map((b) => b.open)).toEqual([0, 6])
  })

  it('finds none in a note that holds none', () => {
    expect(reqBlockRanges(note('# Titre\n\nDu texte.\n'))).toEqual([])
  })
})

describe('reqSpecsIn', () => {
  it('reads what each block asks the library for', () => {
    const content = '```pm-req\nREQ-A\n```\n\n```pm-req\ncategory: SYS\n```\n'
    const specs = reqSpecsIn(content)
    expect(specs).toHaveLength(2)
    expect(specs[0].ids).toEqual(['REQ-A'])
    expect(specs[1].category).toBe('SYS')
  })

  it('does not take a block of another language for one of ours', () => {
    expect(reqSpecsIn('```js\nconst a = 1\n```\n')).toEqual([])
  })
})
