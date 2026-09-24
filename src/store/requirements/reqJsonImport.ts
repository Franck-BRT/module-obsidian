import type { Requirement } from './Requirement'
import { textOf } from './Requirement'
import { requirementFrontmatter } from './reqYaml'
import type { ReqJsonRead } from './reqJson'

/**
 * What a JSON file would do to the library, worked out before any of it is done.
 *
 * A JSON record holds everything a requirement is — its revision, its history, what each
 * translation was written from and whether anybody has read it — so importing one over an
 * existing requirement is not an update, it is a replacement. Saying "update" where the
 * thing that happens is "this note becomes that record" is how an import loses somebody's
 * afternoon.
 *
 * So the word here is replace, the plan says what would be replaced, and the counts are
 * what the button writes: nothing more.
 */

export type JsonAction = 'create' | 'replace' | 'unchanged' | 'invalid'

export type JsonReason = 'no-wording' | 'duplicate-id'

export interface JsonPlanRow {
  action: JsonAction
  id: string
  title: string
  /** The requirement as the file has it, ready to be written as it stands. */
  requirement: Requirement
  reason?: JsonReason
  /**
   * What a replacement would change, named: the languages whose wording differs, and
   * whichever of the links, the history and the fields are not the same.
   */
  changes: string[]
}

/** Every language either of them is written in, so a wording that only one has is a change. */
function languages(a: Requirement, b: Requirement): string[] {
  return [...new Set([...Object.keys(a.text), ...Object.keys(b.text)])].sort((x, y) => x.localeCompare(y))
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * What would change, in the words a reader thinks in.
 *
 * Compared against the note's own record rather than field by field: the file was written
 * from that record, so anything the comparison misses is something the export did not
 * carry — and that is a defect in the export, not a difference to report here.
 */
export function changedParts(before: Requirement, after: Requirement): string[] {
  const parts: string[] = []
  for (const lang of languages(before, after)) {
    if (!same(textOf(before, lang), textOf(after, lang))) parts.push(lang)
  }
  if (!same(before.links, after.links)) parts.push('links')
  if (!same(before.history, after.history)) parts.push('history')
  const fields = (requirement: Requirement): Record<string, unknown> => {
    const { text: _text, links: _links, history: _history, ...rest } = requirementFrontmatter(requirement)
    return rest
  }
  if (!same(fields(before), fields(after))) parts.push('fields')
  return parts
}

export function planJsonImport(read: ReqJsonRead, library: Requirement[]): JsonPlanRow[] {
  const held = new Map(library.map((requirement) => [requirement.id.toUpperCase(), requirement]))
  const seen = new Set<string>()
  return read.requirements.map((requirement): JsonPlanRow => {
    const key = requirement.id.toUpperCase()
    const row = { id: requirement.id, title: requirement.title, requirement, changes: [] as string[] }
    // A requirement that says nothing is not a requirement, whatever else the record
    // carries.
    if (!Object.values(requirement.text).some((wording) => wording.body.trim())) {
      return { ...row, action: 'invalid', reason: 'no-wording' }
    }
    if (seen.has(key)) return { ...row, action: 'invalid', reason: 'duplicate-id' }
    seen.add(key)

    const existing = held.get(key)
    if (!existing) return { ...row, action: 'create' }
    const changes = changedParts(existing, requirement)
    return changes.length ? { ...row, action: 'replace', changes } : { ...row, action: 'unchanged' }
  })
}

export function countJsonPlan(plan: JsonPlanRow[]): Record<JsonAction, number> {
  const counts: Record<JsonAction, number> = { create: 0, replace: 0, unchanged: 0, invalid: 0 }
  for (const row of plan) counts[row.action] += 1
  return counts
}
