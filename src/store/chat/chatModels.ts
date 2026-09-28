/**
 * Which model the chat talks to.
 *
 * The chat's own choice when the reader made one in the panel, the text model of the
 * settings otherwise — the one the requirement reviews use, so a vault set up once has a
 * chat that works before anything is chosen.
 */
export function chatModel(chosen: string, fallback: string): string {
  return chosen.trim() || fallback.trim()
}

/**
 * Models that answer something else than a conversation: embeddings, rerankers, speech.
 * A gateway lists everything it serves; offered in the chat, these would only fail.
 */
const NOT_CHAT = /embed|rerank|whisper|\btts\b|speech|transcri|moderation/i

/** The models a gateway offers that can hold a conversation, once each, in order. */
export function chatModels(listed: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of listed.map((model) => model.trim())) {
    if (!name || NOT_CHAT.test(name) || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out.sort((a, b) => a.localeCompare(b))
}
