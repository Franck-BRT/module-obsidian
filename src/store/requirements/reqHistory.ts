import type { Requirement } from './Requirement'
import { textOf } from './Requirement'
import { diffWords, type DiffPart } from './reqDiff'

/**
 * A requirement's revisions, as something that can be read.
 *
 * What is stored on each change is what the wording said *before* it — which is the right
 * thing to store, because it is the only part that would otherwise be lost. Reading it
 * back means pairing each entry with what came next: the following entry's "before", or,
 * for the last one, the wording as it stands today.
 */

export interface RevisionStep {
  rev: number
  at: string
  by: string
  lang: string
  before: string
  after: string
  diff: DiffPart[]
}

/**
 * One language's changes, oldest first.
 *
 * In the order they were recorded. Not sorted, because the revision number is not an
 * order: several translations can be written at one revision of the source — that is
 * what catching up *is* — and the only thing that says which came first is that it was
 * appended first.
 */
export function revisionTimeline(requirement: Requirement, lang: string): RevisionStep[] {
  const entries = requirement.history.filter((entry) => entry.lang === lang)
  const current = textOf(requirement, lang)?.body ?? ''
  return entries.map((entry, index) => {
    const after = index + 1 < entries.length ? entries[index + 1].was : current
    return {
      rev: entry.rev,
      at: entry.at,
      by: entry.by,
      lang,
      before: entry.was,
      after,
      diff: diffWords(entry.was, after)
    }
  })
}

/** Every language this requirement has ever been changed in, in the order first touched. */
export function changedLanguages(requirement: Requirement): string[] {
  const seen: string[] = []
  for (const entry of requirement.history) {
    if (!seen.includes(entry.lang)) seen.push(entry.lang)
  }
  return seen
}
