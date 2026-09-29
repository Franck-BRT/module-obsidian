/**
 * Embeddings kept small and compared fast, in the plugin itself.
 *
 * A vector is brought to unit length and each of its numbers written as a byte, from -127
 * to 127: four times less room than floats, and a cosine that differs from the exact one
 * in the third decimal — far below what tells a relevant passage from another.
 */

/** A vector at unit length, as bytes. */
export function quantize(vector: number[]): Int8Array {
  let norm = 0
  for (const value of vector) norm += value * value
  const scale = norm > 0 ? 127 / Math.sqrt(norm) : 0
  const out = new Int8Array(vector.length)
  for (let at = 0; at < vector.length; at++) out[at] = Math.max(-127, Math.min(127, Math.round(vector[at] * scale)))
  return out
}

/** A question's vector at unit length, to be compared with the stored ones. */
export function unit(vector: number[]): Float32Array {
  let norm = 0
  for (const value of vector) norm += value * value
  const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0
  return Float32Array.from(vector, (value) => value * scale)
}

/** The cosine of a question's vector with a stored one. */
export function similarity(query: Float32Array, row: Int8Array): number {
  if (query.length !== row.length) return 0
  let dot = 0
  for (let at = 0; at < row.length; at++) dot += query[at] * row[at]
  return dot / 127
}

/** The indexes of the `k` highest scores, highest first. */
export function topIndexes(scores: ArrayLike<number>, k: number): number[] {
  const order = Array.from({ length: scores.length }, (_, at) => at).filter((at) => Number.isFinite(scores[at]))
  order.sort((a, b) => scores[b] - scores[a] || a - b)
  return order.slice(0, k)
}

/**
 * Several rankings made one (reciprocal rank fusion): each item scores the sum, over the
 * rankings it is in, of one over its rank plus `k`. Found high by both the words and the
 * meaning, it comes first; found by one only, it still comes — which a sum of raw scores
 * of two different kinds could not promise.
 */
export function fuseRanks<T>(rankings: T[][], k = 60, bonus: (item: T) => number = () => 0): T[] {
  const scores = new Map<T, number>()
  for (const ranking of rankings) {
    ranking.forEach((item, rank) => scores.set(item, (scores.get(item) ?? 0) + 1 / (k + rank + 1)))
  }
  for (const [item, score] of scores) scores.set(item, score + bonus(item))
  return [...scores.keys()].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
}
