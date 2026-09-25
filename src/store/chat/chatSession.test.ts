import { describe, expect, it } from 'vitest'
import { chatMessages, withoutFailure, type ChatTurn } from './chatSession'

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
