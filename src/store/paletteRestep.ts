import { RESTEPPED_COLORS } from '../types'

/** Anything the palettes are made of: a status, a priority. */
interface Colored {
  color: string
}

/**
 * Swaps a palette's old default colours for the re-stepped ones, in place.
 *
 * Only an exact old default is touched. A colour the user picked is theirs and is left
 * alone, and this runs once per vault, so the old value chosen deliberately later stays
 * chosen — a default is a starting point, never a correction applied behind someone.
 *
 * Returns whether anything changed, which is what tells the caller to save.
 */
export function restepPalette(items: Colored[]): boolean {
  let changed = false
  for (const item of items) {
    const next = RESTEPPED_COLORS[item.color.toLowerCase()]
    if (next && next !== item.color) {
      item.color = next
      changed = true
    }
  }
  return changed
}
