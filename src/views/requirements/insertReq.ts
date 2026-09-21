import { REQ_BLOCK_LANGUAGE } from '../../store/requirements/reqBlock'

/**
 * Putting a citation where the author is writing.
 *
 * Quoting requirements happens one at a time and in a row — a paragraph of prose, then
 * three of them, then more prose — so picking a second one straight after a first should
 * extend the block that is already there rather than start another beside it. Working out
 * which of those two it is is the whole of this file, and it is pure so it can be proved
 * rather than clicked through.
 */

const FENCE = /^(\s*)(`{3,}|~{3,})\s*(\S*)\s*$/

export interface FencedBlock {
  /** The line the opening fence is on. */
  open: number
  /** The line the closing fence is on, or the last line when the block was never closed. */
  close: number
  closed: boolean
}

/**
 * The `pm-req` block the cursor is in, if it is in one.
 *
 * Counted from the top of the note rather than searched outward from the cursor: a fence
 * looks the same opening and closing, so the only way to know which one a line sits after
 * is to have read the ones before it.
 */
export function reqBlockAt(lines: string[], cursorLine: number): FencedBlock | null {
  let open = -1
  let language = ''
  let marker = ''
  for (let i = 0; i < lines.length; i++) {
    const match = FENCE.exec(lines[i])
    if (!match) continue
    if (open === -1) {
      open = i
      marker = match[2][0]
      language = match[3].toLowerCase()
      continue
    }
    // A closing fence carries no language and must be of the same kind as its opening.
    if (match[3] !== '' || match[2][0] !== marker) continue
    if (language === REQ_BLOCK_LANGUAGE && cursorLine >= open && cursorLine <= i) {
      return { open, close: i, closed: true }
    }
    open = -1
    language = ''
  }
  if (open !== -1 && language === REQ_BLOCK_LANGUAGE && cursorLine >= open) {
    return { open, close: lines.length - 1, closed: false }
  }
  return null
}

export interface ReqInsertion {
  /** The text to put in. */
  insert: string
  /** Where to put it, as a line and a column. */
  at: { line: number; ch: number }
}

/** Every identifier a block already quotes, so a second pick does not quote it twice. */
export function idsInBlock(lines: string[], block: FencedBlock): string[] {
  const body = lines.slice(block.open + 1, block.closed ? block.close : lines.length)
  const ids: string[] = []
  for (const line of body) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf(':')
    const key = at === -1 ? '' : trimmed.slice(0, at).trim().toLowerCase()
    if (at !== -1 && key !== 'id' && key !== 'ids') continue
    const value = at === -1 ? trimmed : trimmed.slice(at + 1)
    for (const piece of value.split(/[,;]/)) {
      const id = piece.trim()
      if (id) ids.push(id.toUpperCase())
    }
  }
  return ids
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
