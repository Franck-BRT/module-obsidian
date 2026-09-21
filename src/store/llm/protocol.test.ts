import { describe, expect, it } from 'vitest'
import {
  buildChatBody,
  buildEmbeddingBody,
  cosine,
  joinUrl,
  LlmError,
  parseJsonContent,
  readChatContent,
  readEmbeddings,
  readModels
} from './protocol'

describe('the body a chat request sends', () => {
  const base = { model: 'sidonie/mistral-cnes-latest', messages: [{ role: 'user' as const, content: 'Bonjour' }] }

  it('sends what the gateway documents, and nothing it did not ask for', () => {
    expect(buildChatBody({ ...base, maxTokens: 512, temperature: 0.7 })).toEqual({
      model: 'sidonie/mistral-cnes-latest',
      messages: [{ role: 'user', content: 'Bonjour' }],
      max_tokens: 512,
      temperature: 0.7
    })
  })

  /** Zero is a choice, not an absence: it is what makes a quality verdict reproducible. */
  it('sends a temperature of zero rather than leaving it out', () => {
    expect(buildChatBody({ ...base, temperature: 0 })).toMatchObject({ temperature: 0 })
  })

  it('asks for a shape when one is wanted', () => {
    const body = buildChatBody({ ...base, schema: { name: 'verdict', schema: { type: 'object' } } })
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'verdict', schema: { type: 'object' } }
    })
  })

  /**
   * `extra_body` is the Python client's own escape hatch: it merges those keys into the
   * body before sending. Copied literally over raw HTTP it is a field the server ignores,
   * and the reasoning mode would look enabled while doing nothing at all.
   */
  it('puts the reasoning switch at the top level, not inside extra_body', () => {
    const body = buildChatBody({ ...base, thinking: true })
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
    expect(body.extra_body).toBeUndefined()
  })

  it('leaves the reasoning switch out entirely when it is not wanted', () => {
    expect(buildChatBody(base).chat_template_kwargs).toBeUndefined()
  })

  it('embeds many texts in one call', () => {
    expect(buildEmbeddingBody('sidonie/embeddings-cnes-latest', ['a', 'b'])).toEqual({
      model: 'sidonie/embeddings-cnes-latest',
      input: ['a', 'b']
    })
  })
})

describe('building the address', () => {
  it('joins however the reader typed the slash', () => {
    expect(joinUrl('http://host:8081/v1', 'models')).toBe('http://host:8081/v1/models')
    expect(joinUrl('http://host:8081/v1/', '/models')).toBe('http://host:8081/v1/models')
    expect(joinUrl('http://host:8081/v1///', 'chat/completions')).toBe('http://host:8081/v1/chat/completions')
  })
})

describe('reading what came back', () => {
  it('takes the text of the first choice', () => {
    expect(readChatContent({ choices: [{ message: { content: 'Le CNES a été créé en 1961.' } }] })).toBe(
      'Le CNES a été créé en 1961.'
    )
  })

  /** An empty answer shows up much later as a requirement translated to nothing. */
  it('refuses an answer that is the right shape and says nothing', () => {
    expect(() => readChatContent({ choices: [{ message: { content: '   ' } }] })).toThrow(LlmError)
    expect(() => readChatContent({ choices: [] })).toThrow(LlmError)
    expect(() => readChatContent({})).toThrow(LlmError)
    expect(() => readChatContent(null)).toThrow(LlmError)
  })

  it('reads a batch of embeddings', () => {
    expect(readEmbeddings({ data: [{ embedding: [0, 1] }, { embedding: [1, 0] }] })).toEqual([
      [0, 1],
      [1, 0]
    ])
  })

  it('refuses an embedding that is not numbers', () => {
    expect(() => readEmbeddings({ data: [{ embedding: ['x'] }] })).toThrow(LlmError)
    expect(() => readEmbeddings({ data: [] })).toThrow(LlmError)
  })

  it('lists the models, ignoring rows that name none', () => {
    expect(readModels({ data: [{ id: 'sidonie/mistral-cnes-latest' }, {}, { id: '' }] })).toEqual([
      'sidonie/mistral-cnes-latest'
    ])
  })
})

describe('getting the JSON out of a reply', () => {
  it('reads it straight when the gateway honoured the schema', () => {
    expect(parseJsonContent<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true })
  })

  /** The fallback is for the day the optional parameter is not honoured. */
  it('reads it out of a fenced block', () => {
    expect(parseJsonContent('```json\n{"ok":true}\n```')).toEqual({ ok: true })
  })

  it('reads it out of a sentence that wraps it', () => {
    expect(parseJsonContent('Voici le résultat : {"ok":true} — voilà.')).toEqual({ ok: true })
  })

  it('says so when there is no JSON at all rather than guessing', () => {
    expect(() => parseJsonContent('Je ne peux pas répondre.')).toThrow(LlmError)
  })
})

describe('how alike two texts are', () => {
  it('is one for the same vector and zero for a right angle', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('ignores length, which is what makes it useful across languages', () => {
    expect(cosine([1, 1], [10, 10])).toBeCloseTo(1)
  })

  it('answers zero rather than NaN for the degenerate cases', () => {
    expect(cosine([], [])).toBe(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
    expect(cosine([1, 2], [1, 2, 3])).toBe(0)
  })
})
