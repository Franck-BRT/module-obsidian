/**
 * The columns a `pm-req` block can draw.
 *
 * Kept apart from the block itself because two very different things need this
 * vocabulary: the block parser, which reads a `fields:` line, and the settings, which
 * hold the list used when a block says nothing. A file that imports nothing at all can
 * be read by both without either one dragging the other in.
 */

export const REQ_BLOCK_FIELDS = [
  'id',
  'title',
  'text',
  'type',
  'status',
  'criticality',
  'verification',
  'rating'
] as const
export type ReqBlockField = (typeof REQ_BLOCK_FIELDS)[number]

export function isReqBlockField(value: unknown): value is ReqBlockField {
  return typeof value === 'string' && REQ_BLOCK_FIELDS.includes(value as ReqBlockField)
}

/**
 * What a block shows when it was not told, and the settings have not been touched.
 *
 * The rating is among them: a requirement quoted into a document is a requirement being
 * read by somebody who can still fix it, and the point of the stars is that they are
 * seen without being asked for. The trade-off stays visible though — a `pm-req` block
 * can end up in a specification sent to a supplier, and how well a requirement is
 * *written* is this organisation's business rather than theirs. One line drops it there:
 * `fields: id, text, status`.
 */
export const DEFAULT_REQ_BLOCK_FIELDS: readonly ReqBlockField[] = ['id', 'text', 'status', 'rating']

/**
 * A stored list made safe to draw.
 *
 * Settings come off disk, where a hand-edited `data.json` or a list written by an older
 * version can hold a column this build has never heard of. Unknown names are dropped
 * rather than refused, and a repeat is kept once: a column drawn twice is a bug the
 * reader would have to explain to themselves.
 */
export function cleanBlockFields(raw: unknown): ReqBlockField[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter(isReqBlockField))]
}

/**
 * The columns to draw, in order of who asked.
 *
 * The block wins, because a `fields:` line is somebody deciding about this document in
 * particular. Then the settings, which are the same decision made once for the vault.
 * Then the list this plugin ships with — reached when the settings hold nothing usable,
 * so that an empty list is a block that still reads rather than a blank one.
 */
export function resolveBlockFields(asked: ReqBlockField[], configured: unknown): ReqBlockField[] {
  if (asked.length) return asked
  const kept = cleanBlockFields(configured)
  // A copy of the built-in list, never the list itself: it is one array shared by every
  // block in the vault, and a caller that sorted it in place would rearrange all of them.
  return kept.length ? kept : [...DEFAULT_REQ_BLOCK_FIELDS]
}
