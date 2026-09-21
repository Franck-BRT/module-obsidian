import { REQ_BLOCK_LANGUAGE } from '../../store/requirements/reqBlock'
import { idsInBlock, reqBlockAt } from '../../store/requirements/reqFence'

/**
 * Putting a citation where the author is writing.
 *
 * Quoting requirements happens one at a time and in a row — a paragraph of prose, then
 * three of them, then more prose — so picking a second one straight after a first should
 * extend the block that is already there rather than start another beside it. Working out
 * which of those two it is is the whole of this file, and it is pure so it can be proved
 * rather than clicked through.
 */

export interface ReqInsertion {
  /** The text to put in. */
  insert: string
  /** Where to put it, as a line and a column. */
  at: { line: number; ch: number }
}

/**
 * Where a chosen requirement goes.
 *
 * Null when the block the cursor is in already quotes it: inserting a duplicate would
 * render the same requirement twice, which reads as the document saying it twice.
 */
export function insertRequirement(lines: string[], cursorLine: number, id: string): ReqInsertion | null {
  const block = reqBlockAt(lines, cursorLine)
  if (block) {
    if (idsInBlock(lines, block).includes(id.toUpperCase())) return null
    // On the line the closing fence is on, which pushes the fence down: appended to the
    // end of the list rather than dropped wherever the cursor happened to rest, because
    // the order of a block is the order the author is quoting in.
    if (block.closed) return { insert: `${id}\n`, at: { line: block.close, ch: 0 } }
    // A block still being typed has no fence to push down, so the line goes after the
    // last one there is — never at a line past the end of the note, which is not a place.
    const last = lines.length - 1
    return { insert: `\n${id}`, at: { line: last, ch: lines[last].length } }
  }
  return {
    insert: `\`\`\`${REQ_BLOCK_LANGUAGE}\n${id}\n\`\`\`\n`,
    at: { line: cursorLine, ch: 0 }
  }
}
