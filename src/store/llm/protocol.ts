/**
 * The OpenAI-compatible wire protocol, written out rather than taken from a library.
 *
 * The plugin carries no runtime dependencies and this is not the place to start: what is
 * actually needed here is three request shapes and three response shapes, and an SDK
 * would bring a network stack Obsidian already has a better answer for.
 *
 * Everything in this file is pure — it builds strings and reads parsed JSON — so the
 * whole protocol is testable without a server, which matters because the server this was
 * written for only answers from inside its own network.
 */

export type LlmFailure = 'unreachable' | 'timeout' | 'http' | 'shape' | 'disabled'

/**
 * A failure the interface can say something true about.
 *
 * A stack trace tells a reader nothing they can act on; "unreachable" tells them to check
 * they are on the right network, which is the actual answer nine times out of ten for a
 * service that lives behind one.
 */
export class LlmError extends Error {
  constructor(
    readonly kind: LlmFailure,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /** Asks for a reply matching this JSON Schema, which the gateway enforces. */
  schema?: { name: string; schema: unknown }
  /** Turns on step-by-step reasoning, on the models that have it. */
  thinking?: boolean
}

/**
 * The body of a chat request.
 *
 * `chat_template_kwargs` goes at the top level, not inside `extra_body`: `extra_body` is
 * the Python client's own escape hatch and it merges those keys into the body before
 * sending. Copying the Python example literally would send a field the server ignores,
 * and the reasoning mode would look enabled while doing nothing.
 */
export function buildChatBody(request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages
  }
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
  // Sent even at zero: a quality verdict that changes between two runs on the same text
  // is a verdict nobody can audit, so determinism is the default and it must be explicit.
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (request.schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: request.schema.name, schema: request.schema.schema }
    }
  }
  if (request.thinking) body.chat_template_kwargs = { enable_thinking: true }
  return body
}

export function buildEmbeddingBody(model: string, input: string[]): Record<string, unknown> {
  // One call for many texts: the endpoint takes an array, and a library of requirements
  // embedded one request at a time would be a thousand round trips.
  return { model, input }
}

/** `base` + `path`, whichever way the reader typed the trailing slash. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

interface ChatChoice {
  message?: { content?: unknown }
}

/**
 * What the model said.
 *
 * A reply that is the right shape but empty is a failure, not an empty answer: it means
 * the request was refused or the generation was cut before the first token, and letting
 * it through as `''` would show up much later as a requirement translated to nothing.
 */
export function readChatContent(payload: unknown): string {
  const choices = (payload as { choices?: ChatChoice[] } | null)?.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new LlmError('shape', 'The reply carried no choices.')
  }
  const content = choices[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmError('shape', 'The reply carried no text.')
  }
  return content
}

export function readEmbeddings(payload: unknown): number[][] {
  const data = (payload as { data?: { embedding?: unknown }[] } | null)?.data
  if (!Array.isArray(data) || data.length === 0) {
    throw new LlmError('shape', 'The reply carried no embeddings.')
  }
  return data.map((row) => {
    const vector = row?.embedding
    if (!Array.isArray(vector) || vector.some((value) => typeof value !== 'number')) {
      throw new LlmError('shape', 'An embedding was not a vector of numbers.')
    }
    return vector as number[]
  })
}

/** The model names the gateway offers, so nobody has to type one from memory. */
export function readModels(payload: unknown): string[] {
  const data = (payload as { data?: { id?: unknown }[] } | null)?.data
  if (!Array.isArray(data)) throw new LlmError('shape', 'The reply carried no model list.')
  return data.map((row) => row?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * The JSON a model was asked for, out of the text it actually sent.
 *
 * A schema-enforcing gateway returns bare JSON and this is one `JSON.parse`. The fallback
 * is for the day it does not — a fenced block, or a sentence of preamble before the
 * object — because a feature built on an optional parameter should degrade rather than
 * break when the parameter is not honoured.
 */
export function parseJsonContent<T>(content: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content)
  const candidates = [content, fenced?.[1] ?? '', sliceBraces(content)]
  for (const candidate of candidates) {
    const text = candidate.trim()
    if (!text) continue
    try {
      return JSON.parse(text) as T
    } catch {
      continue
    }
  }
  throw new LlmError('shape', 'The reply was not the JSON it was asked for.')
}

/** From the first brace to the last: enough to lift an object out of a sentence. */
function sliceBraces(text: string): string {
  const open = text.indexOf('{')
  const close = text.lastIndexOf('}')
  return open === -1 || close <= open ? '' : text.slice(open, close + 1)
}

/**
 * How alike two embeddings are, from -1 to 1.
 *
 * Here rather than anywhere else because it is what an embedding is *for* in a
 * requirements library: the same need written twice, in two languages, by two people.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const size = Math.sqrt(normA) * Math.sqrt(normB)
  return size === 0 ? 0 : dot / size
}
