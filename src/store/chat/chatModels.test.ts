import { describe, expect, it } from 'vitest'
import { chatModel, chatModels } from './chatModels'

describe('chatModel', () => {
  it('is the chat’s own choice, or the text model of the settings', () => {
    expect(chatModel('mistral-small', 'qwen3-32b')).toBe('mistral-small')
    expect(chatModel('  ', ' qwen3-32b ')).toBe('qwen3-32b')
    expect(chatModel('', '')).toBe('')
  })
})

describe('chatModels', () => {
  // What a gateway lists is everything it serves; the chat is offered what can chat.
  it('leaves out the models that cannot hold a conversation, and lists each once, in order', () => {
    expect(
      chatModels([
        'qwen3-32b-instruct',
        'bge-m3-embedding',
        'nomic-embed-text',
        'mistral-small',
        'bge-reranker-v2',
        'whisper-large-v3',
        'kokoro-tts',
        'qwen3-32b-instruct',
        ' '
      ])
    ).toEqual(['mistral-small', 'qwen3-32b-instruct'])
  })
})
