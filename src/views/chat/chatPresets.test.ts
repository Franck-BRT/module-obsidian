import { describe, expect, it } from 'vitest'
import { parsePrompts } from '../../store/chat/chatPrompts'
import { builtinPrompts, promptLine } from './chatPresets'

describe('the shipped questions', () => {
  // Copied into the reader's list to be adjusted, each must read back as itself: same
  // name, same question, offered for the same thing.
  it('read back from the settings list exactly as they were', () => {
    const shipped = builtinPrompts()
    const copied = parsePrompts(shipped.map(promptLine).join('\n'))
    expect(copied).toEqual(shipped.map((prompt) => ({ ...prompt, own: true })))
  })

  it('offer something for a project, requirements and a note', () => {
    const scopes = new Set(builtinPrompts().map((prompt) => prompt.scope))
    expect([...scopes].sort()).toEqual(['note', 'project', 'requirements'])
  })
})
