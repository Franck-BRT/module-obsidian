import { describe, expect, it } from 'vitest'
import { withSelection } from './selection'
import { chatNoteContent, readChatNote } from './chatNote'

const cut = (sent: number, total: number) => `[coupé : ${sent} sur ${total}]`

describe('withSelection', () => {
  it('quotes the passage under the question, blank lines kept as quoted ones', () => {
    expect(withSelection(' Reformule. ', 'Le calculateur doit\r\n\r\ntransmettre les journaux.\n', cut)).toBe(
      'Reformule.\n\n> Le calculateur doit\n>\n> transmettre les journaux.'
    )
  })

  it('leaves the question alone with nothing chosen', () => {
    expect(withSelection('Reformule.', '  \n ', cut)).toBe('Reformule.')
  })

  it('cuts a long passage at a line, and says so', () => {
    const passage = Array.from({ length: 30 }, (_, at) => `ligne ${at}`).join('\n')
    const out = withSelection('Q', passage, cut, 60)
    expect(
      out
        .split('\n')
        .filter((line) => line.startsWith('> '))
        .at(-1)
    ).toBe('> ligne 6')
    expect(
      out.endsWith(
        `[coupé : ${'ligne 0\nligne 1\nligne 2\nligne 3\nligne 4\nligne 5\nligne 6'.length} sur ${passage.length}]`
      )
    ).toBe(true)
  })

  // Kept in the conversation's note with the question, and read back as it was asked.
  it('goes into the note with its question, and comes back whole', () => {
    const content = withSelection('Résume ce passage.', 'Premier paragraphe.\n\n> Une citation dans le passage.', cut)
    const turn = { role: 'user' as const, content, at: '2026-09-28T12:00:00.000Z' }
    const note = chatNoteContent({ title: 'T', model: 'm', created: turn.at }, [turn], { user: 'Vous', assistant: 'A' })
    expect(readChatNote(note).turns[0].content).toBe(content)
  })
})
