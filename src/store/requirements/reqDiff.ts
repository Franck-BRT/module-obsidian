/**
 * What changed between two wordings of a requirement.
 *
 * A revision history that only says "changed on 3 March by Franck" is a log, not a
 * history: the question anybody actually asks is whether the obligation moved, and that
 * is answered by seeing the words. Word by word rather than character by character,
 * because a requirement is read as a sentence and a character diff of a rewritten clause
 * is confetti.
 *
 * Written out rather than taken from a library: the plugin carries no runtime
 * dependencies, and what is needed here is a longest common subsequence over a few
 * hundred tokens.
 */

export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffPart {
  kind: DiffKind
  text: string
}

/**
 * Words, each carrying the spacing that follows it.
 *
 * Riding along rather than standing as tokens of its own, and this is the whole
 * difference between a readable diff and confetti: spaces are common to both sides, so
 * separate space tokens match, and a rewritten clause comes back as "word, space, word,
 * space" — four unchanged fragments interleaved with the changes, rendered as a dozen
 * spans of alternating colour. Attached, a rewritten run is one run.
 *
 * Nothing is dropped either way, so the two sides can be put back together exactly as
 * they were written: a diff that loses a line break has rewritten the requirement it was
 * meant to be reporting on.
 */
export function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? []
}

/**
 * Above this many tokens on either side the table stops being worth building.
 *
 * A requirement is a sentence or two; anything at this length is a pasted document, and
 * spending a hundred million cells on it would freeze the editor for a diff nobody could
 * read anyway.
 */
const TOO_LONG = 1500

function lcsLengths(a: string[], b: string[]): Uint32Array {
  // One row per prefix of `a`, so the walk back can read any cell. Flat rather than
  // nested: the arrays are small in every real case and this is one allocation.
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  return table
}

function push(parts: DiffPart[], kind: DiffKind, text: string): void {
  const last = parts.at(-1)
  // Runs are joined as they are made: a sentence rewritten word for word would otherwise
  // come out as forty parts and be rendered as forty spans.
  if (last && last.kind === kind) last.text += text
  else parts.push({ kind, text })
}

export function diffWords(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: 'same', text: before }] : []
  const a = tokenize(before)
  const b = tokenize(after)
  if (a.length > TOO_LONG || b.length > TOO_LONG) {
    const parts: DiffPart[] = []
    if (before) parts.push({ kind: 'removed', text: before })
    if (after) parts.push({ kind: 'added', text: after })
    return parts
  }

  const width = b.length + 1
  const table = lcsLengths(a, b)
  const parts: DiffPart[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(parts, 'same', a[i])
      i++
      j++
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      push(parts, 'removed', a[i])
      i++
    } else {
      push(parts, 'added', b[j])
      j++
    }
  }
  while (i < a.length) push(parts, 'removed', a[i++])
  while (j < b.length) push(parts, 'added', b[j++])
  return parts
}

/**
 * Whether anything but whitespace moved. A reflowed sentence is not a new obligation.
 *
 * Both sides are rebuilt and compared rather than the changed parts being inspected:
 * spacing rides with the words, so a line break moving makes the word before it a
 * changed token, and asking "is there a non-empty change" would call that a rewrite.
 */
export function isMeaningfulDiff(parts: DiffPart[]): boolean {
  const side = (skip: DiffKind): string =>
    parts
      .filter((part) => part.kind !== skip)
      .map((part) => part.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
  return side('added') !== side('removed')
}

/** How many words came and went, for a line that says how big a change was without showing it. */
export function diffCounts(parts: DiffPart[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const part of parts) {
    if (part.kind === 'same') continue
    const words = tokenize(part.text).filter((token) => token.trim() !== '').length
    if (part.kind === 'added') added += words
    else removed += words
  }
  return { added, removed }
}
