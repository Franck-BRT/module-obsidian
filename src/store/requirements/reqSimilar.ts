import { cosine } from '../llm'

/**
 * Finding the requirement that was written twice.
 *
 * It happens to every library that more than one person writes into: the same need stated
 * in two sections, in two vocabularies, by two people who each looked and did not find
 * the other. Two identifiers for one obligation is a contradiction waiting to be
 * discovered by whoever has to satisfy both.
 *
 * Two ways of looking, and the first needs nothing. Lexical similarity — how much of the
 * letters two statements share — catches the copy-paste-and-edit case, which is most of
 * them, and it runs with no gateway, no model and no waiting. Semantic similarity, when a
 * model is configured, catches the rest: the same obligation written in words that have
 * nothing in common, or in two languages.
 */

/* ---- Lexical ------------------------------------------------------------- */

/**
 * A wording reduced to what two statements can be compared on.
 *
 * Accents dropped and punctuation flattened, because "Le système doit répondre en 3s." and
 * "le systeme doit repondre en 3 s" are the same requirement typed twice, and a comparison
 * that says otherwise finds nothing worth finding.
 */
export function normalizeForCompare(text: string): string {
  return (
    text
      .normalize('NFD')
      // The mark category rather than a range of escapes: a formatter turns `\u0300-\u036f`
      // into the characters themselves, and a class of invisible combining marks in the
      // source is a line nobody can read and nobody dares touch.
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  )
}

/** Letter triples, which is what makes this robust to an ending or a word order changing. */
export function trigrams(text: string): Set<string> {
  const clean = normalizeForCompare(text)
  if (clean.length < 3) return new Set(clean ? [clean] : [])
  const out = new Set<string>()
  for (let i = 0; i + 3 <= clean.length; i++) out.add(clean.slice(i, i + 3))
  return out
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const gram of small) {
    if (large.has(gram)) shared += 1
  }
  return shared / (a.size + b.size - shared)
}

export interface SimilarItem {
  id: string
  text: string
}

export interface SimilarPair {
  a: string
  b: string
  /** How much of the letters they share, from 0 to 1. Always computed. */
  lexical: number
  /** How close a model put them. Absent until one has been asked. */
  semantic?: number
  /** What the pair is ranked on: the stronger of the two signals. */
  score: number
}

function order(a: string, b: string): [string, string] {
  return a.localeCompare(b, undefined, { numeric: true }) <= 0 ? [a, b] : [b, a]
}

/**
 * Every pair that shares enough letters to be worth a look.
 *
 * The size check before the count is not an optimisation for its own sake: comparing a
 * library of a thousand requirements is half a million comparisons, and a pair whose
 * statements differ in length by more than the threshold allows cannot reach it however
 * they are worded — so the arithmetic that proves it is skipped rather than performed.
 */
export function lexicalPairs(items: SimilarItem[], threshold: number): SimilarPair[] {
  const grams = items.map((item) => ({ id: item.id, set: trigrams(item.text) }))
  const pairs: SimilarPair[] = []
  for (let i = 0; i < grams.length; i++) {
    const left = grams[i]
    if (left.set.size === 0) continue
    for (let j = i + 1; j < grams.length; j++) {
      const right = grams[j]
      if (right.set.size === 0) continue
      const smaller = Math.min(left.set.size, right.set.size)
      const larger = Math.max(left.set.size, right.set.size)
      if (smaller / larger < threshold) continue
      const lexical = jaccard(left.set, right.set)
      if (lexical < threshold) continue
      const [a, b] = order(left.id, right.id)
      pairs.push({ a, b, lexical, score: lexical })
    }
  }
  return pairs
}

/* ---- Semantic ------------------------------------------------------------- */

export interface EmbeddedItem {
  id: string
  vector: number[]
}

/** Every pair a model put close together. The same shape as the lexical pass. */
export function semanticPairs(items: EmbeddedItem[], threshold: number): SimilarPair[] {
  const pairs: SimilarPair[] = []
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const score = cosine(items[i].vector, items[j].vector)
      if (score < threshold) continue
      const [a, b] = order(items[i].id, items[j].id)
      pairs.push({ a, b, lexical: 0, semantic: score, score })
    }
  }
  return pairs
}

/**
 * The two passes as one list.
 *
 * A pair found by both keeps both numbers and is ranked on the stronger, because the
 * question a reader is answering is "is this worth opening", and either signal being high
 * is reason enough. Ranked highest first, with the identifiers as the tie-break so the
 * list does not reshuffle itself between two runs that found the same thing.
 */
export function mergePairs(lexical: SimilarPair[], semantic: SimilarPair[]): SimilarPair[] {
  const byKey = new Map<string, SimilarPair>()
  for (const pair of [...lexical, ...semantic]) {
    const key = `${pair.a}|${pair.b}`
    const held = byKey.get(key)
    if (!held) {
      byKey.set(key, { ...pair })
      continue
    }
    held.lexical = Math.max(held.lexical, pair.lexical)
    if (pair.semantic !== undefined) held.semantic = Math.max(held.semantic ?? 0, pair.semantic)
    held.score = Math.max(held.lexical, held.semantic ?? 0)
  }
  return [...byKey.values()].sort(
    (one, other) =>
      other.score - one.score ||
      one.a.localeCompare(one.b, undefined, { numeric: true }) ||
      one.a.localeCompare(other.a, undefined, { numeric: true }) ||
      one.b.localeCompare(other.b, undefined, { numeric: true })
  )
}

/** How hard the reader is looking. Named rather than a number, because a number here means nothing. */
export type SimilarStrictness = 'strict' | 'normal' | 'wide'

export interface Thresholds {
  lexical: number
  semantic: number
}

/**
 * What each setting means, in the only terms that matter: how alike is alike enough.
 *
 * Two scales, because they are not the same measure. Sharing three quarters of your
 * letters is a near-copy; a cosine of 0.75 is two requirements about the same subsystem.
 * A single slider driving both would be wrong at one end or the other, always.
 */
export function thresholdsFor(strictness: SimilarStrictness): Thresholds {
  switch (strictness) {
    case 'strict':
      return { lexical: 0.8, semantic: 0.93 }
    case 'wide':
      return { lexical: 0.45, semantic: 0.82 }
    default:
      return { lexical: 0.6, semantic: 0.88 }
  }
}
