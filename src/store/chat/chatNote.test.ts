import { describe, expect, it } from 'vitest'
import {
  appendTurns,
  chatNoteContent,
  chatNoteName,
  chatTitle,
  localStamp,
  noteLink,
  readChatNote,
  turnMarkdown,
  currentThread
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
    { ...turn('user', 'Peux-tu reformuler REQ-LOG-0002 ?\nElle dit « rapidement ».', 3), context: 'Specs/Journaux.md' },
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
    // With no branch, the thread is the whole note.
    expect(note).toEqual({ ...META, turns, all: turns })
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
      `> [!question] Vous · ${localStamp(at(3))} · [[Specs/Journaux|Journaux]]\n> Peux-tu reformuler REQ-LOG-0002 ?\n> Elle dit « rapidement ».`
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

describe('noteLink', () => {
  it('links to a note by its path and shows its name', () => {
    expect(noteLink('Specs/Thermique.md')).toBe('[[Specs/Thermique|Thermique]]')
    expect(noteLink('Racine.md')).toBe('[[Racine]]')
  })

  // A link the reader rewrote by hand — to a heading, with another alias — still names
  // the note.
  it('is read back however the reader rewrote it', () => {
    const content = chatNoteContent(META, [turn('user', 'Q', 3)], WORDS)
    const edited = content.replace(
      `Vous · ${localStamp(at(3))}`,
      `Vous · ${localStamp(at(3))} · [[Specs/Thermique#Seuils|la note]]`
    )
    expect(readChatNote(edited).turns[0].context).toBe('Specs/Thermique.md')
  })
})

describe('the requirements a question was asked about', () => {
  const linked = {
    ...WORDS,
    requirement: (id: string) => `[[Exigences/${id} Un titre|${id}]]`
  }
  const question = {
    ...turn('user', 'Compare-les.', 3),
    context: 'Specs/Thermique.md',
    requirements: ['REQ-THERM-0001', 'REQ-THERM-0002']
  }

  it('are named in the question’s title, as links to their notes', () => {
    expect(turnMarkdown(question, linked).split('\n')[0]).toBe(
      `> [!question] Vous · ${localStamp(at(3))} · [[Specs/Thermique|Thermique]] · 📋 [[Exigences/REQ-THERM-0001 Un titre|REQ-THERM-0001]], [[Exigences/REQ-THERM-0002 Un titre|REQ-THERM-0002]]`
    )
  })

  // Read back as identifiers, and never mistaken for the note the question was about.
  it('are read back by identifier, beside the note', () => {
    const turns = readChatNote(chatNoteContent(META, [question], linked)).turns
    expect(turns).toEqual([question])
  })

  it('are read back however they were written: bare, or linked without an alias', () => {
    const content = chatNoteContent(META, [turn('user', 'Q', 3)], WORDS).replace(
      `Vous · ${localStamp(at(3))}`,
      `Vous · ${localStamp(at(3))} · 📋 REQ-A-0001, [[Exigences/REQ-A-0002 Titre]]`
    )
    expect(readChatNote(content).turns[0]).toMatchObject({ requirements: ['REQ-A-0001', 'REQ-A-0002'] })
    expect(readChatNote(content).turns[0].context).toBeUndefined()
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

describe('the projects a question was asked about', () => {
  const question = {
    ...turn('user', 'Où en est-on ?', 3),
    context: 'Specs/Thermique.md',
    projects: ['Projets/Refonte chaufferie.md'],
    requirements: ['REQ-THERM-0001']
  }

  it('is named in the question’s title, as a link to its note', () => {
    expect(turnMarkdown(question, WORDS).split('\n')[0]).toBe(
      `> [!question] Vous · ${localStamp(at(3))} · [[Specs/Thermique|Thermique]] · 📁 [[Projets/Refonte chaufferie|Refonte chaufferie]] · 📋 REQ-THERM-0001`
    )
  })

  // Never mistaken for the note the question was about, nor the note for it.
  it('is read back beside the note and the requirements', () => {
    expect(readChatNote(chatNoteContent(META, [question], WORDS)).turns).toEqual([question])
  })

  it('is read back alone, the question then about no note', () => {
    const alone = { ...turn('user', 'Q', 3), projects: ['Refonte.md'] }
    const read = readChatNote(chatNoteContent(META, [alone], WORDS)).turns[0]
    expect(read.projects).toEqual(['Refonte.md'])
    expect(read.context).toBeUndefined()
  })

  // Several projects at once: each a link, read back in order, a project with a comma in
  // its name included.
  it('are all named, and all read back', () => {
    const several = {
      ...turn('user', 'Compare-les.', 3),
      projects: ['Work/Génie civil.md', 'Work/Équipements, lot 2.md', 'Ligne 6.md']
    }
    expect(turnMarkdown(several, WORDS).split('\n')[0]).toBe(
      `> [!question] Vous · ${localStamp(at(3))} · 📁 [[Work/Génie civil|Génie civil]], [[Work/Équipements, lot 2|Équipements, lot 2]], [[Ligne 6]]`
    )
    expect(readChatNote(chatNoteContent(META, [several], WORDS)).turns).toEqual([several])
  })
})

describe('the files a question was asked with', () => {
  const question = {
    ...turn('user', 'Mets le planning à jour.', 3),
    context: 'Specs/Thermique.md',
    projects: ['Projets/Ligne 6.md'],
    files: ['Projets/Ligne 6/_docs/Planning indice C.pdf', 'Planning.xlsx']
  }

  it('are named in the question’s title, as links keeping their extension', () => {
    expect(turnMarkdown(question, WORDS).split('\n')[0]).toBe(
      `> [!question] Vous · ${localStamp(at(3))} · [[Specs/Thermique|Thermique]] · 📁 [[Projets/Ligne 6|Ligne 6]] · 📎 [[Projets/Ligne 6/_docs/Planning indice C.pdf|Planning indice C.pdf]], [[Planning.xlsx]]`
    )
  })

  // Read back by path, and never taken for the note or the project.
  it('are read back beside the note and the project', () => {
    expect(readChatNote(chatNoteContent(META, [question], WORDS)).turns).toEqual([question])
  })

  it('leave the question about no note when it has none', () => {
    const alone = { ...turn('user', 'Q', 3), files: ['p.pdf'] }
    const read = readChatNote(chatNoteContent(META, [alone], WORDS)).turns[0]
    expect(read.files).toEqual(['p.pdf'])
    expect(read.context).toBeUndefined()
  })
})

describe('the skills a question was asked with', () => {
  const question = {
    ...turn('user', 'Fais le CR.', 3),
    projects: ['Projets/Ligne 6.md'],
    files: ['CR.pdf'],
    skills: ['Chats/Skills/Compte rendu.md', 'Chats/Skills/Décision.md']
  }

  it('are named after their own mark, and read back beside the project and the files', () => {
    expect(turnMarkdown(question, WORDS).split('\n')[0]).toContain(
      '· ✨ [[Chats/Skills/Compte rendu|Compte rendu]], [[Chats/Skills/Décision|Décision]]'
    )
    expect(readChatNote(chatNoteContent(META, [question], WORDS)).turns).toEqual([question])
  })

  it('are never taken for the note the question was about', () => {
    const alone = { ...turn('user', 'Q', 3), skills: ['Chats/Skills/CR.md'] }
    const read = readChatNote(chatNoteContent(META, [alone], WORDS)).turns[0]
    expect(read.skills).toEqual(['Chats/Skills/CR.md'])
    expect(read.context).toBeUndefined()
  })
})

describe('the persona a question was asked of', () => {
  const question = {
    ...turn('user', 'Ce marché est-il régulier ?', 3),
    skills: ['Chats/Skills/CR.md'],
    persona: 'Chats/Personas/Juriste marchés publics.md'
  }

  it('is named after its own mark, read back with the skills, and never taken for the note asked about', () => {
    expect(turnMarkdown(question, WORDS).split('\n')[0]).toContain(
      '· 🎭 [[Chats/Personas/Juriste marchés publics|Juriste marchés publics]]'
    )
    const [read] = readChatNote(chatNoteContent(META, [question], WORDS)).turns
    expect(read).toEqual(question)
    expect(read.context).toBeUndefined()
  })
})

describe('the library a question was asked of', () => {
  it('names the sources its passages came from, documents and notes whole, and reads them back', () => {
    const question = {
      ...turn('user', 'Quand coule-t-on le radier ?', 3),
      files: ['CR.pdf'],
      library: ['Library/_files/Planning GC.pdf', 'Notes/CR réunion 12.md']
    }
    expect(turnMarkdown(question, WORDS).split('\n')[0]).toContain(
      '· 📚 [[Library/_files/Planning GC.pdf|Planning GC.pdf]], [[Notes/CR réunion 12.md|CR réunion 12]]'
    )
    expect(readChatNote(chatNoteContent(META, [question], WORDS)).turns).toEqual([question])
  })

  it('says a question was asked of it even when nothing was found, and is never the note asked about', () => {
    const nothing = { ...turn('user', 'Q', 3), library: [] }
    expect(turnMarkdown(nothing, WORDS).split('\n')[0]).toMatch(/· 📚$/)
    const read = readChatNote(chatNoteContent(META, [nothing], WORDS)).turns[0]
    expect(read.library).toEqual([])
    expect(read.context).toBeUndefined()
    const plain = readChatNote(chatNoteContent(META, [turn('user', 'Q', 3)], WORDS)).turns[0]
    expect(plain.library).toBeUndefined()
  })
})

describe('the model a reply was written by', () => {
  const reply = { ...turn('assistant', 'Réponse.', 4), model: 'qwen3-32b-instruct' }

  it('is named after the reply’s time, and read back', () => {
    expect(turnMarkdown(reply, WORDS).split('\n')[0]).toBe(
      `> [!note] Assistant · ${localStamp(at(4))} · qwen3-32b-instruct`
    )
    expect(readChatNote(chatNoteContent(META, [turn('user', 'Q', 3), reply], WORDS)).turns[1]).toEqual(reply)
  })

  // A reply written before models were recorded, or a title edited by hand, has none.
  it('is left unknown where the title does not say', () => {
    const read = readChatNote(chatNoteContent(META, [turn('assistant', 'Ancienne.', 4)], WORDS)).turns[0]
    expect(read.model).toBeUndefined()
  })
})

describe('the collections a question was asked about', () => {
  // Beside the projects, each behind its own mark, and never taken for one another.
  it('are named after their mark, and read back apart from the projects', () => {
    const question = {
      ...turn('user', 'Qu’est-ce qui est en retard ?', 3),
      projects: ['Work/Génie civil.md'],
      collections: ['Collections/En retard.md', 'Collections/Équipe Anne.md']
    }
    expect(turnMarkdown(question, WORDS).split('\n')[0]).toBe(
      `> [!question] Vous · ${localStamp(at(3))} · 📁 [[Work/Génie civil|Génie civil]] · 🗂 [[Collections/En retard|En retard]], [[Collections/Équipe Anne|Équipe Anne]]`
    )
    expect(readChatNote(chatNoteContent(META, [question], WORDS)).turns).toEqual([question])
  })
})

describe('a question asked again', () => {
  const first = turn('user', 'Résume.', 3)
  const reply = turn('assistant', 'Trop long.', 4)
  const next = turn('user', 'Plus court ?', 5)
  const nextReply = turn('assistant', 'Oui.', 6)
  const again = { ...turn('user', 'Résume en trois lignes.', 7), retakes: first.at }
  const againReply = turn('assistant', 'Trois lignes.', 8)

  it('names the time of the question it takes the place of', () => {
    expect(turnMarkdown(again, WORDS).split('\n')[0]).toBe(
      `> [!question] Vous · ${localStamp(at(7))} · ↻ ${localStamp(at(3))}`
    )
  })

  // The note keeps every exchange; the thread picked up from it is the latest one.
  it('takes the place of that question and of everything after it, once read back', () => {
    const note = chatNoteContent(META, [first, reply, next, nextReply, again, againReply], WORDS)
    expect(note).toContain('Trop long.')
    expect(readChatNote(note).turns).toEqual([again, againReply])
  })

  it('keeps what came before the question it retakes', () => {
    const later = { ...turn('user', 'Plus court, vraiment ?', 7), retakes: next.at }
    const note = chatNoteContent(META, [first, reply, next, nextReply, later], WORDS)
    expect(readChatNote(note).turns).toEqual([first, reply, later])
  })

  // The note's times are to the minute: of two questions asked in one, the later is meant.
  it('takes the place of the later of two questions asked in the same minute', () => {
    const quick = turn('user', 'Et en anglais ?', 3)
    const quickReply = turn('assistant', 'In English.', 3)
    const retake = { ...turn('user', 'Et en allemand ?', 7), retakes: quick.at }
    expect(currentThread([first, reply, quick, quickReply, retake])).toEqual([first, reply, retake])
  })

  it('leaves the thread alone when the question it names is not there', () => {
    const orphan = { ...turn('user', 'Q', 7), retakes: at(1) }
    expect(currentThread([first, reply, orphan])).toEqual([first, reply, orphan])
  })
})
