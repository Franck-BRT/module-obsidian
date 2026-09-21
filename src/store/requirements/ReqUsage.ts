import { TFile, type App } from 'obsidian'
import type { Requirement } from './Requirement'
import { selectRequirements, type ReqBlockSpec } from './reqBlock'
import { reqSpecsIn } from './reqFence'

/**
 * Which documents quote which requirements.
 *
 * The question traceability is bought for, and the one nothing in the vault answers on
 * its own: a `pm-req` block lives in the body of a note, and Obsidian's metadata cache
 * reports that a note has code blocks without saying what language they are in or what
 * they hold. So the notes have to be read.
 *
 * Read once and remembered, keyed on the note's size and modification time, and only for
 * notes Obsidian says hold a code block at all — which in an ordinary vault is a small
 * minority of them.
 */

export interface NoteSpecs {
  path: string
  specs: ReqBlockSpec[]
}

/**
 * What each note ends up quoting, once its blocks are resolved against the library.
 *
 * Resolved at the moment of asking rather than when the note was read, because a block
 * that selects by category quotes whatever is in that category *now*: a requirement
 * created this morning is cited by a specification written last year, and a cache of
 * resolved identifiers would say it is cited by nothing.
 */
export function resolveUsage(notes: NoteSpecs[], library: Requirement[]): Map<string, string[]> {
  const usage = new Map<string, string[]>()
  for (const note of notes) {
    // One note quoting a requirement twice — in two blocks, or by id and by category —
    // is still one document citing it.
    const quoted = new Set<string>()
    for (const spec of note.specs) {
      for (const requirement of selectRequirements(spec, library).rows) quoted.add(requirement.id)
    }
    for (const id of quoted) {
      const paths = usage.get(id)
      if (paths) paths.push(note.path)
      else usage.set(id, [note.path])
    }
  }
  for (const paths of usage.values()) paths.sort((a, b) => a.localeCompare(b))
  return usage
}

export class ReqUsageIndex {
  private cache = new Map<string, { key: string; specs: ReqBlockSpec[] }>()

  constructor(
    private app: App,
    private library: () => Requirement[]
  ) {}

  /**
   * Reads whatever has changed since the last pass.
   *
   * A note whose size and modification time are what they were is not read again, so the
   * second pass over a vault costs nothing but the walk. A note that has stopped existing
   * is dropped, or a deleted specification would go on citing things forever.
   */
  async refresh(): Promise<void> {
    const seen = new Set<string>()
    for (const file of this.app.vault.getMarkdownFiles()) {
      seen.add(file.path)
      const key = `${file.stat.mtime}:${file.stat.size}`
      if (this.cache.get(file.path)?.key === key) continue
      this.cache.set(file.path, {
        key,
        specs: this.mightHoldBlock(file) ? reqSpecsIn(await this.app.vault.cachedRead(file)) : []
      })
    }
    const gone = [...this.cache.keys()].filter((path) => !seen.has(path))
    for (const path of gone) this.cache.delete(path)
  }

  /**
   * Whether it is worth opening this note at all.
   *
   * Obsidian has already parsed every note and knows where its code blocks are, though
   * not what is in them. A note with none cannot hold a `pm-req` block, and skipping
   * those is the difference between reading a vault and reading a handful of files.
   *
   * A note Obsidian has not parsed yet is read rather than assumed empty: being slow
   * about a note is recoverable, saying a document cites nothing is not.
   */
  private mightHoldBlock(file: TFile): boolean {
    const sections = this.app.metadataCache.getFileCache(file)?.sections
    return sections === undefined || sections.some((section) => section.type === 'code')
  }

  /** Requirement id to the notes quoting it, as the library stands now. */
  usage(): Map<string, string[]> {
    const notes = [...this.cache.entries()]
      .filter(([, entry]) => entry.specs.length > 0)
      .map(([path, entry]) => ({ path, specs: entry.specs }))
    return resolveUsage(notes, this.library())
  }
}
