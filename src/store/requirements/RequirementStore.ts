import { normalizePath, Notice, TFile } from 'obsidian'
import type { App } from 'obsidian'
import type { RequirementSettings } from '../../types'
import { t } from '../../i18n'
import type { VaultIndex } from '../VaultIndex'
import { parseFrontmatter } from '../YamlParser'
import { foreignFrontmatter } from '../YamlSerializer'
import type { Requirement } from './Requirement'
import { makeRequirement, markLinksToward } from './Requirement'
import {
  DEFAULT_ID_SCHEME,
  formatReqId,
  idCategory,
  isReqId,
  nextReqId,
  parseReqId,
  reqFileName,
  type IdScheme
} from './reqId'
import { requirementBodyRemainder, serializeRequirement } from './reqNote'
import { hydrateRequirement, REQUIREMENT_FRONTMATTER_KEY, REQUIREMENT_FRONTMATTER_KEYS } from './reqYaml'

/**
 * Reads and writes requirement notes.
 *
 * Thin, like the collection store: a requirement owns no folder and no children, so there
 * is nothing to keep in sync. The one thing that is not thin is the identifier, which is
 * the whole point of the library and the one thing that must never be got wrong.
 */

/**
 * The next free id, and the counter that has to be remembered afterwards.
 *
 * Two sources, deliberately. The library says what exists; the counter says what has ever
 * existed. Taking the higher of the two means a deleted REQ-SYS-0042 never comes back —
 * and that a library imported into a fresh vault, whose counters are empty, still gets
 * ids above what is already in it rather than colliding with all of it.
 */
export function allocateReqId(
  scheme: IdScheme,
  category: string,
  liveIds: Iterable<string>,
  counters: Record<string, number>
): { id: string; counters: Record<string, number> } {
  const key = idCategory(category)
  const fromLibrary = parseReqId(nextReqId(scheme, key, liveIds))?.number ?? 1
  const fromCounter = (counters[key] ?? 0) + 1
  const number = Math.max(fromLibrary, fromCounter)
  return { id: formatReqId(scheme, key, number), counters: { ...counters, [key]: number } }
}

/**
 * The counters, raised to clear an identifier that came from outside.
 *
 * Only where the prefix is this library's: a file numbered under somebody else's scheme
 * is not something to count, and folding it into our own count would push every future
 * identifier up by however large their numbers happen to be.
 */
export function counterPast(scheme: IdScheme, counters: Record<string, number>, id: string): Record<string, number> {
  const parsed = parseReqId(id)
  if (!parsed || parsed.prefix !== scheme.prefix.toUpperCase()) return counters
  const held = counters[parsed.category] ?? 0
  return parsed.number > held ? { ...counters, [parsed.category]: parsed.number } : counters
}

export function schemeOf(settings: RequirementSettings): IdScheme {
  const prefix = settings.idPrefix
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  const width =
    Number.isFinite(settings.idWidth) && settings.idWidth > 0 ? Math.floor(settings.idWidth) : DEFAULT_ID_SCHEME.width
  return { prefix: prefix || DEFAULT_ID_SCHEME.prefix, width }
}

export class RequirementStore {
  constructor(
    private app: App,
    private getSettings: () => RequirementSettings,
    private saveSettings: () => Promise<void>,
    private index: VaultIndex
  ) {}

  requirementFilePath(id: string, title: string, folder: string): string {
    const name = reqFileName(id, title)
    return normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`)
  }

  /**
   * Mints a requirement and writes it.
   *
   * The counter is saved before the note: if the write fails, the number is burnt and the
   * next requirement gets the one after. Burning a number costs nothing; handing the same
   * one out twice costs traceability.
   */
  async create(over: Partial<Requirement> = {}): Promise<Requirement | null> {
    const settings = this.getSettings()
    const scheme = schemeOf(settings)
    const wanted = (over.id ?? '').trim()
    // An identifier the caller brings — an import carrying a supplier's numbering — is
    // kept rather than replaced, because renumbering somebody's requirements breaks every
    // reference in their documents. The counter is carried past it either way, so nothing
    // is ever minted onto a number that has already been used.
    const brought = isReqId(wanted) ? wanted : ''
    const allocated = allocateReqId(scheme, over.category ?? '', this.index.requirementIds(), settings.counters)
    const id = brought || allocated.id
    settings.counters = brought ? counterPast(scheme, settings.counters, brought) : allocated.counters
    await this.saveSettings()

    const sourceLang = over.sourceLang ?? settings.languages[0] ?? 'fr'
    const requirement = makeRequirement({ ...over, id, sourceLang })
    const path = this.requirementFilePath(id, requirement.title, settings.folder)
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(t('field.nameTaken'))
      return null
    }
    const written = { ...requirement, filePath: path }
    await this.write(written)
    return written
  }

  async load(path: string): Promise<Requirement | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path))
    if (!(file instanceof TFile)) return null
    const { frontmatter } = parseFrontmatter(await this.app.vault.cachedRead(file))
    if (!frontmatter || frontmatter[REQUIREMENT_FRONTMATTER_KEY] !== true) return null
    return hydrateRequirement(frontmatter, file.path)
  }

  /** Reads, applies, writes. Nothing else touches these notes, so no queue is needed. */
  async update(path: string, change: (requirement: Requirement) => Requirement): Promise<Requirement | null> {
    const current = await this.load(path)
    if (!current) return null
    const next = change(current)
    // An unchanged requirement is not written at all: `setText` returns the same object
    // when the words did not move, and a save that rewrites the note anyway would put a
    // new mtime on every requirement an editor merely looked at.
    if (next === current) return current
    await this.write({ ...next, filePath: path })
    return next
  }

  /**
   * Writes, then moves the note if its name no longer matches what it holds.
   *
   * Reports where the requirement now lives, which is not always where it was asked to be
   * written: naming a requirement renames its note, and an editor that goes on saving to
   * the path it opened would write its next edit to a file that is no longer there.
   */
  async save(
    path: string,
    change: (requirement: Requirement) => Requirement
  ): Promise<{ requirement: Requirement; path: string } | null> {
    const before = await this.load(path)
    const saved = await this.update(path, change)
    if (!saved) return null
    // Only when the source wording actually moved. Every other edit — a status, an owner,
    // a translation catching up — leaves what the neighbours said about it true.
    if (before && saved.rev !== before.rev) await this.markDependentsSuspect(saved.id)
    const moved = (await this.syncFileName({ ...saved, filePath: path })) ?? path
    return { requirement: { ...saved, filePath: moved }, path: moved }
  }

  /**
   * Tells the requirements that rely on this one that they were written against words it
   * no longer has.
   *
   * The far ends are marked rather than the near one, because that is the direction a
   * review has to act in: REQ-A says it derives from REQ-B, REQ-B was rewritten, and it
   * is REQ-A that now needs somebody to look. Only a person clears the mark — the tool
   * can see that a relation may no longer hold and cannot see that it still does.
   *
   * Reports the ids it marked, and marks nothing twice: a requirement already flagged is
   * left untouched rather than rewritten, or a vault would never settle.
   */
  async markDependentsSuspect(id: string): Promise<string[]> {
    const marked: string[] = []
    for (const dependent of this.index.requirementsLinkingTo(id)) {
      const path = dependent.filePath
      if (!path) continue
      const saved = await this.update(path, (current) => markLinksToward(current, id))
      if (saved) marked.push(saved.id)
    }
    return marked
  }

  /**
   * Renames the note to match the id and title, keeping every link to it.
   *
   * The id leads the file name, so a folder of requirements sorts the way a register
   * does; when a title is rewritten the file has to follow or the folder stops being
   * readable. `fileManager.renameFile` is what updates the wikilinks pointing at it.
   */
  async syncFileName(requirement: Requirement): Promise<string | null> {
    const current = requirement.filePath
    if (!current) return null
    const file = this.app.vault.getAbstractFileByPath(current)
    if (!(file instanceof TFile)) return null
    const folder = current.slice(0, current.lastIndexOf('/'))
    const wanted = this.requirementFilePath(requirement.id, requirement.title, folder)
    if (wanted === current || this.app.vault.getAbstractFileByPath(wanted)) return null
    await this.app.fileManager.renameFile(file, wanted)
    return wanted
  }

  async write(requirement: Requirement): Promise<void> {
    const path = requirement.filePath
    if (!path) return
    const file = this.app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) {
      await this.app.vault.process(file, (content) => {
        const { frontmatter, body } = parseFrontmatter(content)
        return serializeRequirement(
          requirement,
          foreignFrontmatter(frontmatter, REQUIREMENT_FRONTMATTER_KEYS),
          // Whatever the reader typed under the generated sections is theirs to keep.
          requirementBodyRemainder(body, requirement)
        )
      })
      return
    }
    const folder = path.slice(0, path.lastIndexOf('/'))
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {})
    }
    await this.app.vault.create(path, serializeRequirement(requirement))
  }
}
