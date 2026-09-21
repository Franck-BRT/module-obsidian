import { parseReqBlock, REQ_BLOCK_LANGUAGE, type ReqBlockSpec } from './reqBlock'

/**
 * Finding `pm-req` blocks in a note.
 *
 * Obsidian's metadata cache says a note has code blocks and where they are, but not what
 * language they are in or what they hold, so answering "which documents quote this
 * requirement" means reading the notes. The reading is done elsewhere; the understanding
 * is done here, where it can be proved without a vault.
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
 * Every `pm-req` block in a note, in order.
 *
 * Counted from the top rather than searched for: a fence looks the same opening and
 * closing, so the only way to know which one a line sits after is to have read the ones
 * before it. A closing fence carries no language and is of the same kind as its opening —
 * both rules matter, because a note about markdown quotes fences as text.
 */
export function reqBlockRanges(lines: string[]): FencedBlock[] {
  const found: FencedBlock[] = []
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
    if (match[3] !== '' || match[2][0] !== marker) continue
    if (language === REQ_BLOCK_LANGUAGE) found.push({ open, close: i, closed: true })
    open = -1
    language = ''
  }
  if (open !== -1 && language === REQ_BLOCK_LANGUAGE) {
    found.push({ open, close: lines.length - 1, closed: false })
  }
  return found
}

/** The `pm-req` block a line sits in, if it sits in one. Either fence counts as inside. */
export function reqBlockAt(lines: string[], cursorLine: number): FencedBlock | null {
  return reqBlockRanges(lines).find((block) => cursorLine >= block.open && cursorLine <= block.close) ?? null
}

export function blockBody(lines: string[], block: FencedBlock): string {
  return lines.slice(block.open + 1, block.closed ? block.close : lines.length).join('\n')
}

/** Every identifier a block already quotes, so a second pick does not quote it twice. */
export function idsInBlock(lines: string[], block: FencedBlock): string[] {
  const ids: string[] = []
  for (const line of blockBody(lines, block).split('\n')) {
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

/** What a note asks the library for, one entry per block it holds. */
export function reqSpecsIn(content: string): ReqBlockSpec[] {
  const lines = content.split('\n')
  return reqBlockRanges(lines).map((block) => parseReqBlock(blockBody(lines, block)))
}
