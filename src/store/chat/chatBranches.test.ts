import { describe, expect, it } from 'vitest'
import type { ChatTurn } from './chatSession'
import { branchCount, branchEnd, conversationTree, currentThread, threadTo } from './chatBranches'
import { branches, chatNoteContent, localStamp, readChatNote, turnMarkdown, withBranchBlock } from './chatNote'

const at = (minute: number): string => new Date(2026, 8, 28, 14, minute).toISOString()
const q = (text: string, minute: number, extra: Partial<ChatTurn> = {}): ChatTurn => ({
  role: 'user',
  content: text,
  at: at(minute),
  ...extra
})
const r = (text: string, minute: number): ChatTurn => ({ role: 'assistant', content: text, at: at(minute) })

/**
 *   A ─ B ─ C          (C asked after B)
 *    ╲
 *     B' ─ D           (B' asked again in place of B, D after it)
 *      ╲
 *       ↪ E            (E asked after going back to C's branch: follows C)
 */
const A = q('A', 1)
const Ar = r('a', 1)
const B = q('B', 2)
const Br = r('b', 2)
const C = q('C', 3)
const Cr = r('c', 3)
const B2 = q("B'", 4, { retakes: B.at })
const B2r = r("b'", 4)
const D = q('D', 5)
const Dr = r('d', 5)
const E = q('E', 6, { follows: C.at })
const Er = r('e', 6)
const note = [A, Ar, B, Br, C, Cr, B2, B2r, D, Dr]

describe('conversationTree', () => {
  it('lays a retake beside the question it retakes, on a lane of its own', () => {
    const tree = conversationTree(note)
    expect(tree.exchanges.map((one) => [one.question.content, one.parent, one.lane, one.current])).toEqual([
      ['A', null, 0, true],
      ['B', 0, 0, false],
      ['C', 1, 0, false],
      ["B'", 0, 1, true],
      ['D', 3, 1, true]
    ])
    expect(tree.lanes).toBe(2)
    expect(branchCount(tree)).toBe(2)
  })

  // Going back to an older branch and asking there makes it the thread again.
  it('goes on from the branch a question names', () => {
    const tree = conversationTree([...note, E, Er])
    expect(tree.exchanges[5]).toMatchObject({ parent: 2, lane: 0, current: true })
    expect(currentThread([...note, E, Er])).toEqual([A, Ar, B, Br, C, Cr, E, Er])
  })

  it('follows the note’s order when nothing says otherwise', () => {
    expect(currentThread(note)).toEqual([A, Ar, B2, B2r, D, Dr])
    expect(conversationTree([A, Ar, B, Br]).lanes).toBe(1)
  })
})

describe('threadTo and branchEnd', () => {
  const tree = conversationTree(note)

  it('gives the path to an exchange, and where a branch through it was left', () => {
    expect(threadTo(tree, 2)).toEqual([A, Ar, B, Br, C, Cr])
    expect(branchEnd(tree, 1)).toBe(2)
    // From the first exchange, the latest branch: the retake's.
    expect(branchEnd(tree, 0)).toBe(4)
  })
})

describe('the note', () => {
  it('names where a question goes on from, and reads it back', () => {
    expect(turnMarkdown(E, { user: 'Vous', assistant: 'A' }).split('\n')[0]).toBe(
      `> [!question] Vous · ${localStamp(E.at)} · ↪ ${localStamp(C.at)}`
    )
    const read = readChatNote(
      chatNoteContent({ title: 'T', model: 'm', created: A.at }, [...note, E, Er], { user: 'Vous', assistant: 'A' })
    )
    expect(read.all).toEqual([...note, E, Er])
    expect(read.turns).toEqual([A, Ar, B, Br, C, Cr, E, Er])
  })
})

describe('the branches block', () => {
  const content = chatNoteContent({ title: 'T', model: 'm', created: A.at }, [A, Ar], { user: 'Vous', assistant: 'A' })

  it('goes under the note’s title, once, and leaves the conversation read as it was', () => {
    const once = withBranchBlock(content)
    expect(once).toContain('# T\n\n```pm-chat-branches\n```\n')
    expect(withBranchBlock(once)).toBe(once)
    expect(readChatNote(once).turns).toEqual([A, Ar])
  })

  it('is written by the first branch and not before', () => {
    expect(branches(A)).toBe(false)
    expect(branches(B2)).toBe(true)
    expect(branches(E)).toBe(true)
    expect(branches(Ar)).toBe(false)
  })
})
