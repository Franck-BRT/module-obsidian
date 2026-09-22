import { normalizePath, Notice, TFile } from 'obsidian'
import type { App } from 'obsidian'
import { t } from '../../i18n'
import { sanitizeFileName } from '../../utils'
import { appendYaml, parseFrontmatter } from '../YamlParser'
import { foreignFrontmatter } from '../YamlSerializer'
import type { Requirement } from './Requirement'
import {
  baselineFrontmatter,
  BASELINE_FRONTMATTER_KEYS,
  hydrateBaseline,
  makeBaseline,
  serializeBaselineBody,
  type Baseline
} from './Baseline'

/**
 * Reads and writes baseline notes.
 *
 * Write-once in practice: a baseline that can be edited is not a baseline. Nothing here
 * updates one, and the note is a plain document afterwards — if somebody wants to correct
 * a record of what was agreed, they can, in the open, with git to show it, which is the
 * right amount of ceremony for a vault.
 */
export class BaselineStore {
  constructor(
    private app: App,
    private getFolder: () => string
  ) {}

  baselineFilePath(name: string, folder: string): string {
    const clean = sanitizeFileName(name) || 'Baseline'
    const home = folder ? `${folder}/_baselines` : '_baselines'
    return normalizePath(`${home}/${clean}.md`)
  }

  async create(
    name: string,
    requirements: Requirement[],
    over: { by?: string; scope?: string; note?: string } = {}
  ): Promise<Baseline | null> {
    const path = this.baselineFilePath(name, this.getFolder())
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(t('field.nameTaken'))
      return null
    }
    const baseline = makeBaseline(name, requirements, over)
    const folder = path.slice(0, path.lastIndexOf('/'))
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {})
    }
    await this.app.vault.create(path, serialize(baseline))
    return { ...baseline, filePath: path }
  }

  /**
   * Throws one away.
   *
   * To the vault's own trash, never straight off the disk: a baseline is a record of what
   * was agreed, and somebody deleting the wrong one at five o'clock on a Friday has to be
   * able to get it back. The requirements are not touched — a baseline holds a copy of
   * what they said, never the notes themselves.
   */
  async delete(path: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path))
    if (!(file instanceof TFile)) return false
    await this.app.fileManager.trashFile(file)
    return true
  }

  /** The whole baseline, entries and all. The index holds only what is in frontmatter. */
  async load(path: string): Promise<Baseline | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path))
    if (!(file instanceof TFile)) return null
    const { frontmatter, body } = parseFrontmatter(await this.app.vault.cachedRead(file))
    if (!frontmatter) return null
    return hydrateBaseline(frontmatter, body, file.path)
  }
}

function serialize(baseline: Baseline, foreign: Record<string, unknown> = {}): string {
  const lines: string[] = ['---']
  appendYaml(lines, { ...baselineFrontmatter(baseline), ...foreignFrontmatter(foreign, BASELINE_FRONTMATTER_KEYS) }, 0)
  lines.push('---', '')
  lines.push(serializeBaselineBody(baseline))
  return lines.join('\n')
}
