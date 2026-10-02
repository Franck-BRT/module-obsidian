import { findDates } from '../chat/deadlines'

/**
 * What changed from one version of a document to the next, found line by line: the
 * passages taken out, those put in, and those rewritten — a line out and a line in at the
 * same place —, each under the section it stands in. The dates each version writes are
 * compared too: a date moved is what a plan feels first.
 */

export interface ChangeBlock {
  /** The heading or article it stands under, in the new version; '' before any. */
  section: string
  removed: string[]
  added: string[]
}

export interface DocumentChanges {
  blocks: ChangeBlock[]
  /** Dates the new version writes and the old did not, and the other way round, with their sentences. */
  datesAdded: { date: string; sentence: string }[]
  datesRemoved: { date: string; sentence: string }[]
  /** Whether the two say the same, to the letter, spacing aside. */
  same: boolean
}

/** A line as it is compared: spacing and table bars made plain, empty ones dropped. */
function lines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/\s+/g, ' ')
        .replace(/^\|\s*|\s*\|$/g, '')
        .trim()
    )
    .filter((line) => line && !/^[-|:\s]+$/.test(line))
}

/** A line that opens a section: a Markdown heading, « Article 2 », « 2.3 Essais », « CHAPITRE III ». */
const SECTION =
  /^(?:#{1,6}\s+.+|(?:article|chapitre|section|titre|annexe)\s+[\w.]+.*|\d+(?:\.\d+)*\.?\s+\p{Lu}.{0,80})$/iu

/** More lines than this a version, and only the start of each is compared. */
const MAX_LINES = 3000

/**
 * The longest run of lines the two share, as pairs of indices — on what is left once the
 * lines they start and end alike with are set aside.
 */
function common(a: string[], b: string[]): [number, number][] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const pairs: [number, number][] = []
  for (let at = 0; at < start; at++) pairs.push([at, at])
  const n = endA - start
  const m = endB - start
  if (n && m) {
    // The table of common lengths, a row at a time from the end.
    const width = m + 1
    const table = new Uint16Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j])
        i++
        j++
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++
      else j++
    }
  }
  for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k])
  return pairs
}

/** What changed from `before` to `after`. */
export function documentChanges(before: string, after: string): DocumentChanges {
  const a = lines(before).slice(0, MAX_LINES)
  const b = lines(after).slice(0, MAX_LINES)
  const pairs = common(a, b)
  const blocks: ChangeBlock[] = []
  let section = ''
  let sectionBefore = ''
  let i = 0
  let j = 0
  const flush = (removed: string[], added: string[]): void => {
    if (!removed.length && !added.length) return
    blocks.push({ section: section || sectionBefore, removed, added })
  }
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    const removed = a.slice(i, pi)
    const added = b.slice(j, pj)
    for (const line of removed) if (SECTION.test(line)) sectionBefore = line
    flush(removed, added)
    for (const line of added) if (SECTION.test(line)) section = line
    if (pi < a.length && SECTION.test(a[pi])) sectionBefore = a[pi]
    if (pj < b.length && SECTION.test(b[pj])) section = b[pj]
    i = pi + 1
    j = pj + 1
  }
  const datesOf = (text: string): Map<string, string> => {
    const out = new Map<string, string>()
    for (const one of findDates(text)) if (!out.has(one.date)) out.set(one.date, one.sentence)
    return out
  }
  const old = datesOf(before)
  const now = datesOf(after)
  return {
    blocks,
    datesAdded: [...now].filter(([date]) => !old.has(date)).map(([date, sentence]) => ({ date, sentence })),
    datesRemoved: [...old].filter(([date]) => !now.has(date)).map(([date, sentence]) => ({ date, sentence })),
    same: blocks.length === 0
  }
}

export interface ChangesWords {
  intro: (before: string, after: string) => string
  same: string
  removed: string
  added: string
  start: string
  datesAdded: string
  datesRemoved: string
  more: (count: number) => string
}

/** Characters of changes given to the model, at most: past them, the rest is counted. */
const BUDGET = 16000

/** The changes as the model is given them: each block under its section, out with « − », in with « + ». */
export function changesBlock(
  names: { before: string; after: string },
  changes: DocumentChanges,
  words: ChangesWords
): string {
  const out = [words.intro(names.before, names.after)]
  if (changes.same) {
    out.push(words.same)
    return out.join('\n')
  }
  let used = 0
  let shown = 0
  for (const block of changes.blocks) {
    const text = [
      `### ${block.section.replace(/^#+\s*/, '') || words.start}`,
      ...block.removed.map((line) => `− ${line}`),
      ...block.added.map((line) => `+ ${line}`)
    ].join('\n')
    if (used + text.length > BUDGET && shown) break
    out.push(text)
    used += text.length
    shown++
  }
  if (shown < changes.blocks.length) out.push(words.more(changes.blocks.length - shown))
  if (changes.datesRemoved.length || changes.datesAdded.length) {
    out.push(words.datesRemoved, ...changes.datesRemoved.map((one) => `− ${one.date} — ${one.sentence}`))
    out.push(words.datesAdded, ...changes.datesAdded.map((one) => `+ ${one.date} — ${one.sentence}`))
  }
  return out.join('\n')
}

/** Whether a question asks to compare versions, in either language. */
export function asksForComparison(question: string): boolean {
  return /\b(compar|differen|ecart|evolution|ce qui a change|nouvel(?:le)? (?:indice|version)|versions?\b|indices?\b|what changed|changes? between)/i.test(
    question
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
  )
}
