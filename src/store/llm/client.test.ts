import { describe, expect, it } from 'vitest'
import { DEFAULT_LLM_SETTINGS, type LlmSettings } from '../../types'
import { LlmClient, describeHttp, type HttpTransport } from './client'
import { LlmError } from './protocol'

const settings = (over: Partial<LlmSettings> = {}): LlmSettings => ({
  ...DEFAULT_LLM_SETTINGS,
  enabled: true,
  baseUrl: 'http://sidoniedev.cloud.cnes.fr:8081/v1',
  modelText: 'sidonie/mistral-cnes-latest',
  modelEmbed: 'sidonie/embeddings-cnes-latest',
  ...over
})

/** A gateway that never existed, answering exactly what the documented one would. */
function fake(answer: { status?: number; body: unknown }) {
  const seen: Parameters<HttpTransport>[0][] = []
  const transport: HttpTransport = (request) => {
    seen.push(request)
    return Promise.resolve({
      status: answer.status ?? 200,
      text: typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)
    })
  }
  return { transport, seen }
}

const chatReply = { choices: [{ message: { content: 'Le CNES a été créé en 1961.' } }] }

describe('talking to the gateway', () => {
  it('posts to /chat/completions under the configured root', async () => {
    const { transport, seen } = fake({ body: chatReply })
    const answer = await new LlmClient({ settings: settings(), transport }).chat({
      model: 'sidonie/mistral-cnes-latest',
      messages: [{ role: 'user', content: 'When was the CNES created ?' }]
    })

    expect(answer).toBe('Le CNES a été créé en 1961.')
    expect(seen[0].url).toBe('http://sidoniedev.cloud.cnes.fr:8081/v1/chat/completions')
    expect(seen[0].method).toBe('POST')
    expect(seen[0].headers['Content-Type']).toBe('application/json')
  })

  /** This gateway wants none, and an empty bearer is what a proxy rejects silently. */
  it('sends no Authorization header when there is no key', async () => {
    const { transport, seen } = fake({ body: chatReply })
    await new LlmClient({ settings: settings({ apiKey: '  ' }), transport }).chat({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }]
    })
    expect(seen[0].headers.Authorization).toBeUndefined()
  })

  it('sends one when there is', async () => {
    const { transport, seen } = fake({ body: chatReply })
    await new LlmClient({ settings: settings({ apiKey: 'abc' }), transport }).chat({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }]
    })
    expect(seen[0].headers.Authorization).toBe('Bearer abc')
  })

  it('fills the temperature and the length from the settings', async () => {
    const { transport, seen } = fake({ body: chatReply })
    await new LlmClient({ settings: settings({ temperature: 0, maxTokens: 512 }), transport }).chat({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }]
    })
    expect(JSON.parse(seen[0].body ?? '{}')).toMatchObject({ temperature: 0, max_tokens: 512 })
  })

  it('lets the caller overrule them', async () => {
    const { transport, seen } = fake({ body: chatReply })
    await new LlmClient({ settings: settings({ temperature: 0 }), transport }).chat({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      temperature: 0.7
    })
    expect(JSON.parse(seen[0].body ?? '{}')).toMatchObject({ temperature: 0.7 })
  })

  it('reads a shaped answer back as an object', async () => {
    const { transport } = fake({ body: { choices: [{ message: { content: '{"clear":false}' } }] } })
    const verdict = await new LlmClient({ settings: settings(), transport }).chatJson<{ clear: boolean }>({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      schema: { name: 'v', schema: {} }
    })
    expect(verdict).toEqual({ clear: false })
  })

  it('lists the models with a GET and no body', async () => {
    const { transport, seen } = fake({ body: { data: [{ id: 'sidonie/mistral-cnes-latest' }] } })
    expect(await new LlmClient({ settings: settings(), transport }).models()).toEqual(['sidonie/mistral-cnes-latest'])
    expect(seen[0].method).toBe('GET')
    expect(seen[0].body).toBeUndefined()
  })

  it('embeds a batch, and asks nothing for an empty one', async () => {
    const { transport, seen } = fake({ body: { data: [{ embedding: [0, 1] }] } })
    const client = new LlmClient({ settings: settings(), transport })
    expect(await client.embed(['un texte'])).toEqual([[0, 1]])
    expect(JSON.parse(seen[0].body ?? '{}')).toMatchObject({ model: 'sidonie/embeddings-cnes-latest' })

    expect(await client.embed([])).toEqual([])
    expect(seen).toHaveLength(1)
  })
})

describe('when it goes wrong', () => {
  const ask = (client: LlmClient) => client.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })

  /** Nothing leaves the vault until the reader has turned this on. */
  it('refuses to send anything while it is switched off', async () => {
    const { transport, seen } = fake({ body: chatReply })
    await expect(ask(new LlmClient({ settings: settings({ enabled: false }), transport }))).rejects.toMatchObject({
      kind: 'disabled'
    })
    expect(seen).toHaveLength(0)
  })

  it('refuses just as firmly when no address has been given', async () => {
    const { transport, seen } = fake({ body: chatReply })
    await expect(ask(new LlmClient({ settings: settings({ baseUrl: '' }), transport }))).rejects.toMatchObject({
      kind: 'disabled'
    })
    expect(seen).toHaveLength(0)
  })

  it('reports an HTTP refusal as one, with its status', async () => {
    const { transport } = fake({ status: 404, body: 'no such route' })
    await expect(ask(new LlmClient({ settings: settings(), transport }))).rejects.toMatchObject({
      kind: 'http',
      status: 404
    })
  })

  it('reports an answer that is not JSON as a shape problem, not a network one', async () => {
    const { transport } = fake({ body: '<html>proxy</html>' })
    await expect(ask(new LlmClient({ settings: settings(), transport }))).rejects.toMatchObject({ kind: 'shape' })
  })

  /** The one that matters off the CNES network: it has to say which of the two it is. */
  it('reports a request that never left as unreachable', async () => {
    const transport: HttpTransport = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'))
    const failure = await ask(new LlmClient({ settings: settings(), transport })).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(LlmError)
    expect((failure as LlmError).kind).toBe('unreachable')
    expect((failure as LlmError).message).toContain('ENOTFOUND')
  })

  it('gives up rather than hanging for ever', async () => {
    const transport: HttpTransport = () => new Promise(() => undefined)
    await expect(ask(new LlmClient({ settings: settings({ timeoutSeconds: 1 }), transport }))).rejects.toMatchObject({
      kind: 'timeout'
    })
  }, 10_000)
})

describe('what a failure says to the reader', () => {
  it('names the likely cause rather than the code alone', () => {
    expect(describeHttp(404, '')).toContain('/v1')
    expect(describeHttp(403, '')).toContain('credentials')
    expect(describeHttp(500, 'boom')).toContain('boom')
  })

  it('does not paste a whole error page into a notice', () => {
    expect(describeHttp(500, 'x'.repeat(5000)).length).toBeLessThan(300)
  })
})

/**
 * A gateway in front of models can fail at the proxy rather than at the question:
 * `response_format` is optional, and one that does not implement it answers 400, or 502
 * from whatever it was proxying to. None of that means the question is unanswerable.
 */
describe('asking again when the shape is what failed', () => {
  const SCHEMA = { name: 'verdict', schema: { type: 'object' } }
  const ask = { model: 'm', messages: [{ role: 'system' as const, content: 'Judge this.' }], schema: SCHEMA }

  /** Fails the first call with `status`, then answers plainly. */
  function flaky(status: number, body = 'upstream said no') {
    const seen: Parameters<HttpTransport>[0][] = []
    const transport: HttpTransport = (request) => {
      seen.push(request)
      if (seen.length === 1) return Promise.resolve({ status, text: body })
      return Promise.resolve({
        status: 200,
        text: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })
      })
    }
    return { transport, seen }
  }

  it('asks again without the parameter when the gateway refuses it', async () => {
    const { transport, seen } = flaky(400)
    const answer = await new LlmClient({ settings: settings(), transport }).chatJson<{ ok: boolean }>(ask)

    expect(answer).toEqual({ ok: true })
    expect(seen).toHaveLength(2)
    const second = JSON.parse(seen[1].body ?? '{}') as { response_format?: unknown; messages: { content: string }[] }
    expect(second.response_format).toBeUndefined()
    // The shape moves into the instruction rather than being dropped.
    expect(second.messages[0].content).toContain('JSON Schema')
    expect(second.messages[0].content).toContain('Judge this.')
  })

  it('asks again when the proxy could not reach the model', async () => {
    const { transport, seen } = flaky(502, 'BadGatewayError')
    await new LlmClient({ settings: settings(), transport }).chatJson(ask)
    expect(seen).toHaveLength(2)
  })

  it('asks again when the reply came back as prose', async () => {
    const seen: Parameters<HttpTransport>[0][] = []
    const transport: HttpTransport = (request) => {
      seen.push(request)
      const content = seen.length === 1 ? 'Bien sûr, voici mon avis.' : '{"ok":true}'
      return Promise.resolve({ status: 200, text: JSON.stringify({ choices: [{ message: { content } }] }) })
    }
    expect(await new LlmClient({ settings: settings(), transport }).chatJson(ask)).toEqual({ ok: true })
    expect(seen).toHaveLength(2)
  })

  // Nothing was refused and nothing arrived, so there is nothing to ask differently.
  it('does not ask again when the gateway was never reached', async () => {
    const seen: string[] = []
    const transport: HttpTransport = () => {
      seen.push('tried')
      return Promise.reject(new Error('ECONNREFUSED'))
    }
    await expect(new LlmClient({ settings: settings(), transport }).chatJson(ask)).rejects.toThrow(LlmError)
    expect(seen).toHaveLength(1)
  })

  // A second failure is the gateway being down, and a third attempt only makes the
  // reader wait longer to be told so.
  it('gives up after the second attempt', async () => {
    const seen: string[] = []
    const transport: HttpTransport = () => {
      seen.push('tried')
      return Promise.resolve({ status: 502, text: 'down' })
    }
    await expect(new LlmClient({ settings: settings(), transport }).chatJson(ask)).rejects.toThrow(LlmError)
    expect(seen).toHaveLength(2)
  })
})

describe('what a failure tells the reader to do', () => {
  it('sends them to the model name when the proxy could not reach it', () => {
    expect(describeHttp(502, 'BadGatewayError')).toContain('model name')
    expect(describeHttp(504, '')).toContain('model name')
  })

  it('sends them to the address when there is nothing at it', () => {
    expect(describeHttp(404, '')).toContain('/v1')
  })
})
