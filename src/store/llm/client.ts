import { requestUrl } from 'obsidian'
import type { LlmSettings } from '../../types'
import {
  buildChatBody,
  buildEmbeddingBody,
  joinUrl,
  LlmError,
  parseJsonContent,
  readChatContent,
  readDelta,
  readEmbeddings,
  readModels,
  readSseEvents,
  type ChatMessage,
  type ChatRequest
} from './protocol'

/**
 * How a request actually leaves. Injected, so every path above it is testable without a
 * network — which is the only way this could be written at all, the service it was
 * written for answering from inside a network this machine is not on.
 */
export interface HttpTransport {
  (request: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{
    status: number
    text: string
  }>
}

/**
 * Obsidian's own HTTP, not `fetch`.
 *
 * A plugin's `fetch` is subject to the page's origin rules and a call to a plain-HTTP
 * host on another port is exactly what they stop. `requestUrl` goes through the desktop
 * app instead, which is the difference between this working and not.
 */
export const obsidianTransport: HttpTransport = async (request) => {
  const response = await requestUrl({
    url: request.url,
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    // Read the status rather than being thrown at: a 400 carries the reason in its body.
    throw: false
  })
  return { status: response.status, text: response.text }
}

/**
 * A request whose reply is read as it arrives: a status, what the body is, and the body
 * piece by piece. Rejects, without a status, when the request could not be made at all.
 */
export interface StreamTransport {
  (request: {
    url: string
    method: string
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  }): Promise<{ status: number; contentType: string; chunks: AsyncIterable<Uint8Array> }>
}

/**
 * `fetch`, because it is the one way to read a reply while it is being written:
 * `requestUrl` hands it over whole. Subject to the page's origin rules, which a gateway
 * that does not allow other origins stops — which is why a stream that cannot be opened
 * is followed by the ordinary request rather than by an error.
 */
export const fetchStreamTransport: StreamTransport = async (request) => {
  // The one request in the plugin that does not go through `requestUrl`: it hands the
  // reply over whole, and a reply shown as it is written has to be read as a stream.
  const response = await window.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal
  })
  const body = response.body
  async function* chunks(): AsyncIterable<Uint8Array> {
    if (!body) return
    const reader = body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    } finally {
      reader.releaseLock()
    }
  }
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', chunks: chunks() }
}

/**
 * Gateways a stream could not be opened to, while the ordinary request got through: this
 * session asks them the ordinary way from then on, rather than failing first every time.
 */
const unstreamable = new Set<string>()

/** Forgets which gateways could not stream: a new session's worth of chances. */
export function forgetUnstreamable(): void {
  unstreamable.clear()
}

export interface StreamOutcome {
  /** The reply as far as it went. */
  text: string
  /** Stopped by the reader before the model had finished. */
  stopped: boolean
}

export interface StreamOptions {
  signal?: AbortSignal
  /** Told once, when the gateway turns out not to allow a stream and the reply comes whole. */
  onFallback?: () => void
}

export interface LlmClientOpts {
  settings: LlmSettings
  transport?: HttpTransport
  /** How a streamed reply is read; `fetch` unless a test says otherwise. */
  streamTransport?: StreamTransport
  /** Injected in tests; the real one is the clock. */
  now?: () => number
}

/**
 * The gateway, as the rest of the plugin talks to it.
 *
 * Three verbs, because three are what a requirements library needs: say something, say
 * something in a shape, and turn text into a vector. Everything else the gateway can do
 * is reachable through the first two.
 */
export class LlmClient {
  private readonly settings: LlmSettings
  private readonly transport: HttpTransport
  private readonly streamTransport: StreamTransport

  constructor(opts: LlmClientOpts) {
    this.settings = opts.settings
    this.transport = opts.transport ?? obsidianTransport
    this.streamTransport = opts.streamTransport ?? fetchStreamTransport
  }

  get configured(): boolean {
    return this.settings.enabled && this.settings.baseUrl.trim().length > 0
  }

  /** The models the gateway offers. Also the honest connection test. */
  async models(): Promise<string[]> {
    return readModels(await this.send('models', 'GET'))
  }

  async chat(request: ChatRequest): Promise<string> {
    return readChatContent(await this.send('chat/completions', 'POST', buildChatBody(this.withDefaults(request))))
  }

  /**
   * A reply read as it is written, handed to `onText` whole-so-far each time it grows.
   *
   * Where the stream cannot be opened — the gateway does not allow the page's origin —
   * the question is asked the ordinary way and the reply given in one piece; if that gets
   * through, the gateway is remembered as one to ask that way. Where the gateway ignores
   * the request for a stream and answers in one piece, that piece is read.
   *
   * Stopped by the reader, it returns what had arrived. Silent for longer than the
   * timeout, it fails: a reply that stops coming is a gateway that stopped sending.
   */
  async chatStream(
    request: ChatRequest,
    onText: (text: string) => void,
    options: StreamOptions = {}
  ): Promise<StreamOutcome> {
    if (!this.configured) throw new LlmError('disabled', 'No gateway is configured.')
    const whole = async (): Promise<StreamOutcome> => {
      const text = await this.chat(request)
      onText(text)
      return { text, stopped: false }
    }
    const base = this.settings.baseUrl.trim()
    if (unstreamable.has(base)) return whole()

    const controller = new AbortController()
    const stop = (): void => controller.abort()
    options.signal?.addEventListener('abort', stop)
    const seconds = Math.max(1, this.settings.timeoutSeconds)
    let silent = false
    let timer: number | undefined
    const wait = (): void => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        silent = true
        controller.abort()
      }, seconds * 1000)
    }

    let text = ''
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
      const key = this.settings.apiKey.trim()
      if (key) headers.Authorization = `Bearer ${key}`
      wait()
      let response: Awaited<ReturnType<StreamTransport>>
      try {
        response = await this.streamTransport({
          url: joinUrl(base, 'chat/completions'),
          method: 'POST',
          headers,
          body: JSON.stringify({ ...buildChatBody(this.withDefaults(request)), stream: true }),
          signal: controller.signal
        })
      } catch {
        if (options.signal?.aborted) return { text: '', stopped: true }
        if (silent) throw new LlmError('timeout', `No answer after ${seconds}s.`)
        // Not reached at all: the page's rules, most likely. Asked the ordinary way, which
        // either works — and the gateway is one not to stream from — or fails with the
        // reason a reader can act on.
        const outcome = await whole()
        unstreamable.add(base)
        options.onFallback?.()
        return outcome
      }

      const decoder = new TextDecoder()
      if (response.status < 200 || response.status >= 300) {
        let body = ''
        for await (const chunk of response.chunks) body += decoder.decode(chunk, { stream: true })
        throw new LlmError('http', describeHttp(response.status, body), response.status)
      }
      if (!/event-stream/i.test(response.contentType)) {
        // A gateway that answered in one piece after all.
        let body = ''
        for await (const chunk of response.chunks) body += decoder.decode(chunk, { stream: true })
        let payload: unknown
        try {
          payload = JSON.parse(body)
        } catch {
          throw new LlmError('shape', 'The gateway answered with something that is not JSON.')
        }
        text = readChatContent(payload)
        onText(text)
        return { text, stopped: false }
      }

      let buffer = ''
      for await (const chunk of response.chunks) {
        wait()
        // Decoded as a stream: a letter written in two bytes can arrive in two pieces.
        const read = readSseEvents(buffer + decoder.decode(chunk, { stream: true }))
        buffer = read.rest
        for (const event of read.events) {
          if (event.trim() === '[DONE]') return this.finished(text)
          let payload: unknown
          try {
            payload = JSON.parse(event)
          } catch {
            continue
          }
          const delta = readDelta(payload)
          if (delta) {
            text += delta
            onText(text)
          }
        }
      }
      return this.finished(text)
    } catch (error) {
      if (options.signal?.aborted) return { text, stopped: true }
      if (silent) throw new LlmError('timeout', `No answer after ${seconds}s.`)
      throw error
    } finally {
      if (timer !== undefined) window.clearTimeout(timer)
      options.signal?.removeEventListener('abort', stop)
    }
  }

  /** A stream that ended having said nothing is a failure, as an empty reply is. */
  private finished(text: string): StreamOutcome {
    if (!text.trim()) throw new LlmError('shape', 'The reply carried no text.')
    return { text, stopped: false }
  }

  /**
   * The same, asked for in a shape — and asked again in words if the shape is the problem.
   *
   * `response_format` is an optional parameter, and a gateway in front of a model that
   * does not implement it fails in whatever way that gateway fails: a 400 from a strict
   * one, a 502 from a proxy whose upstream refused. None of those mean the question could
   * not be answered; they mean it could not be asked that way. So it is asked again
   * without the parameter, with the shape written into the instruction instead, and the
   * reply is read out of whatever prose comes back.
   *
   * Once. A second failure is the gateway or the model being down, and asking a third
   * time only makes the reader wait longer to be told so.
   */
  async chatJson<T>(request: ChatRequest & { schema: { name: string; schema: unknown } }): Promise<T> {
    try {
      return parseJsonContent<T>(await this.chat(request))
    } catch (error) {
      if (!worthRetryingWithoutSchema(error)) throw error
      const { schema, ...plain } = request
      return parseJsonContent<T>(await this.chat({ ...plain, messages: askForJson(request.messages, schema.schema) }))
    }
  }

  async embed(input: string[], model = this.settings.modelEmbed): Promise<number[][]> {
    if (!input.length) return []
    return readEmbeddings(await this.send('embeddings', 'POST', buildEmbeddingBody(model, input)))
  }

  /**
   * Temperature and length come from the settings unless the caller insists.
   *
   * Zero by default: two runs over one requirement must reach the same verdict, or the
   * check is an opinion rather than a control.
   */
  private withDefaults(request: ChatRequest): ChatRequest {
    return {
      ...request,
      temperature: request.temperature ?? this.settings.temperature,
      maxTokens: request.maxTokens ?? this.settings.maxTokens
    }
  }

  private async send(path: string, method: string, body?: Record<string, unknown>): Promise<unknown> {
    if (!this.configured) throw new LlmError('disabled', 'No gateway is configured.')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    // Sent only when there is one: this gateway wants no key, and an empty bearer token
    // is the kind of thing a proxy in the middle rejects for reasons nobody can see.
    const key = this.settings.apiKey.trim()
    if (key) headers.Authorization = `Bearer ${key}`

    const response = await this.withTimeout(
      this.transport({
        url: joinUrl(this.settings.baseUrl, path),
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    )

    if (response.status < 200 || response.status >= 300) {
      throw new LlmError('http', describeHttp(response.status, response.text), response.status)
    }
    try {
      return JSON.parse(response.text) as unknown
    } catch {
      throw new LlmError('shape', 'The gateway answered with something that is not JSON.')
    }
  }

  /**
   * A call that never answers is worse than one that fails: the reader is left with a
   * spinner and no way to tell a slow model from a wrong address.
   */
  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    const seconds = Math.max(1, this.settings.timeoutSeconds)
    let timer: number | undefined
    const alarm = new Promise<never>((_resolve, reject) => {
      timer = window.setTimeout(() => reject(new LlmError('timeout', `No answer after ${seconds}s.`)), seconds * 1000)
    })
    try {
      return await Promise.race([work, alarm])
    } catch (error) {
      // A request that never left looks like a network error, not an HTTP one.
      if (error instanceof LlmError) throw error
      throw new LlmError('unreachable', reachFailure(error))
    } finally {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }
}

/** What an HTTP failure means, in a sentence a reader can act on. */
export function describeHttp(status: number, body: string): string {
  const detail = body.trim().slice(0, 200)
  if (status === 404) return `Not found (404). Check the address ends in /v1.${detail ? ` — ${detail}` : ''}`
  if (status === 401 || status === 403) {
    return `Refused (${status}). The gateway wants credentials this one is not sending.`
  }
  if (status === 422 || status === 400) return `Rejected (${status}).${detail ? ` — ${detail}` : ''}`
  // A gateway in front of models says something different with these two: it was reached,
  // and what it was asked to reach was not. Which is the reader's cue to check the model
  // name rather than the address.
  if (status === 502 || status === 504) {
    return `The gateway could not reach the model (${status}). Check the model name.${detail ? ` — ${detail}` : ''}`
  }
  if (status >= 500) return `The gateway failed (${status}).${detail ? ` — ${detail}` : ''}`
  return `Unexpected status ${status}.${detail ? ` — ${detail}` : ''}`
}

/**
 * Whether the shape of the request, rather than the question, is what failed.
 *
 * A refusal the gateway explains, a failure at whatever it was proxying to, or a reply
 * that came back as prose: all three are answered by asking again in plain words. A
 * timeout or an unreachable host is not — nothing was refused, nothing arrived.
 */
function worthRetryingWithoutSchema(error: unknown): boolean {
  if (!(error instanceof LlmError)) return false
  if (error.kind === 'shape') return true
  if (error.kind !== 'http') return false
  return error.status === 400 || error.status === 422 || error.status === 500 || error.status === 502
}

/** The shape written into the instruction, for a gateway that will not take it as a parameter. */
function askForJson(messages: ChatMessage[], schema: unknown): ChatMessage[] {
  const instruction = [
    'Answer with JSON and nothing else: no prose before it, no prose after it, no code fence.',
    `It must match this JSON Schema: ${JSON.stringify(schema)}`
  ].join('\n')
  const first = messages[0]
  if (first?.role === 'system') {
    return [{ role: 'system', content: `${first.content}\n${instruction}` }, ...messages.slice(1)]
  }
  return [{ role: 'system', content: instruction }, ...messages]
}

function reachFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Could not reach the gateway. ${detail}`
}
