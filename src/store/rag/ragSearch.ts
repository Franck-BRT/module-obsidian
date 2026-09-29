import { searchTerms } from '../chat/libraryRetrieval'
import { fold } from '../library/libraryDoc'
import { embeddingInput } from './ragChunk'
import type { RagEntry, RagIndex, RagKind } from './RagIndex'
import { inProject } from './ragSources'
import { fuseRanks, similarity, topIndexes, unit } from './ragVectors'

/**
 * A question looked up in the whole vault, as finely as the gateway allows.
 *
 * Two searches side by side: by the question's words (BM25 — a reference « PL-002 », a
 * name, a figure is found exactly) and by its meaning (the embeddings — « quand coule-t-on »
 * finds « coulage »). Their rankings are made one, what belongs to the projects the
 * conversation is about a little ahead; the best few dozen are then read with the
 * question by the reranking model, which keeps the handful that answer it. Each is given
 * with the passages around it, as far as the room allows, and the same passage found in
 * two copies of a document is given once.
 */

export interface SearchDeps {
  /** The question's embedding; failing, the search is by words alone. */
  embed?: (text: string) => Promise<number[]>
  /** How relevant each text is to the question; failing, the fused order stands. */
  rerank?: (query: string, texts: string[]) => Promise<number[]>
}

export interface SearchOptions {
  /** Characters of passages given, all sources together. */
  budget: number
  /** Passages read by the reranking model. */
  candidates: number
  /** Passages kept after it, before their neighbours are added. */
  keep: number
  /** Projects the conversation is about: what belongs to them comes a little ahead. */
  projects: string[]
}

export const SEARCH_DEFAULTS: SearchOptions = { budget: 36000, candidates: 30, keep: 8, projects: [] }

export interface FoundPassage {
  /** Its place in its source. */
  at: number
  heading: string
  text: string
  /** Given for what is around one found, not found itself. */
  around: boolean
}

export interface FoundInVault {
  entry: RagEntry
  passages: FoundPassage[]
}

export interface SearchReport {
  found: FoundInVault[]
  /** Whether the meaning was searched, and whether the reranking model put the passages in order. */
  used: { vectors: boolean; rerank: boolean }
}

interface Hit {
  entry: RagEntry
  at: number
}

const WORD_CHAR = /[\p{L}\p{N}]/u

/** How many times a word starts with `term` in a folded text: « radier » counts « radiers » too. */
function occurrences(folded: string, term: string): number {
  let count = 0
  for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
    if (at === 0 || !WORD_CHAR.test(folded[at - 1])) count++
  }
  return count
}

/**
 * The passages holding the question's words, the best first (BM25, those holding more of
 * them ahead). Counted in the folded text as it is kept, without cutting it into words
 * again at each question: a vault of thirty thousand passages is looked through at once.
 */
function byWords(hits: Hit[], query: string, limit: number): number[] {
  const terms = searchTerms(query)
  if (!terms.length) return []
  const counted: { at: number; counts: number[]; length: number }[] = []
  for (const [at, hit] of hits.entries()) {
    const folded = hit.entry.passages[hit.at].folded
    const counts = terms.map((term) => occurrences(folded, term))
    // About six characters a word: the length BM25 weighs a passage by.
    if (counts.some(Boolean)) counted.push({ at, counts, length: folded.length / 6 })
  }
  if (!counted.length) return []
  const average = counted.reduce((sum, each) => sum + each.length, 0) / counted.length || 1
  const idf = terms.map((_, t) => {
    const df = counted.filter((each) => each.counts[t] > 0).length
    return Math.log(1 + (hits.length - df + 0.5) / (df + 0.5))
  })
  const scores = counted.map(({ counts, length }) => {
    let score = 0
    let matched = 0
    counts.forEach((frequency, t) => {
      if (!frequency) return
      matched++
      score += (idf[t] * frequency * 2.2) / (frequency + 1.2 * (0.25 + (0.75 * length) / average))
    })
    return score * (matched / terms.length) ** 2
  })
  return topIndexes(scores, limit)
    .filter((at) => scores[at] > 0)
    .map((at) => counted[at].at)
}

/** The passages nearest the question's meaning, the nearest first. */
function byMeaning(hits: Hit[], vector: number[], limit: number): number[] {
  const query = unit(vector)
  const scores = hits.map((hit) => {
    const stored = hit.entry.passages[hit.at].vector
    return stored.length === query.length ? similarity(query, stored) : Number.NEGATIVE_INFINITY
  })
  return topIndexes(scores, limit)
}

/** Looks a question up in the vault index. */
export async function searchVault(
  index: RagIndex,
  query: string,
  deps: SearchDeps,
  options: SearchOptions = SEARCH_DEFAULTS
): Promise<SearchReport> {
  const hits: Hit[] = []
  for (const entry of index.all()) entry.passages.forEach((_, at) => hits.push({ entry, at }))
  const used = { vectors: false, rerank: false }
  if (!hits.length || !query.trim()) return { found: [], used }

  const pool = Math.max(60, options.candidates * 2)
  const rankings: number[][] = [byWords(hits, query, pool)]
  if (deps.embed) {
    try {
      rankings.push(byMeaning(hits, await deps.embed(query), pool))
      used.vectors = true
    } catch (error) {
      console.error('[PM] The question could not be embedded; searching by its words:', error)
    }
  }
  const belongs = (at: number): boolean => options.projects.some((project) => inProject(hits[at].entry, project))
  // A little ahead — as much as being found once more near the top —, never over what answers better.
  const fused = fuseRanks(rankings, 60, (at) => (belongs(at) ? 1 / 61 : 0))

  // The same words in two copies of a document — its PDF and its Word — are read once.
  const seen = new Set<string>()
  const candidates: number[] = []
  for (const at of fused) {
    const passage = hits[at].entry.passages[hits[at].at]
    const same = fold(passage.text).replace(/\s+/g, ' ').trim()
    if (seen.has(same)) continue
    seen.add(same)
    candidates.push(at)
    if (candidates.length >= options.candidates) break
  }

  let kept = candidates
  if (deps.rerank && candidates.length > 1) {
    try {
      const texts = candidates.map((at) => embeddingInput(hits[at].entry.title, hits[at].entry.passages[hits[at].at]))
      const scores = await deps.rerank(query, texts)
      kept = topIndexes(scores, candidates.length).map((at) => candidates[at])
      used.rerank = true
    } catch (error) {
      console.error('[PM] The passages could not be reranked; keeping the search’s order:', error)
    }
  }
  kept = kept.slice(0, options.keep)

  // The passages kept, then what is around each, as far as the room allows.
  const chosen = new Map<RagEntry, Map<number, boolean>>()
  const order: RagEntry[] = []
  let spent = 0
  const take = (entry: RagEntry, at: number, around: boolean): void => {
    const passage = entry.passages[at]
    if (!passage) return
    const taken = chosen.get(entry)
    if (taken?.has(at)) return
    if (spent && spent + passage.text.length > options.budget) return
    spent += passage.text.length
    if (!taken) {
      chosen.set(entry, new Map([[at, around]]))
      order.push(entry)
    } else taken.set(at, around)
  }
  for (const at of kept) take(hits[at].entry, hits[at].at, false)
  for (const at of kept) {
    take(hits[at].entry, hits[at].at - 1, true)
    take(hits[at].entry, hits[at].at + 1, true)
  }
  return {
    found: order.map((entry) => ({
      entry,
      passages: [...(chosen.get(entry) ?? new Map<number, boolean>())]
        .sort((a, b) => a[0] - b[0])
        .map(([at, around]) => ({ at, heading: entry.passages[at].heading, text: entry.passages[at].text, around }))
    })),
    used
  }
}

export interface VaultContextWords {
  intro: string
  none: string
  heading: (index: number, title: string) => string
  kind: (kind: RagKind) => string
}

/** The passages found, as the model is given them: each source with its link, each passage under its headings. */
export function vaultContext(found: FoundInVault[], words: VaultContextWords): string {
  if (!found.length) return words.none
  const blocks = found.map(({ entry, passages }, index) => {
    const title = entry.title.replace(/[[\]|]/g, ' ').trim() || entry.path
    const lines = [
      `### ${words.heading(index + 1, entry.title)}`,
      `${words.kind(entry.kind)} · [[${entry.path}|${title}]]`
    ]
    let previous: FoundPassage | null = null
    for (const passage of passages) {
      if (previous) lines.push('>', ...(passage.at === previous.at + 1 ? [] : ['> …', '>']))
      if (passage.heading && passage.heading !== previous?.heading) lines.push(`> **${passage.heading}**`, '>')
      lines.push(...passage.text.split('\n').map((line) => `> ${line}`))
      previous = passage
    }
    return lines.join('\n')
  })
  return [words.intro, ...blocks].join('\n\n')
}

/**
 * The messages asking the chat model to make a follow-up a question that stands alone —
 * « et pour le lot 3 ? » becomes « date de coulage du radier du lot 3 » — from what was
 * said before it, the last exchanges only.
 */
export function rewriteMessages(
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string,
  instruction: string
): { role: 'system' | 'user'; content: string }[] {
  const recent = history
    .slice(-4)
    .map((turn) => `${turn.role === 'user' ? 'Q' : 'R'} : ${turn.content.replace(/\s+/g, ' ').slice(0, 600)}`)
    .join('\n')
  return [
    { role: 'system', content: instruction },
    { role: 'user', content: `${recent}\n\nQ : ${question}` }
  ]
}

/** The rewritten question as the model sent it: one line, without quotes or a label before it. */
export function readRewrite(reply: string, fallback: string): string {
  const line = reply
    .split('\n')
    .map((each) => each.trim())
    .find(Boolean)
  const clean = line
    ?.replace(/^(q|question|requête|requete|query)\s*:\s*/i, '')
    .replace(/^["«“]\s*|\s*["»”]$/g, '')
    .trim()
  return clean && clean.length <= 400 ? clean : fallback
}

export interface VaultQuestion {
  question: string
  /** What was said before it in the conversation. */
  history: { role: 'user' | 'assistant'; content: string }[]
  /** Asks the chat model; given, a follow-up is made a question that stands alone first. */
  rewrite?: (messages: { role: 'system' | 'user'; content: string }[]) => Promise<string>
  /** What the chat model is told to do when it rewrites. */
  instruction: string
}

/**
 * A question of the conversation looked up in the vault: a follow-up made one that stands
 * alone first — the first question of a conversation needs no rewriting, and a rewriting
 * that fails leaves the question as it was asked.
 */
export async function lookUpVault(
  index: RagIndex,
  ask: VaultQuestion,
  deps: SearchDeps,
  options: SearchOptions = SEARCH_DEFAULTS
): Promise<{ query: string; report: SearchReport }> {
  let query = ask.question
  if (ask.rewrite && ask.history.some((turn) => turn.role === 'user')) {
    try {
      query = readRewrite(await ask.rewrite(rewriteMessages(ask.history, ask.question, ask.instruction)), ask.question)
    } catch (error) {
      console.error('[PM] The follow-up could not be rewritten; looking it up as asked:', error)
    }
  }
  return { query, report: await searchVault(index, query, deps, options) }
}
