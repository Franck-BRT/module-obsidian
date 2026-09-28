import { describe, expect, it } from 'vitest'
import { parsePrompts } from '../../store/chat/chatPrompts'
import { promptParams } from '../../store/chat/promptParams'
import { builtinPrompts, promptLine } from './chatPresets'

describe('the shipped questions', () => {
  // Copied into the reader's list to be adjusted, each must read back as itself: same
  // name, same question, offered for the same thing.
  it('read back from the settings list exactly as they were', () => {
    const shipped = builtinPrompts()
    const copied = parsePrompts(shipped.map(promptLine).join('\n'))
    expect(copied).toEqual(shipped.map((prompt) => ({ ...prompt, own: true })))
  })

  it('offer something for a project, requirements, a note, a file and a planning', () => {
    const scopes = new Set(builtinPrompts().map((prompt) => prompt.scope))
    expect([...scopes].sort()).toEqual(['file', 'note', 'planning', 'project', 'requirements', 'selection'])
  })
})

describe('the shipped questions with blanks', () => {
  // A date, a person, a language: each asked for with the field that fits it.
  it('ask for what they leave blank, with the field that fits', () => {
    const kinds = builtinPrompts()
      .map((prompt) => promptParams(prompt.question).map((param) => param.kind))
      .filter((found) => found.length)
    expect(kinds).toEqual([['language'], ['date'], ['person'], ['language']])
  })
})
