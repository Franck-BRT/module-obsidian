import { describe, expect, it } from 'vitest'
import { chatMessages, currentContext, withNote, withoutFailure, type ChatTurn } from './chatSession'

const turn = (role: ChatTurn['role'], content: string, failed = false): ChatTurn => ({
  role,
  content,
  at: '2026-09-25T10:00:00Z',
  ...(failed ? { failed } : {})
})

describe('chatMessages', () => {
  it('sends the instructions, then the conversation in order', () => {
    expect(
      chatMessages([turn('user', 'Bonjour'), turn('assistant', 'Salut'), turn('user', 'Ça va ?')], 'Sois bref.')
    ).toEqual([
      { role: 'system', content: 'Sois bref.' },
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Salut' },
      { role: 'user', content: 'Ça va ?' }
    ])
  })

  // The model never said it; sending it back would put words in its mouth.
  it('leaves out a reply that failed, and sends the two questions around it as one', () => {
    const turns = [turn('user', 'Première'), turn('assistant', 'Délai dépassé', true), turn('user', 'Seconde')]
    expect(chatMessages(turns, 'S')).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'Première\n\nSeconde' }
    ])
  })

  it('keeps the most recent turns that fit, and drops the oldest', () => {
    const turns = [
      turn('user', 'a'.repeat(50)),
      turn('assistant', 'b'.repeat(50)),
      turn('user', 'c'.repeat(50)),
      turn('assistant', 'd'.repeat(50)),
      turn('user', 'e')
    ]
    const sent = chatMessages(turns, 'S', 120).map((message) => message.content[0])
    expect(sent).toEqual(['S', 'c', 'd', 'e'])
  })

  // Cut from its question, a reply reads as the model talking to itself.
  it('never opens the conversation on a reply', () => {
    const turns = [turn('user', 'a'.repeat(50)), turn('assistant', 'b'.repeat(50)), turn('user', 'c')]
    expect(chatMessages(turns, 'S', 60).map((message) => message.role)).toEqual(['system', 'user'])
  })

  it('sends the latest question even when it alone is over the budget', () => {
    expect(chatMessages([turn('user', 'x'.repeat(500))], 'S', 100)).toHaveLength(2)
  })
})

describe('withoutFailure', () => {
  it('takes off the failed reply so the question can be asked again', () => {
    const turns = [turn('user', 'Q'), turn('assistant', 'Erreur', true)]
    expect(withoutFailure(turns)).toEqual([turns[0]])
    expect(withoutFailure([turns[0]])).toEqual([turns[0]])
  })
})

describe('withNote', () => {
  const words = {
    heading: (title: string, path: string) => `Note ouverte : ${title} (${path})`,
    truncated: (sent: number, total: number) => `[tronquée : ${sent} sur ${total}]`
  }
  const note = (content: string) => ({ path: 'Specs/Thermique.md', title: 'Thermique', content })

  it('leaves the instructions alone when there is no note', () => {
    expect(withNote('Sois bref.', null, words)).toBe('Sois bref.')
  })

  it('puts the note after the instructions, said to be the one the reader has open', () => {
    expect(withNote('Sois bref.', note('# Thermique\n\nREQ-THERM-0001'), words)).toBe(
      'Sois bref.\n\nNote ouverte : Thermique (Specs/Thermique.md)\n<note path="Specs/Thermique.md">\n# Thermique\n\nREQ-THERM-0001\n</note>'
    )
  })

  // Whole paragraphs, and the model told there is more: it must not answer as if it had
  // read the rest.
  it('cuts a long note at a paragraph, and says how much was sent', () => {
    const content = `${'a'.repeat(80)}\n\n${'b'.repeat(80)}\n\n${'c'.repeat(80)}`
    const sent = withNote('S', note(content), words, 200)
    expect(sent).toContain(`${'b'.repeat(80)}\n\n[tronquée : 162 sur 244]\n</note>`)
    expect(sent).not.toContain('ccc')
  })

  it('cuts in the middle when no paragraph ends near the budget', () => {
    const sent = withNote('S', note('x'.repeat(500)), words, 100)
    expect(sent).toContain(`${'x'.repeat(100)}\n\n[tronquée : 100 sur 500]`)
  })
})

describe('currentContext', () => {
  it('is the note the latest question was asked about', () => {
    const turns = [
      { ...turn('user', 'Q1'), context: 'A.md' },
      turn('assistant', 'R1'),
      turn('user', 'Q2'),
      turn('assistant', 'Erreur', true)
    ]
    expect(currentContext(turns)).toBeUndefined()
    expect(currentContext(turns.slice(0, 2))).toBe('A.md')
  })
})
