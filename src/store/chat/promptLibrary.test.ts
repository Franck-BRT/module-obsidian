import { describe, expect, it } from 'vitest'
import {
  asChatPrompt,
  groupPrompts,
  matchesPrompt,
  promptCategories,
  promptFileName,
  promptNoteContent,
  readPromptNote,
  type PromptNote
} from './promptLibrary'

const CONTENT = [
  '---',
  'pm-prompt: true',
  'about: projet',
  'category: Comptes rendus',
  'favorite: true',
  '---',
  '',
  'Rédige le compte rendu depuis le {Depuis le:date}.',
  '%% une remarque pour moi %%',
  'Sois bref.'
].join('\n')

describe('readPromptNote', () => {
  it('reads the question, what it is about, its category and whether it is a favourite', () => {
    const fm = { 'pm-prompt': true, about: 'projet', category: 'Comptes rendus', favorite: true }
    expect(readPromptNote('P/CR.md', 'CR', fm, CONTENT)).toEqual({
      path: 'P/CR.md',
      name: 'CR',
      question: 'Rédige le compte rendu depuis le {Depuis le:date}.\n\nSois bref.',
      scope: 'project',
      category: 'Comptes rendus',
      description: '',
      favorite: true
    })
  })

  it('takes French property names, and a question about anything when none is said', () => {
    const fm = { 'pm-prompt': true, nom: 'Résumé', catégorie: 'Lecture', favori: true }
    expect(readPromptNote('a.md', 'a', fm, '---\npm-prompt: true\n---\nRésume.')).toMatchObject({
      name: 'Résumé',
      scope: 'any',
      category: 'Lecture',
      favorite: true
    })
  })

  it('is not a prompt without its property, nor with nothing to ask', () => {
    expect(readPromptNote('a.md', 'a', { tags: ['x'] }, 'Texte')).toBeNull()
    expect(readPromptNote('a.md', 'a', { 'pm-prompt': true }, '---\npm-prompt: true\n---\n  ')).toBeNull()
  })
})

describe('promptNoteContent', () => {
  it('writes what is said, and reads back the same', () => {
    const content = promptNoteContent({
      scope: 'requirements',
      scopeWord: 'exigences',
      category: 'Qualité',
      description: 'Relecture',
      favorite: false,
      question: 'Relis ces exigences.\n'
    })
    expect(content).toBe(
      '---\npm-prompt: true\nabout: exigences\ncategory: Qualité\ndescription: Relecture\n---\n\nRelis ces exigences.\n'
    )
    expect(
      readPromptNote('q.md', 'Q', { 'pm-prompt': true, about: 'exigences', category: 'Qualité' }, content)
    ).toMatchObject({ scope: 'requirements', question: 'Relis ces exigences.' })
  })
})

const prompt = (name: string, category: string, favorite = false, question = 'Q'): PromptNote => ({
  path: `${name}.md`,
  name,
  question,
  scope: 'any',
  category,
  description: '',
  favorite
})

describe('finding and ordering prompts', () => {
  it('finds a prompt by every word searched, accents and case aside', () => {
    const one = prompt('Compte rendu', 'Réunions', false, 'Rédige le CR')
    expect(matchesPrompt(one, 'reunions redige')).toBe(true)
    expect(matchesPrompt(one, 'reunions budget')).toBe(false)
    expect(matchesPrompt(one, '  ')).toBe(true)
  })

  it('groups by category, favourites first, those of no category last', () => {
    const groups = groupPrompts([
      prompt('b', 'Zèbre'),
      prompt('a', ''),
      prompt('c', 'Achats'),
      prompt('d', 'zèbre', true)
    ])
    expect(groups.map((group) => [group.category, group.prompts.map((one) => one.name)])).toEqual([
      ['Achats', ['c']],
      ['Zèbre', ['d', 'b']],
      ['', ['a']]
    ])
    expect(promptCategories([prompt('b', 'Zèbre'), prompt('d', 'zèbre'), prompt('c', 'Achats')])).toEqual([
      'Achats',
      'Zèbre'
    ])
  })

  it('makes the chat’s question, and a file name from a name', () => {
    expect(asChatPrompt(prompt('Point', 'X', false, 'Où en est-on ?'))).toEqual({
      label: 'Point',
      question: 'Où en est-on ?',
      scope: 'any',
      own: true
    })
    expect(promptFileName('CR / point: hebdo?')).toBe('CR point hebdo')
  })
})
