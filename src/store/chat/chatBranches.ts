import type { ChatTurn } from './chatSession'

/**
 * A conversation as the tree it becomes when questions are asked again.
 *
 * Each exchange — a question and the replies to it — follows the one before it in the
 * note, unless its question says otherwise: asked again in place of an earlier question
 * (↻), it follows what that one followed, and starts a branch beside it; asked after
 * going back to an older branch (↪), it follows the exchange it names. The note keeps
 * every exchange in the order they were had; the tree is what it adds up to, and the
 * thread is the path to the last one.
 *
 * Laid out the way a history of versions is drawn: the first child of an exchange carries
 * on its lane, every other starts a lane of its own to the right.
 */

export interface Exchange {
  /** Its place in the note, which is also its row. */
  index: number
  question: ChatTurn
  replies: ChatTurn[]
  parent: number | null
  children: number[]
  lane: number
  /** On the path to the last exchange: the thread the conversation goes on from. */
  current: boolean
}

export interface ConversationTree {
  exchanges: Exchange[]
  /** Turns said before any question, which belong to every thread. */
  lead: ChatTurn[]
  lanes: number
}

/** A moment to the minute, the way the note's titles give it. */
export function minuteKey(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`
}

export function conversationTree(turns: ChatTurn[]): ConversationTree {
  const lead: ChatTurn[] = []
  const exchanges: Exchange[] = []
  for (const turn of turns) {
    if (turn.role === 'user') {
      exchanges.push({
        index: exchanges.length,
        question: turn,
        replies: [],
        parent: null,
        children: [],
        lane: 0,
        current: false
      })
    } else if (exchanges.length) exchanges[exchanges.length - 1].replies.push(turn)
    else lead.push(turn)
  }

  // The exchange a mark names: the last one before this whose question was asked then.
  const named = (before: number, iso: string): Exchange | undefined => {
    const key = minuteKey(iso)
    for (let at = before - 1; at >= 0; at--) {
      if (minuteKey(exchanges[at].question.at) === key) return exchanges[at]
    }
    return undefined
  }
  for (const exchange of exchanges) {
    const { question } = exchange
    const i = exchange.index
    if (question.retakes) {
      const retaken = named(i, question.retakes)
      exchange.parent = retaken ? retaken.parent : i > 0 ? i - 1 : null
    } else if (question.follows) {
      exchange.parent = named(i, question.follows)?.index ?? (i > 0 ? i - 1 : null)
    } else exchange.parent = i > 0 ? i - 1 : null
    if (exchange.parent !== null) exchanges[exchange.parent].children.push(i)
  }

  let lanes = exchanges.length ? 1 : 0
  for (const exchange of exchanges) {
    if (exchange.parent === null) {
      // A second root — a note whose first question was asked again — takes its own lane.
      const roots = exchanges.filter((one) => one.parent === null)
      exchange.lane = roots[0] === exchange ? 0 : lanes++
      continue
    }
    const parent = exchanges[exchange.parent]
    exchange.lane = parent.children[0] === exchange.index ? parent.lane : lanes++
  }

  let at: number | null = exchanges.length ? exchanges.length - 1 : null
  while (at !== null) {
    exchanges[at].current = true
    at = exchanges[at].parent
  }
  return { exchanges, lead, lanes }
}

/** The turns on the path to an exchange, from the first question to its last reply. */
export function threadTo(tree: ConversationTree, index: number): ChatTurn[] {
  const path: Exchange[] = []
  let at: number | null = index
  while (at !== null && tree.exchanges[at]) {
    path.unshift(tree.exchanges[at])
    at = tree.exchanges[at].parent
  }
  return [...tree.lead, ...path.flatMap((exchange) => [exchange.question, ...exchange.replies])]
}

/**
 * The exchange a branch through this one ends on: from it, always the latest child —
 * the branch as it was last left.
 */
export function branchEnd(tree: ConversationTree, index: number): number {
  let at = index
  for (;;) {
    const children = tree.exchanges[at]?.children ?? []
    if (!children.length) return at
    at = children[children.length - 1]
  }
}

/** The conversation as it now goes: the path to the last exchange the note holds. */
export function currentThread(turns: ChatTurn[]): ChatTurn[] {
  const tree = conversationTree(turns)
  if (!tree.exchanges.length) return tree.lead
  return threadTo(tree, tree.exchanges.length - 1)
}

/** How many branches the conversation has: its exchanges that nothing follows. */
export function branchCount(tree: ConversationTree): number {
  return tree.exchanges.filter((exchange) => !exchange.children.length).length
}
