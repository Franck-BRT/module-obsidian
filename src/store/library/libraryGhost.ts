import { stringifyYaml } from 'obsidian'

/**
 * Ghosts: a document of the library shown in a folder it is not in.
 *
 * A document is kept once. Poured again into another folder — the same file, by its
 * fingerprint —, it is not copied: a ghost is left there instead, a small note that says
 * the document exists and where it is, and opens it. A document many folders need can be
 * put in a folder of reference, the folders it was in keeping a ghost of it.
 *
 * A ghost names its document by a link, which Obsidian keeps up to date as the document's
 * record moves, and by its fingerprint, which finds it when the link has been lost.
 */

export const GHOST_KEY = 'pm-library-ghost'

export interface LibraryGhost {
  /** The ghost's own note. */
  record: string
  /** The library's folder it is in: '' for the root. */
  folder: string
  /** What its link names, as written. */
  link: string
  hash: string
  title: string
}

export function isGhost(frontmatter: unknown): boolean {
  return (
    !!frontmatter && typeof frontmatter === 'object' && (frontmatter as Record<string, unknown>)[GHOST_KEY] === true
  )
}

export interface GhostWords {
  /** The line of its note, for a reader who opens it in Obsidian: « The document … is in … ». */
  line: (link: string, folder: string) => string
}

/** A ghost's note: what it stands for, then a line saying where the document is. */
export function ghostContent(
  doc: { record: string; title: string; hash: string; folder: string },
  words: GhostWords
): string {
  const link = `[[${doc.record}|${doc.title.replace(/[[\]|]/g, ' ')}]]`
  const properties = { [GHOST_KEY]: true, of: `[[${doc.record}]]`, title: doc.title, sha256: doc.hash }
  return `---\n${stringifyYaml(properties).trimEnd()}\n---\n\n${words.line(link, doc.folder)}\n`
}

/** The record a ghost stands for: by its link while it leads to a document, else by the fingerprint. */
export function ghostTarget<T extends { record: string; hash: string }>(
  ghost: Pick<LibraryGhost, 'hash'>,
  linked: T | undefined,
  docs: T[]
): T | undefined {
  if (linked) return linked
  return ghost.hash ? docs.find((doc) => doc.hash === ghost.hash) : undefined
}
