import { namesOf } from './reqAlias'
import type { Requirement } from './Requirement'

/**
 * What a requirement is, and is not, tied to.
 *
 * The reason a requirements library is worth keeping separately from the documents that
 * quote it: not to admire the links, but to find where there are none. A requirement
 * nothing implements, nothing verifies and no document states is a commitment somebody
 * made and nobody is carrying, and it is invisible until the whole library is laid out
 * at once.
 */

export const COVERAGE_GAPS = ['uncited', 'unsatisfied', 'unverified', 'suspect', 'unwritten'] as const
export type CoverageGap = (typeof COVERAGE_GAPS)[number]

export interface Coverage {
  requirement: Requirement
  /** Notes holding a `pm-req` block that resolves to this requirement. */
  citedIn: string[]
  /** What claims to implement it: ticket ids, through `satisfied-by`. */
  satisfiedBy: string[]
  /** What it says it comes from. */
  derivesFrom: string[]
  /** What says it comes from this one — the direction nothing states on its own. */
  derivedBy: string[]
  gaps: CoverageGap[]
}

export interface CoverageInputs {
  library: Requirement[]
  /** Requirement id to the notes quoting it. */
  usage: Map<string, string[]>
  /** Which languages a wording is expected in, for telling written from unwritten. */
  languages: string[]
}

/** The relations that mean "this requirement stands above that one". */
const PARENT_KINDS = new Set(['derives-from', 'refines'])

/**
 * The whole library, laid out with its holes.
 *
 * `unsatisfied` is only claimed for a requirement nothing derives from either: a
 * high-level requirement is implemented by the requirements beneath it, and calling every
 * parent in a tree uncovered would bury the leaves that genuinely are.
 */
export function coverageOf(inputs: CoverageInputs): Coverage[] {
  const { library, usage, languages } = inputs
  const derivedBy = new Map<string, string[]>()
  // Resolved through every name a requirement answers to, so a link written in a
  // project's own numbering counts toward the same parent as one written in the
  // library's — otherwise a requirement covered by three children reads as uncovered.
  const canonical = new Map<string, string>()
  for (const requirement of library) {
    for (const name of namesOf(requirement)) canonical.set(name.toUpperCase(), requirement.id.toUpperCase())
  }
  for (const requirement of library) {
    for (const link of requirement.links) {
      if (!PARENT_KINDS.has(link.kind)) continue
      const parent = canonical.get(link.to.toUpperCase()) ?? link.to.toUpperCase()
      const children = derivedBy.get(parent)
      if (children) children.push(requirement.id)
      else derivedBy.set(parent, [requirement.id])
    }
  }

  return library.map((requirement) => {
    const citedIn = usage.get(requirement.id) ?? []
    const satisfiedBy = requirement.links.filter((link) => link.kind === 'satisfied-by').map((link) => link.to)
    const derivesFrom = requirement.links.filter((link) => PARENT_KINDS.has(link.kind)).map((link) => link.to)
    const children = derivedBy.get(requirement.id.toUpperCase()) ?? []

    const gaps: CoverageGap[] = []
    // Said first, because nothing else about a requirement matters until it has words.
    if (!languages.some((lang) => requirement.text[lang]) && !requirement.text[requirement.sourceLang]) {
      gaps.push('unwritten')
    }
    if (citedIn.length === 0) gaps.push('uncited')
    if (satisfiedBy.length === 0 && children.length === 0) gaps.push('unsatisfied')
    if (requirement.verification === 'none') gaps.push('unverified')
    if (requirement.links.some((link) => link.suspect === true)) gaps.push('suspect')

    return { requirement, citedIn, satisfiedBy, derivesFrom, derivedBy: children, gaps }
  })
}

export function hasGap(coverage: Coverage, gap: CoverageGap): boolean {
  return coverage.gaps.includes(gap)
}

/** How many requirements sit at each gap, for a bar that says where the work is. */
export function countGaps(rows: Coverage[]): Record<CoverageGap, number> {
  const counts = { uncited: 0, unsatisfied: 0, unverified: 0, suspect: 0, unwritten: 0 }
  for (const row of rows) {
    for (const gap of row.gaps) counts[gap] += 1
  }
  return counts
}
