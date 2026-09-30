import { describe, expect, it } from 'vitest'
import {
  chatMessages,
  currentContext,
  NOTE_CONTEXT_BUDGET,
  NOTE_FLOOR,
  readableNote,
  shorter,
  shorterNote,
  withNote,
  withoutFailure,
  type ChatTurn
} from './chatSession'

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

describe('a long note with a question', () => {
  const words = {
    heading: (title: string) => `Note : ${title}`,
    truncated: (sent: number, total: number) => `[tronquée : ${sent} sur ${total}]`,
    excerpted: (sent: number, total: number) => `[passages : ${sent} sur ${total}]`
  }
  const pages = Array.from({ length: 40 }, (_, at) =>
    at === 31 ? 'Critère d’arrêt : on s’arrête quand la température est figée.' : `Page ${at} : ${'texte '.repeat(40)}`
  ).join('\n\n')
  const note = { path: 'S.md', title: 'S', content: pages }

  it('goes whole within the budget, which holds a long transcription', () => {
    expect(NOTE_CONTEXT_BUDGET).toBeGreaterThanOrEqual(100000)
    expect(withNote('S', note, words)).toContain('Critère d’arrêt')
  })

  it('goes by its start and the passages the question speaks of, when over the budget', () => {
    const sent = withNote('S', note, words, 3000, ['critere', 'arret'])
    expect(sent).toContain('Page 0 :')
    expect(sent).toContain('Critère d’arrêt')
    expect(sent).toContain('[…]')
    expect(sent).toMatch(/\[passages : \d+ sur \d+\]/)
    // Nothing the question speaks of: its start, cut.
    expect(withNote('S', note, words, 3000, ['inexistant'])).toMatch(/\[tronquée : \d+ sur \d+\]/)
  })

  it('is sent again at half when the model finds it too long, never below a few pages', () => {
    const tooLong = Object.assign(new Error('Rejected (400). — This model’s maximum context length is 32768 tokens'), {
      status: 400
    })
    expect(shorterNote(tooLong, Infinity, 86444)).toBe(43222)
    expect(shorterNote(tooLong, 43222, 86444)).toBe(21611)
    expect(shorterNote(tooLong, 21611, 86444)).toBe(NOTE_FLOOR)
    expect(shorterNote(tooLong, NOTE_FLOOR, 86444)).toBeNull()
    expect(shorterNote(Object.assign(new Error('Payload'), { status: 413 }), 50000, 50000)).toBe(25000)
    // Another failure is not the note's doing.
    expect(shorterNote(new Error('The gateway could not reach the model (502).'), Infinity, 86444)).toBeNull()
    expect(shorterNote(tooLong, Infinity, 8000)).toBeNull()
    // Each file the same way, to its own floor.
    expect(shorter(tooLong, Infinity, 150000, 6000)).toBe(75000)
    expect(shorter(tooLong, 7000, 150000, 6000)).toBe(6000)
    expect(shorter(tooLong, 6000, 150000, 6000)).toBeNull()
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

describe('readableNote', () => {
  const ticket = [
    '---',
    'pm-task: true',
    'projectId: "[[Génie civil|Génie civil]]"',
    'id: "capemoejmul8bzi9"',
    'title: "Plan de ventilation"',
    'dependencies: ["[[déblais|Déblais]]"]',
    'createdAt: "2026-09-28T12:34:26.077Z"',
    'updatedAt: "2026-09-28T12:34:26.077Z"',
    'document:',
    '  state: "expected"',
    '  id: "kept, it is not the ticket’s"',
    '---',
    '',
    'Project: [[Génie civil|Génie civil]]'
  ].join('\n')

  it('takes the plugin’s bookkeeping out of a ticket’s front matter, and nothing else', () => {
    expect(readableNote(ticket)).toBe(
      [
        '---',
        'pm-task: true',
        'projectId: "[[Génie civil|Génie civil]]"',
        'title: "Plan de ventilation"',
        'dependencies: ["[[déblais|Déblais]]"]',
        'document:',
        '  state: "expected"',
        '  id: "kept, it is not the ticket’s"',
        '---',
        '',
        'Project: [[Génie civil|Génie civil]]'
      ].join('\n')
    )
  })

  it('does the same for a project’s note', () => {
    const project = '---\npm-project: true\nid: "2cdxmzl9mul8bzi7"\ntitle: "Génie civil"\n---\n\n# Génie civil'
    expect(readableNote(project)).toBe('---\npm-project: true\ntitle: "Génie civil"\n---\n\n# Génie civil')
  })

  // A requirement's identifier is a name people use; a note of the reader's own is theirs.
  it('leaves every other note as it is', () => {
    const requirement = '---\npm-req: true\nid: REQ-THERM-0001\n---\nLe boîtier…'
    expect(readableNote(requirement)).toBe(requirement)
    const own = '---\nid: 42\ncreatedAt: hier\n---\nMa note'
    expect(readableNote(own)).toBe(own)
    expect(readableNote('Pas d’en-tête\nid: 3')).toBe('Pas d’en-tête\nid: 3')
  })
})
