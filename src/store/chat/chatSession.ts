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
