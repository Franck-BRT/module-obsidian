import type { ChatMessage } from '../llm'
import { excerptFor } from './chatFile'
import { COLLECTION_FRONTMATTER_KEY, FRONTMATTER_KEY, TASK_FRONTMATTER_KEY } from '../YamlParser'

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
  /** The projects a question was asked about, by the paths of their notes. */
  projects?: string[]
  /** The collections a question was asked about, by the paths of their notes. */
  collections?: string[]
  /** The files a question was asked with — a planning, a report — by path. */
  files?: string[]
  /** The skills a question was asked with, by the paths of their notes. */
  skills?: string[]
  /**
   * A question asked of the whole library: the documents and notes whose passages went
   * with it, by path — none when nothing was found.
   */
  library?: string[]
  /** The model a reply was written by, where it is known. */
  model?: string
  /** A reply the length limit cut before the model had finished. Said in the panel only. */
  cut?: boolean
  /**
   * A question asked again — as it was, or rewritten — in place of the one asked at this
   * moment: that one and everything after it are the conversation's past, not its thread.
   */
  retakes?: string
  /**
   * A question asked after going back to an earlier branch: it follows the exchange whose
   * question was asked at this moment, not the one written just before it in the note.
   */
  follows?: string
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
 * How much of a note goes with a question, in characters, unless the reader says
 * otherwise: some sixty thousand tokens, a long transcription whole, within what the
 * large models read at once. A note longer than that goes by passages, and the model is
 * told; a model that reads less says so, and the note is sent again, shorter.
 */
export const NOTE_CONTEXT_BUDGET = 200000

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
  /** What is said when only passages of it were sent: those the question speaks of. */
  excerpted?: (sent: number, total: number) => string
}

/**
 * The instructions, with the note the question is about after them.
 *
 * In the instructions rather than in the question: the note is what the conversation is
 * about, not something the reader said, and it is not kept in the record. A note within
 * the budget goes whole. One over it goes by its opening and the passages the question
 * speaks of (`question`, its words), or, when none does, is cut at a paragraph where one
 * falls in its last third — and the model is told the rest exists, so it does not answer
 * as if it had read it.
 */
export function withNote(
  system: string,
  note: ContextNote | null,
  words: ContextWords,
  budget = NOTE_CONTEXT_BUDGET,
  question: string[] = []
): string {
  if (!note) return system
  const content = note.content.trim()
  let sent = content
  let tail = ''
  if (content.length > budget) {
    const passages = words.excerpted ? excerptFor(content, budget, question) : null
    if (passages && words.excerpted) {
      sent = passages
      tail = `\n\n${words.excerpted(sent.length, content.length)}`
    } else {
      const paragraph = content.lastIndexOf('\n\n', budget)
      sent = content.slice(0, paragraph > budget * 0.66 ? paragraph : budget).trimEnd()
      tail = `\n\n${words.truncated(sent.length, content.length)}`
    }
  }
  return `${system}\n\n${words.heading(note.title, note.path)}\n<note path="${note.path}">\n${sent}${tail}\n</note>`
}

/** What the plugin writes into its own notes for itself, and a reader never reads. */
const BOOKKEEPING = new Set(['id', 'createdAt', 'updatedAt'])

/**
 * A note as a model should read it: a ticket's, a project's or a collection's without
 * the plugin's bookkeeping in its front matter.
 *
 * Their identifier is a random string the plugin keys them by. Shown to a model, it is
 * what the model quotes back — "k3j9x2ab is late" — where the reader wanted the title.
 * Every other note is sent as it is: a requirement's identifier is a name people use.
 */
export function readableNote(content: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content)
  if (!match) return content
  const lines = match[1].split(/\r?\n/)
  const ours = [FRONTMATTER_KEY, TASK_FRONTMATTER_KEY, COLLECTION_FRONTMATTER_KEY].some((key) =>
    lines.some((line) => new RegExp(`^${key}:\\s*true\\s*$`).test(line))
  )
  if (!ours) return content
  const kept = lines.filter((line) => !BOOKKEEPING.has(/^([\w-]+):/.exec(line)?.[1] ?? ''))
  return `---\n${kept.join('\n')}\n---${match[2]}${content.slice(match[0].length)}`
}

/** The note the conversation's latest question was asked about, if any. */
export function currentContext(turns: ChatTurn[]): string | undefined {
  for (let at = turns.length - 1; at >= 0; at--) {
    if (turns[at].role === 'user') return turns[at].context
  }
  return undefined
}

/** The least of a note sent, however short the model's reading: a few pages. */
export const NOTE_FLOOR = 12000

/** Whether a failure is the model finding the question too long for it, by what the gateway said. */
export function tooLongForModel(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const status = (error as { status?: unknown }).status
  if (status === 413) return true
  return /context|too many tokens|too long|token limit|maximum.{0,40}tokens|reduce the length/i.test(error.message)
}

/**
 * How much of the note to send again when the model found the question too long: half of
 * what went, never below a few pages. Null when that is not what failed, or when there is
 * nothing more to take off.
 */
export function shorterNote(error: unknown, budget: number, length: number): number | null {
  if (!tooLongForModel(error)) return null
  const sent = Math.min(budget, length)
  if (sent <= NOTE_FLOOR) return null
  return Math.max(NOTE_FLOOR, Math.floor(sent / 2))
}
