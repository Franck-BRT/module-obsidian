import { fold } from '../library/libraryDoc'
import { searchTerms, tokens } from './libraryRetrieval'
import { pageMarkNumber } from './ocr'

/**
 * Where in a source a reply's citation points.
 *
 * A source cited is opened at the passage the reply took from it, not at its first line:
 * the passage is the one of those the model was shown — or, those forgotten, of the
 * source's own text — that shares the most words with what the reply says around the
 * link; then found again in the note, to be shown highlighted, or in the document's pages,
 * to be opened at its page.
 */

/** Words that tell passages apart: the rarer kinds, figures above all, count for more. */
function weight(word: string): number {
  if (/\d/.test(word)) return 3
  return word.length >= 7 ? 2 : 1
}

/** How much of `context` a passage holds: the weights of the words they share. */
function overlap(passage: string, context: Set<string>): number {
  let score = 0
  for (const word of new Set(tokens(passage))) if (context.has(word)) score += weight(word)
  return score
}

/** Fewer words than this around a link, and the whole reply is what the passage is chosen by. */
const FEW_WORDS = 4

/** What a link is read by: the sentence around it, or the whole reply when that says too little. */
export function citationContext(around: string, reply: string): string {
  return searchTerms(around).length >= FEW_WORDS ? around : `${around}\n${reply}`
}

/**
 * The passage a citation points to, among those of its source: the one sharing the most
 * words with what is said around the link; the first — the best found — when none shares
 * any. Null when there are none.
 */
export function bestPassage(passages: string[], context: string): { passage: string; index: number } | null {
  if (!passages.length) return null
  const words = new Set(searchTerms(context))
  let best = 0
  let bestScore = 0
  passages.forEach((passage, index) => {
    const score = overlap(passage, words)
    if (score > bestScore) {
      best = index
      bestScore = score
    }
  })
  return { passage: passages[best], index: best }
}

/** A line as it is compared: folded, without Markdown's marks, its spaces made one. */
function bare(line: string): string {
  return fold(line)
    .replace(/^\s*(?:>\s*)+/, '')
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[.\]\s+)?|\d+[.)]\s+)/, '')
    .replace(/[*_`~=]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Shorter than this, a line is no landmark: « Oui. », « - », a table's rule. */
const LANDMARK = 12

/** Whether the line of the text holds the passage's line, or — a line cut — the other way round. */
function holds(text: string, line: string): boolean {
  if (!text || !line) return false
  return text.includes(line) || (text.length >= LANDMARK && line.includes(text))
}

export interface PassagePlace {
  /** Its first and last lines in the text, from 0. */
  from: number
  to: number
  /** Where it starts and ends in the text, in characters. */
  start: number
  end: number
}

/**
 * Where a passage stands in the text it was cut from, however it was written in between
 * — quoted, its emphasis taken off, under headings it was given —: from the first of its
 * lines found in the text to the last found after it. Null when none is.
 */
export function locatePassage(text: string, passage: string): PassagePlace | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const bareLines = lines.map(bare)
  const landmarks = passage
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(bare)
    .filter((line) => line.replace(/[^\p{L}\p{N}]/gu, '').length >= LANDMARK)
  let from = -1
  let to = -1
  for (const landmark of landmarks) {
    const after = from < 0 ? 0 : to
    const at = bareLines.findIndex((line, index) => index >= after && holds(line, landmark))
    if (at < 0) continue
    if (from < 0) from = at
    to = at
  }
  if (from < 0) return null
  const start = lines.slice(0, from).reduce((sum, line) => sum + line.length + 1, 0)
  const end = lines.slice(0, to + 1).reduce((sum, line) => sum + line.length + 1, 0) - 1
  return { from, to, start, end }
}

/**
 * The page of a transcription a passage is on, by the heading it opens each page with —
 * « Page 3 sur 19 » —: the last one above the passage. Null when the passage is not found
 * in it, or it says no page.
 */
export function transcriptPage(text: string, passage: string): number | null {
  const place = locatePassage(text, passage)
  if (!place) return null
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let at = place.from; at >= 0; at--) {
    const page = pageMarkNumber(lines[at])
    if (page) return page
  }
  return null
}

/** A text's runs of three words, as the pages are compared by: rarer than words alone. */
function triples(text: string): Set<string> {
  const words = tokens(text)
  const out = new Set<string>()
  for (let at = 0; at + 2 < words.length; at++) out.add(`${words[at]} ${words[at + 1]} ${words[at + 2]}`)
  return out
}

/**
 * The page of a document a passage is on, from what each page says: the one holding the
 * most of its runs of three words, or failing any, of its words. Null when no page holds
 * any.
 */
export function bestPage(pages: string[], passage: string): number | null {
  const runs = triples(passage)
  const words = new Set(searchTerms(passage))
  let best: number | null = null
  let bestScore = 0
  pages.forEach((page, index) => {
    const own = triples(page)
    let score = 0
    for (const run of runs) if (own.has(run)) score += 100
    score += overlap(page, words)
    if (score > bestScore) {
      best = index + 1
      bestScore = score
    }
  })
  return best
}
