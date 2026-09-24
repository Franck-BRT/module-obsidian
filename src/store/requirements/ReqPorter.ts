import { cleanAliases } from './reqAlias'
import type { JsonPlanRow } from './reqJsonImport'
import { normalizePath, TFile, type App } from 'obsidian'
import type { Requirement } from './Requirement'
import { addLink, makeRequirement, setText } from './Requirement'
import type { RequirementStore } from './RequirementStore'
import type { VaultIndex } from '../VaultIndex'
import type { CsvPlanRow, CsvValues } from './reqCsv'

/**
 * Writing an import, and putting an export somewhere.
 *
 * The plan is worked out elsewhere and without touching the vault; this is only the part
 * that writes, and it writes in the order the plan was shown so the count a person agreed
 * to is the count they get.
 */

export interface ImportOutcome {
  created: string[]
  updated: string[]
  failed: string[]
}

/** The fields a row carries, folded onto a requirement. Absent fields are left as they were. */
function applyValues(requirement: Requirement, values: CsvValues, by: string): Requirement {
  let next: Requirement = {
    ...requirement,
    ...(values.title === undefined ? {} : { title: values.title }),
    ...(values.category === undefined ? {} : { category: values.category }),
    ...(values.type === undefined ? {} : { type: values.type }),
    ...(values.status === undefined ? {} : { status: values.status }),
    ...(values.criticality === undefined ? {} : { criticality: values.criticality }),
    ...(values.verification === undefined ? {} : { verification: values.verification }),
    ...(values.source === undefined ? {} : { source: values.source }),
    ...(values.rationale === undefined ? {} : { rationale: values.rationale }),
    ...(values.owner === undefined ? {} : { owner: values.owner }),
    ...(values.tags === undefined ? {} : { tags: values.tags }),
    // Cleaned against the identifier it is landing on, so a spreadsheet cannot give a
    // requirement its own name a second time.
    ...(values.aliases === undefined ? {} : { aliases: cleanAliases(values.aliases, requirement.id) }),
    ...(values.sourceLang === undefined ? {} : { sourceLang: values.sourceLang })
  }
  // Through setText, never by assignment: an imported wording has to bump the revision
  // and mark the translations behind exactly as a typed one does, or a library updated
  // from a spreadsheet would quietly stop knowing what is out of date.
  for (const [lang, body] of Object.entries(values.text)) next = setText(next, lang, body, by)
  for (const link of values.links ?? []) next = addLink(next, link.kind, link.to)
  return next
}

export class ReqPorter {
  constructor(
    private app: App,
    private store: RequirementStore,
    private index: VaultIndex,
    private getFolder: () => string
  ) {}

  /**
   * Writes a plan.
   *
   * Rows the plan called invalid or unchanged are skipped rather than attempted: a person
   * looked at those counts and agreed to them, and quietly doing more than was shown is
   * the way an import loses somebody's trust for good.
   */
  async applyCsvPlan(plan: CsvPlanRow[], by: string): Promise<ImportOutcome> {
    const outcome: ImportOutcome = { created: [], updated: [], failed: [] }
    for (const row of plan) {
      if (row.action === 'invalid' || row.action === 'unchanged') continue
      try {
        if (row.action === 'create') await this.create(row, by, outcome)
        else await this.update(row, by, outcome)
      } catch {
        outcome.failed.push(row.id || row.title)
      }
    }
    return outcome
  }

  /**
   * Writes a JSON plan.
   *
   * A record is written as it stands: that is what a lossless format is for, and a
   * restore that helpfully bumped the revision, stamped today's date on a wording or
   * dropped a history would not be a restore.
   *
   * Which is also why replacing is only ever done to a row the plan called a replacement
   * and a person agreed to: the note that goes is somebody's work.
   */
  async applyJsonPlan(plan: JsonPlanRow[]): Promise<ImportOutcome> {
    const outcome: ImportOutcome = { created: [], updated: [], failed: [] }
    for (const row of plan) {
      if (row.action === 'invalid' || row.action === 'unchanged') continue
      try {
        if (row.action === 'create') await this.createFromRecord(row, outcome)
        else await this.replaceFromRecord(row, outcome)
      } catch {
        outcome.failed.push(row.id)
      }
    }
    return outcome
  }

  private async createFromRecord(row: JsonPlanRow, outcome: ImportOutcome): Promise<void> {
    // The identifier the file carries is kept, and the store's counter is carried past it
    // so nothing minted later lands on it.
    const created = await this.store.create({ ...row.requirement, filePath: undefined })
    if (created) outcome.created.push(created.id)
    else outcome.failed.push(row.id)
  }

  private async replaceFromRecord(row: JsonPlanRow, outcome: ImportOutcome): Promise<void> {
    const path = this.index.requirementById(row.id)?.filePath
    if (!path) {
      outcome.failed.push(row.id)
      return
    }
    const saved = await this.store.save(path, () => ({ ...row.requirement, filePath: path }))
    if (saved) outcome.updated.push(saved.requirement.id)
    else outcome.failed.push(row.id)
  }

  private async create(row: CsvPlanRow, by: string, outcome: ImportOutcome): Promise<void> {
    // An identifier the file carries is kept. The store mints one only where the file
    // gave none, and its counter clears whatever the file brought in either case.
    const seed = applyValues(makeRequirement({ id: row.id || undefined }), row.values, by)
    const created = await this.store.create({
      ...seed,
      ...(row.id ? { id: row.id } : {}),
      category: row.values.category ?? ''
    })
    if (!created) {
      outcome.failed.push(row.id || row.title)
      return
    }
    outcome.created.push(created.id)
  }

  private async update(row: CsvPlanRow, by: string, outcome: ImportOutcome): Promise<void> {
    const existing = this.index.requirementById(row.id)
    const path = existing?.filePath
    if (!path) {
      outcome.failed.push(row.id)
      return
    }
    const saved = await this.store.save(path, (current) => applyValues(current, row.values, by))
    if (saved) outcome.updated.push(saved.requirement.id)
    else outcome.failed.push(row.id)
  }

  /**
   * Puts an export in the vault, beside the library.
   *
   * Into the vault rather than through a save dialog, because Obsidian has no save dialog
   * on every platform it runs on and because a file in the vault is one the reader can
   * find again tomorrow without remembering where they put it.
   *
   * Two of them, because a Word file is not text: a ZIP written through the text API
   * comes back corrupted — every byte above 127 replaced on the way in — and the archive
   * no longer opens.
   */
  async writeBinaryExport(name: string, data: ArrayBuffer): Promise<string> {
    const path = await this.exportPath(name)
    const existing = this.app.vault.getAbstractFileByPath(path)
    if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, data)
    else await this.app.vault.createBinary(path, data)
    return path
  }

  private async exportPath(name: string): Promise<string> {
    const folder = this.getFolder()
    const home = normalizePath(folder ? `${folder}/_exports` : '_exports')
    if (!this.app.vault.getAbstractFileByPath(home)) {
      await this.app.vault.createFolder(home).catch(() => {})
    }
    return normalizePath(`${home}/${name}`)
  }

  async writeExport(name: string, contents: string): Promise<string> {
    const path = await this.exportPath(name)
    const existing = this.app.vault.getAbstractFileByPath(path)
    // Overwritten rather than numbered: an export is a copy of what is in the library
    // right now, and a folder of Export-1, Export-2, Export-3 helps nobody.
    if (existing instanceof TFile) await this.app.vault.modify(existing, contents)
    else await this.app.vault.create(path, contents)
    return path
  }
}

/** A file name that says what it holds and when it was taken. */
export function exportFileName(base: string, extension: string, at = new Date()): string {
  const day = at.toISOString().slice(0, 10)
  return `${base} ${day}.${extension}`
}
