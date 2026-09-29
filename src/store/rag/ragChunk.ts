import { passagesOf } from '../chat/libraryRetrieval'

/**
 * A note or a document cut into passages a search can find one at a time, each knowing
 * where it stands: under which headings, in which document. A passage read alone — « la
 * borne haute a été ramenée à 30 °C » — says little; « Spécification thermique ›
 * Maintien en température » in front of it says what it is about, to the embedding that
 * places it and to the model that reads it.
 */

export interface RagChunk {
  /** The headings it is under, outermost first, joined: « Exigences › Alimentation ». */
  heading: string
  text: string
}

/** A passage's size, in characters: a few paragraphs, well within what an embedding model reads. */
export const CHUNK_SIZE = 1100

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/

interface Section {
  path: string[]
  text: string
}

/** The text by its headings: each run of lines with the headings above it. */
function sections(text: string): Section[] {
  const out: Section[] = []
  const path: string[] = []
  let lines: string[] = []
  let fence = false
  const flush = (): void => {
    const body = lines.join('\n').trim()
    if (body) out.push({ path: [...path], text: body })
    lines = []
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const heading = fence ? null : HEADING.exec(line)
    if (!heading) {
      lines.push(line)
      continue
    }
    flush()
    const level = heading[1].length
    path.length = Math.min(path.length, level - 1)
    while (path.length < level - 1) path.push('')
    path.push(heading[2].replace(/[*_`]/g, '').trim())
  }
  flush()
  return out
}

const named = (path: string[]): string => path.filter(Boolean).join(' › ')

/**
 * A table cut in two keeps its header: a row of figures without the line naming its
 * columns means nothing to whoever reads it alone.
 */
function withTableHeaders(section: string, pieces: string[]): string[] {
  const lines = section.split('\n')
  let cursor = 0
  return pieces.map((piece) => {
    const at = section.indexOf(piece, cursor)
    if (at >= 0) cursor = at + piece.length
    if (at <= 0 || !piece.startsWith('|')) return piece
    // The table's first row: the line starting with a bar after one that does not.
    const before = section.slice(0, at).split('\n').length - 1
    let header = before
    while (header > 0 && lines[header - 1].trimStart().startsWith('|')) header--
    const row = lines[header]
    return row && header < before && !piece.startsWith(row) ? `${row}\n${piece}` : piece
  })
}

/**
 * A text cut into passages by its headings, each passage whole paragraphs of about
 * `size` characters; short sections side by side are kept together, their headings in
 * the text, so a note of twenty one-line headings is not twenty passages of one line.
 */
export function chunkText(text: string, size = CHUNK_SIZE): RagChunk[] {
  const pieces: RagChunk[] = []
  for (const section of sections(text)) {
    const cut = withTableHeaders(section.text, passagesOf(section.text, size))
    for (const piece of cut) pieces.push({ heading: named(section.path), text: piece })
  }
  // Short neighbours together, under what their headings share.
  const merged: (RagChunk & { paths: string[] })[] = []
  for (const piece of pieces) {
    const last = merged[merged.length - 1]
    const alone = piece.heading ? `${piece.heading.split(' › ').pop()}\n${piece.text}` : piece.text
    if (last && last.text.length < size / 2 && piece.text.length < size / 2 && last.text.length + alone.length < size) {
      if (last.paths.length === 1 && last.heading) {
        last.text = `${last.heading.split(' › ').pop()}\n${last.text}`
      }
      last.paths.push(piece.heading)
      last.text = `${last.text}\n\n${alone}`
      last.heading = shared(last.paths)
      continue
    }
    merged.push({ ...piece, paths: [piece.heading] })
  }
  return merged.map(({ heading, text: body }) => ({ heading, text: body }))
}

/** What several heading paths have in common, from the outermost. */
function shared(paths: string[]): string {
  const split = paths.map((path) => (path ? path.split(' › ') : []))
  const common: string[] = []
  for (let at = 0; split.every((parts) => at < parts.length && parts[at] === split[0][at]); at++) {
    common.push(split[0][at])
  }
  return common.join(' › ')
}

/** Properties that only the plugin reads, and say nothing of what a note is about. */
const PLUMBING = /^(pm-|position$|id$|projectId$|parentId$|dependencies$|order$|cssclasses$|color$|sha256$|size$)/

/**
 * A note's properties as lines a search can find and a model can read — « status: en
 * cours », « assignee: Anne » —, without those only the plugin reads, links shown by
 * their names.
 */
export function propertyLines(frontmatter: Record<string, unknown> | undefined, limit = 600): string {
  if (!frontmatter) return ''
  const shown = (value: unknown): string => {
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (typeof value !== 'string') return ''
    const named = (_all: string, path: string, name: string): string => name || path.replace(/^.*\//, '')
    return value.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, named).trim()
  }
  const lines: string[] = []
  for (const [key, raw] of Object.entries(frontmatter)) {
    if (PLUMBING.test(key)) continue
    const value = Array.isArray(raw) ? raw.map(shown).filter(Boolean).join(', ') : shown(raw)
    if (value) lines.push(`${key}: ${value}`)
  }
  const joined = lines.join('\n')
  return joined.length > limit
    ? `${joined.slice(0, joined.lastIndexOf('\n', limit) > 0 ? joined.lastIndexOf('\n', limit) : limit)}`
    : joined
}

/** What an embedding is made from: where the passage stands, then the passage. */
export function embeddingInput(title: string, chunk: RagChunk): string {
  const where = [title, chunk.heading].filter(Boolean).join(' › ')
  return where ? `${where}\n\n${chunk.text}` : chunk.text
}
