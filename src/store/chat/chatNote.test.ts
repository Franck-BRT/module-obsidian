import { describe, expect, it } from 'vitest'
import {
  appendTurns,
  chatNoteContent,
  chatNoteName,
  chatTitle,
  localStamp,
  readChatNote,
  turnMarkdown
} from './chatNote'
import type { ChatTurn } from './chatSession'

const WORDS = { user: 'Vous', assistant: 'Assistant' }
// Whole minutes, in the local clock: the note keeps the minute, and reads it back in the
// reader's time zone, whichever the tests run in.
const at = (minute: number): string => new Date(2026, 8, 25, 10, minute).toISOString()
const turn = (role: ChatTurn['role'], content: string, minute: number, failed = false): ChatTurn => ({
  role,
  content,
  at: at(minute),
  ...(failed ? { failed } : {})
})
const META = { title: 'Reformuler REQ-LOG-0002', model: 'qwen3', created: at(3) }

describe('a conversation kept as a note', () => {
  const turns = [
    turn('user', 'Peux-tu reformuler REQ-LOG-0002 ?\nElle dit « rapidement ».', 3),
    // A reply as a model writes one: a paragraph, a list, a blank line, code, a quote,
    // and a line that looks like the start of a callout.
    turn(
      'assistant',
      'Proposition :\n\n- dans les 10 min ;\n- perte < 0,1 %.\n\n```text\nREQ-LOG-0002\n```\n\n> Citation du cahier des charges.\n[!question] ceci n’est pas une question',
      4
    ),
    turn('user', 'Et en anglais ?', 5)
  ]

  // The test that matters most: what is written is read back as it was said.
  it('reads back exactly the conversation it was written from', () => {
    const note = readChatNote(chatNoteContent(META, turns, WORDS))
    expect(note).toEqual({ ...META, turns })
  })

  // A blank line inside a reply stays inside its callout, with no trailing space for an
  // editor to strip.
  it('keeps a blank line of a reply inside its callout', () => {
    expect(
      turnMarkdown(turn('assistant', 'Un.\n\nDeux.', 4), WORDS)
        .split('\n')
        .slice(1)
    ).toEqual(['> Un.', '>', '> Deux.'])
  })

  it('reads as the conversation did, one callout a turn', () => {
    expect(turnMarkdown(turns[0], WORDS)).toBe(
      `> [!question] Vous · ${localStamp(at(3))}\n> Peux-tu reformuler REQ-LOG-0002 ?\n> Elle dit « rapidement ».`
    )
  })

  // The panel shows why a reply failed; the record only keeps what was said.
  it('keeps no reply that failed', () => {
    const content = chatNoteContent(META, [turns[0], turn('assistant', 'Délai dépassé', 4, true)], WORDS)
    expect(content).not.toContain('Délai dépassé')
    expect(readChatNote(content).turns).toEqual([turns[0]])
  })

  it('adds turns at the end, and reads them back with the others', () => {
    const first = chatNoteContent(META, turns.slice(0, 2), WORDS)
    const more = appendTurns(first, [turns[2], turn('assistant', 'Proposal:', 6)], WORDS)
    expect(more.startsWith(first.trimEnd())).toBe(true)
    expect(readChatNote(more).turns).toEqual([...turns, turn('assistant', 'Proposal:', 6)])
  })

  // Added, never rewritten: a line the reader wrote in the note stays where they put it.
  it('leaves what the reader wrote in the note where it was', () => {
    const edited = `${chatNoteContent(META, turns.slice(0, 2), WORDS).trimEnd()}\n\nMa remarque à moi.\n`
    const more = appendTurns(edited, [turns[2]], WORDS)
    expect(more).toContain('Ma remarque à moi.')
    expect(readChatNote(more).turns).toEqual(turns)
  })

  it('reads a turn the reader shortened by hand as it now stands', () => {
    const content = chatNoteContent(META, turns.slice(0, 2), WORDS).replace('> - perte < 0,1 %.\n', '')
    expect(readChatNote(content).turns[1].content).toBe(
      'Proposition :\n\n- dans les 10 min ;\n\n```text\nREQ-LOG-0002\n```\n\n> Citation du cahier des charges.\n[!question] ceci n’est pas une question'
    )
  })

  it('writes a title a YAML reader takes back as written, quotes and colons included', () => {
    const tricky = { ...META, title: 'Exigence « A » : "citée" #1' }
    expect(readChatNote(chatNoteContent(tricky, turns, WORDS)).title).toBe(tricky.title)
  })
})

describe('chatTitle', () => {
  it('is the first question, on one line', () => {
    expect(chatTitle('  Peux-tu\nreformuler ?  ', 'Conversation')).toBe('Peux-tu reformuler ?')
  })

  it('cuts a long question at a word', () => {
    const title = chatTitle(
      'Peux-tu reformuler toutes les exigences de la catégorie thermique pour qu’elles soient vérifiables ?',
      'C'
    )
    expect(title).toBe('Peux-tu reformuler toutes les exigences de la catégorie…')
    expect(title.length).toBeLessThanOrEqual(61)
  })

  it('falls back when there is nothing to title it by', () => {
    expect(chatTitle('   ', 'Conversation')).toBe('Conversation')
  })
})

describe('chatNoteName', () => {
  it('starts with when the conversation began, and holds nothing a vault refuses', () => {
    expect(chatNoteName('Exigence A/B : "x"? #1 [ok].', at(3))).toBe(
      `${localStamp(at(3)).replace(':', 'h')} Exigence A B x 1 ok`
    )
  })
})
