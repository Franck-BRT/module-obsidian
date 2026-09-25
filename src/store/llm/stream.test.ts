import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LLM_SETTINGS, type LlmSettings } from '../../types'
import { forgetUnstreamable, LlmClient, type HttpTransport, type StreamTransport } from './client'
import { LlmError, readDelta, readSseEvents } from './protocol'

const settings = (over: Partial<LlmSettings> = {}): LlmSettings => ({
  ...DEFAULT_LLM_SETTINGS,
  enabled: true,
  baseUrl: 'http://passerelle.interne:8081/v1',
  modelText: 'qwen3',
  timeoutSeconds: 5,
  ...over
})

const encoder = new TextEncoder()
const event = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
const REQUEST = { model: 'qwen3', messages: [{ role: 'user' as const, content: 'Bonjour' }] }

/**
 * A gateway streaming a reply, cut into pieces wherever the test says — including in the
 * middle of an event and in the middle of a letter written in two bytes.
 */
function streaming(pieces: (string | Uint8Array)[], over: { status?: number; contentType?: string } = {}) {
  const seen: Parameters<StreamTransport>[0][] = []
  const transport: StreamTransport = (request) => {
    seen.push(request)
    async function* chunks(): AsyncIterable<Uint8Array> {
      for (const piece of pieces) {
        if (request.signal.aborted) throw new DOMException('aborted', 'AbortError')
        yield typeof piece === 'string' ? encoder.encode(piece) : piece
        await Promise.resolve()
      }
    }
    return Promise.resolve({
      status: over.status ?? 200,
      contentType: over.contentType ?? 'text/event-stream',
      chunks: chunks()
    })
  }
  return { transport, seen }
}

/** The ordinary request, for when the stream cannot be opened. */
function whole(content: string) {
  const calls: string[] = []
  const transport: HttpTransport = (request) => {
    calls.push(request.url)
    return Promise.resolve({ status: 200, text: JSON.stringify({ choices: [{ message: { content } }] }) })
  }
  return { transport, calls }
}

beforeEach(() => forgetUnstreamable())

describe('readSseEvents', () => {
  it('reads the complete events and hands back the rest', () => {
    expect(readSseEvents('data: a\n\ndata: b\n\ndata: c')).toEqual({ events: ['a', 'b'], rest: 'data: c' })
  })

  it('joins an event’s data lines and ignores its other fields', () => {
    expect(readSseEvents(': ping\r\nevent: x\r\ndata: un\r\ndata: deux\r\n\r\n').events).toEqual(['un\ndeux'])
  })
})

describe('readDelta', () => {
  it('is the words an event adds, or nothing', () => {
    expect(readDelta({ choices: [{ delta: { content: 'mot' } }] })).toBe('mot')
    expect(readDelta({ choices: [{ delta: { role: 'assistant' } }] })).toBe('')
  })

  it('fails on an event that carries an error', () => {
    expect(() => readDelta({ error: { message: 'Le modèle a planté' } })).toThrow('Le modèle a planté')
  })
})

describe('chatStream', () => {
  it('hands over the reply as it grows, and asks for a stream', async () => {
    const { transport, seen } = streaming([event('Le '), event('CNES '), event('a 60 ans.'), 'data: [DONE]\n\n'])
    const grown: string[] = []
    const outcome = await new LlmClient({ settings: settings(), streamTransport: transport }).chatStream(
      REQUEST,
      (text) => grown.push(text)
    )
    expect(grown).toEqual(['Le ', 'Le CNES ', 'Le CNES a 60 ans.'])
    expect(outcome).toEqual({ text: 'Le CNES a 60 ans.', stopped: false })
    expect(seen[0].url).toBe('http://passerelle.interne:8081/v1/chat/completions')
    expect(JSON.parse(seen[0].body)).toMatchObject({ model: 'qwen3', stream: true })
  })

  // The network cuts where it cuts: through an event, and through an "é".
  it('reads a reply cut anywhere, even through a letter', async () => {
    const bytes = encoder.encode(event('Été'))
    const letter = bytes.indexOf(0xc3) + 1
    const { transport } = streaming([
      bytes.slice(0, 10),
      bytes.slice(10, letter),
      bytes.slice(letter),
      'data: [DONE]\n\n'
    ])
    const outcome = await new LlmClient({ settings: settings(), streamTransport: transport }).chatStream(
      REQUEST,
      () => {}
    )
    expect(outcome.text).toBe('Été')
  })

  // The gateway does not allow the page's origin: the ordinary request, and remembered.
  it('asks the ordinary way when the stream cannot be opened, and from then on', async () => {
    let tries = 0
    const blocked: StreamTransport = () => {
      tries += 1
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    const { transport, calls } = whole('Réponse entière.')
    const onFallback = vi.fn<() => void>()
    const client = new LlmClient({ settings: settings(), transport, streamTransport: blocked })
    const shown: string[] = []
    expect(await client.chatStream(REQUEST, (text) => shown.push(text), { onFallback })).toEqual({
      text: 'Réponse entière.',
      stopped: false
    })
    expect(shown).toEqual(['Réponse entière.'])
    expect(onFallback).toHaveBeenCalledOnce()
    await client.chatStream(REQUEST, () => {}, { onFallback })
    expect(tries).toBe(1)
    expect(calls).toHaveLength(2)
    expect(onFallback).toHaveBeenCalledOnce()
  })

  // Not reached at all, either way: the gateway is down, and the reader is told why.
  it('fails with the reason when neither way gets through', async () => {
    const blocked: StreamTransport = () => Promise.reject(new TypeError('Failed to fetch'))
    const down: HttpTransport = () => Promise.resolve({ status: 502, text: 'upstream down' })
    const client = new LlmClient({ settings: settings(), transport: down, streamTransport: blocked })
    await expect(client.chatStream(REQUEST, () => {})).rejects.toThrow(/502/)
  })

  it('says what the gateway said when it refuses the request', async () => {
    const { transport } = streaming(['{"detail":"model not found"}'], { status: 404, contentType: 'application/json' })
    await expect(
      new LlmClient({ settings: settings(), streamTransport: transport }).chatStream(REQUEST, () => {})
    ).rejects.toThrow(/404.*model not found/)
  })

  it('reads a reply the gateway sent in one piece after all', async () => {
    const { transport } = streaming([JSON.stringify({ choices: [{ message: { content: 'Entier.' } }] })], {
      contentType: 'application/json'
    })
    const outcome = await new LlmClient({ settings: settings(), streamTransport: transport }).chatStream(
      REQUEST,
      () => {}
    )
    expect(outcome.text).toBe('Entier.')
  })

  // Stopped by the reader: what had arrived is theirs to keep.
  it('returns what had arrived when the reader stops it', async () => {
    const controller = new AbortController()
    const { transport } = streaming([event('Début'), event(' de réponse'), event(' jamais lue')])
    const outcome = await new LlmClient({ settings: settings(), streamTransport: transport }).chatStream(
      REQUEST,
      (text) => {
        if (text === 'Début de réponse') controller.abort()
      },
      { signal: controller.signal }
    )
    expect(outcome).toEqual({ text: 'Début de réponse', stopped: true })
  })

  it('fails on a stream that ends having said nothing', async () => {
    const { transport } = streaming(['data: [DONE]\n\n'])
    await expect(
      new LlmClient({ settings: settings(), streamTransport: transport }).chatStream(REQUEST, () => {})
    ).rejects.toBeInstanceOf(LlmError)
  })

  it('fails when the gateway breaks off in the middle of a reply', async () => {
    const { transport } = streaming([
      event('Début'),
      `data: ${JSON.stringify({ error: { message: 'Mémoire épuisée' } })}\n\n`
    ])
    await expect(
      new LlmClient({ settings: settings(), streamTransport: transport }).chatStream(REQUEST, () => {})
    ).rejects.toThrow('Mémoire épuisée')
  })

  // A reply that stops coming is a gateway that stopped sending.
  it('fails when the stream falls silent for longer than the timeout', async () => {
    vi.useFakeTimers()
    try {
      const silent: StreamTransport = (request) =>
        Promise.resolve({
          status: 200,
          contentType: 'text/event-stream',
          chunks: (async function* () {
            yield encoder.encode(event('Début'))
            await new Promise((_resolve, reject) =>
              request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
            )
          })()
        })
      const pending = new LlmClient({ settings: settings({ timeoutSeconds: 2 }), streamTransport: silent }).chatStream(
        REQUEST,
        () => {}
      )
      // Caught as it happens, so the rejection is not left unhandled while time is moved on.
      const settled = (async (): Promise<unknown> => {
        try {
          await pending
          return null
        } catch (error) {
          return error
        }
      })()
      await vi.advanceTimersByTimeAsync(2500)
      const error = await settled
      expect(error).toBeInstanceOf(LlmError)
      expect((error as LlmError).message).toMatch(/No answer after 2s/)
    } finally {
      vi.useRealTimers()
    }
  })

  // Silence is measured from the last piece, not from the question: a long reply that
  // keeps coming is not a gateway that stopped.
  it('lets a long reply run past the timeout as long as it keeps coming', async () => {
    vi.useFakeTimers()
    try {
      // Like fetch, the body stops with an abort error once the request is aborted.
      const slow: StreamTransport = (request) =>
        Promise.resolve({
          status: 200,
          contentType: 'text/event-stream',
          chunks: (async function* () {
            for (const word of ['Un ', 'deux ', 'trois ', 'quatre.']) {
              await new Promise((resolve) => window.setTimeout(resolve, 1500))
              if (request.signal.aborted) throw new DOMException('aborted', 'AbortError')
              yield encoder.encode(event(word))
            }
            yield encoder.encode('data: [DONE]\n\n')
          })()
        })
      const pending = new LlmClient({ settings: settings({ timeoutSeconds: 2 }), streamTransport: slow }).chatStream(
        REQUEST,
        () => {}
      )
      await vi.advanceTimersByTimeAsync(7000)
      expect(await pending).toEqual({ text: 'Un deux trois quatre.', stopped: false })
    } finally {
      vi.useRealTimers()
    }
  })

  // [DONE] ends the reply, whether or not the gateway then closes the connection.
  it('ends the reply at [DONE] even when the gateway keeps the connection open', async () => {
    vi.useFakeTimers()
    try {
      const lingering: StreamTransport = (request) =>
        Promise.resolve({
          status: 200,
          contentType: 'text/event-stream',
          chunks: (async function* () {
            yield encoder.encode(`${event('Fini.')}data: [DONE]\n\n`)
            await new Promise((_resolve, reject) =>
              request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
            )
          })()
        })
      const pending = new LlmClient({
        settings: settings({ timeoutSeconds: 2 }),
        streamTransport: lingering
      }).chatStream(REQUEST, () => {})
      await vi.advanceTimersByTimeAsync(3000)
      expect(await pending).toEqual({ text: 'Fini.', stopped: false })
    } finally {
      vi.useRealTimers()
    }
  })
})
