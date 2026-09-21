import { requestUrl } from 'obsidian'
import type { LlmSettings } from '../../types'
import {
  buildChatBody,
  buildEmbeddingBody,
  joinUrl,
  LlmError,
  parseJsonContent,
  readChatContent,
  readEmbeddings,
  readModels,
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

export interface LlmClientOpts {
  settings: LlmSettings
  transport?: HttpTransport
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

  constructor(opts: LlmClientOpts) {
    this.settings = opts.settings
    this.transport = opts.transport ?? obsidianTransport
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

  /** The same, asked for in a shape, and read back defensively if the shape is ignored. */
  async chatJson<T>(request: ChatRequest & { schema: { name: string; schema: unknown } }): Promise<T> {
    return parseJsonContent<T>(await this.chat(request))
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
  if (status >= 500) return `The gateway failed (${status}).${detail ? ` — ${detail}` : ''}`
  return `Unexpected status ${status}.${detail ? ` — ${detail}` : ''}`
}

function reachFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Could not reach the gateway. ${detail}`
}
