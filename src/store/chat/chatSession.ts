import type { ChatMessage } from '../llm'

/**
 * A conversation with the model, and what of it is sent each time.
 *
 * A chat endpoint remembers nothing: every question goes with the conversation before
 * it. So what is kept on screen and what is sent are two different things — the screen
 * keeps everything, including the replies that failed, and the request carries the
 * turns that make sense to a model, as recent as fit.
 */

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  /** When it was said, as an ISO date. */
  at: string
  /** A reply that never came: shown with its reason, never sent back to the model. */
  failed?: boolean
  /** The note a question was asked about, by its path: what the model was shown with it. */
  context?: string
  /** The requirements a question was asked about, by identifier. */
  requirements?: string[]
}

/**
 * How much of the past goes with a question, in characters.
 *
 * Characters rather than tokens, because the plugin cannot count a model's tokens and a
 * guess dressed as a count is worse than a plain margin. Roughly six thousand tokens of
 * French: room for a long exchange, far from any model's limit.
 */
export const CHAT_HISTORY_BUDGET = 24000

/**
 * The messages a question is sent with: the instructions, then the conversation's most
 * recent turns that fit, oldest first.
 *
 * The latest question always goes, however long. A reply that failed does not — the
 * model never said it — and two questions left side by side by it are sent as one, since
 * a conversation that alternates is what every chat model expects.
 */
export function chatMessages(turns: ChatTurn[], system: string, budget = CHAT_HISTORY_BUDGET): ChatMessage[] {
  const said = turns.filter((turn) => !turn.failed && turn.content.trim() !== '')
  const merged: ChatMessage[] = []
  for (const turn of said) {
    const last = merged[merged.length - 1]
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${turn.content}`
    else merged.push({ role: turn.role, content: turn.content })
  }

  const kept: ChatMessage[] = []
  let used = 0
  for (let at = merged.length - 1; at >= 0; at--) {
    const message = merged[at]
    if (kept.length && used + message.content.length > budget) break
    kept.unshift(message)
    used += message.content.length
  }
  // A conversation that opens on a reply, cut from its question, reads as the model
  // talking to itself.
  while (kept.length > 1 && kept[0].role === 'assistant') kept.shift()
  return [{ role: 'system', content: system }, ...kept]
}

/** The turns with the last failed reply taken off, ready to ask the same question again. */
export function withoutFailure(turns: ChatTurn[]): ChatTurn[] {
  const last = turns[turns.length - 1]
  return last?.failed ? turns.slice(0, -1) : turns
}

/**
 * How much of a note goes with a question, in characters: about three thousand tokens,
 * half the room the conversation itself is given. A note longer than that is cut, and
 * the model is told it was.
 */
export const NOTE_CONTEXT_BUDGET = 12000

export interface ContextNote {
  path: string
  title: string
  content: string
}

export interface ContextWords {
  /** What introduces the note to the model: which note it is, and why it is there. */
  heading: (title: string, path: string) => string
  /** What is said where the note was cut: how much of how much was sent. */
  truncated: (sent: number, total: number) => string
}

/**
 * The instructions, with the note the question is about after them.
 *
 * In the instructions rather than in the question: the note is what the conversation is
 * about, not something the reader said, and it is not kept in the record. A note over the
 * budget is cut at a paragraph where one falls in its last third, so the model reads
 * whole paragraphs — and is told the rest exists, so it does not answer as if it had
 * read it.
 */
export function withNote(
  system: string,
  note: ContextNote | null,
  words: ContextWords,
  budget = NOTE_CONTEXT_BUDGET
): string {
  if (!note) return system
  const content = note.content.trim()
  let sent = content
  let tail = ''
  if (content.length > budget) {
    const paragraph = content.lastIndexOf('\n\n', budget)
    sent = content.slice(0, paragraph > budget * 0.66 ? paragraph : budget).trimEnd()
    tail = `\n\n${words.truncated(sent.length, content.length)}`
  }
  return `${system}\n\n${words.heading(note.title, note.path)}\n<note path="${note.path}">\n${sent}${tail}\n</note>`
}

/** The note the conversation's latest question was asked about, if any. */
export function currentContext(turns: ChatTurn[]): string | undefined {
  for (let at = turns.length - 1; at >= 0; at--) {
    if (turns[at].role === 'user') return turns[at].context
  }
  return undefined
}
