/**
 * Requirement identifiers.
 *
 * The id is the requirement. A document cites it, a test verifies it, a ticket satisfies
 * it, and every one of those references outlives the wording. So an id is allocated once
 * and **never reused**: giving REQ-SYS-0042 to a new requirement after the old one was
 * deleted would silently re-point every reference that ever named it, in notes this
 * plugin cannot see and in documents that left the building years ago.
 *
 * Which is why the next number comes from the highest that has ever existed rather than
 * from a count of what is left.
 */

const PATTERN = /^([A-Z][A-Z0-9]*)-([A-Z0-9]+)-(\d+)$/

export interface ParsedReqId {
  prefix: string
  category: string
  number: number
}

export function parseReqId(id: string): ParsedReqId | null {
  const match = PATTERN.exec(id.trim().toUpperCase())
  if (!match) return null
  return { prefix: match[1], category: match[2], number: Number(match[3]) }
}

export function isReqId(id: string): boolean {
  return parseReqId(id) !== null
}

/**
 * A category as it appears inside an id: upper case, no separators.
 *
 * Whatever the reader types for a category — "Système de vol", "sys/flight" — has to
 * become something that can sit between two hyphens and still be read back out.
 */
export function idCategory(raw: string): string {
  const cleaned = raw
    .normalize('NFD')
    // Accents are dropped rather than transliterated: SYSTÈME and SYSTEME must not be two
    // categories, and an id is read aloud and typed by hand more often than it is copied.
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
  return cleaned || 'GEN'
}

export interface IdScheme {
  prefix: string
  /** How many digits the number is padded to. Widening it later breaks nothing. */
  width: number
}

export const DEFAULT_ID_SCHEME: IdScheme = { prefix: 'REQ', width: 4 }

export function formatReqId(scheme: IdScheme, category: string, number: number): string {
  return `${scheme.prefix}-${idCategory(category)}-${String(number).padStart(scheme.width, '0')}`
}

/**
 * The next free id in a category.
 *
 * `taken` is every id that has ever been seen, including the ones whose requirements are
 * gone: the highest wins, so a deleted 42 does not hand 42 to the next one written.
 * Numbers wider than the scheme are respected rather than truncated — an id imported from
 * elsewhere as REQ-SYS-100000 is still a number, and the count must clear it.
 */
export function nextReqId(scheme: IdScheme, category: string, taken: Iterable<string>): string {
  const wanted = idCategory(category)
  let highest = 0
  for (const id of taken) {
    const parsed = parseReqId(id)
    if (parsed === null) continue
    if (parsed.prefix !== scheme.prefix.toUpperCase() || parsed.category !== wanted) continue
    if (parsed.number > highest) highest = parsed.number
  }
  return formatReqId(scheme, wanted, highest + 1)
}

/**
 * The categories this library already numbers under.
 *
 * Offered when a requirement is created, because a category is not a free field in
 * practice: SYS and SYSTEME would be two counters, two families of identifiers and one
 * reader wondering which of them is the real one. Taken from the identifiers themselves
 * and from the counters, so a category whose last requirement was deleted is still
 * offered — it is still spoken for, and its next number still follows the old one.
 *
 * Only this library's own prefix: a supplier's REQ imported as SUP-ABC-0001 is numbered
 * under their scheme, and suggesting ABC here would mint one of ours onto their family.
 */
export function knownCategories(
  scheme: IdScheme,
  ids: Iterable<string>,
  counters: Record<string, number> = {}
): string[] {
  const seen = new Set(Object.keys(counters))
  for (const id of ids) {
    const parsed = parseReqId(id)
    if (parsed && parsed.prefix === scheme.prefix.toUpperCase()) seen.add(parsed.category)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/** A file name for a requirement: the id leads, so a folder sorts the way a register does. */
export function reqFileName(id: string, title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean ? `${id} ${clean}` : id
}
