import type { Requirement } from './Requirement'
import { hydrateRequirement, requirementFrontmatter } from './reqYaml'
import { csvLanguages } from './reqCsv'

/**
 * The library as data.
 *
 * The other six exports are documents: they decide what a reader sees and drop what a
 * reader does not need. This one drops nothing. It is for the script, the dashboard and
 * the other vault — anything that will read the library rather than look at it.
 *
 * Which is why each record is exactly what the note holds, key for key: the same
 * function that writes a requirement's frontmatter writes its record here. A second
 * shape, however tidy, would be a second thing to keep in step with the first, and the
 * day they disagreed the file would still look perfectly well-formed.
 */

export const REQ_JSON_FORMAT = 'black-projects/requirements'
export const REQ_JSON_VERSION = 1

export interface ReqJsonOptions {
  exported: string
  /** Named in the file so a reader knows what to expect before parsing four hundred records. */
  languages?: string[]
}

export interface ReqJsonFile {
  format: string
  version: number
  exported: string
  languages: string[]
  count: number
  requirements: Record<string, unknown>[]
}

/**
 * Written sorted and indented.
 *
 * A JSON export lands in a repository as often as in a script, and the only thing that
 * makes two of them comparable is that the same library gives the same bytes. Sorted by
 * identifier, two spaces, one record per block: a diff then shows what changed rather
 * than that something did.
 */
export function toReqJson(requirements: Requirement[], options: ReqJsonOptions): string {
  const sorted = [...requirements].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  const file: ReqJsonFile = {
    format: REQ_JSON_FORMAT,
    version: REQ_JSON_VERSION,
    exported: options.exported,
    languages: options.languages ?? csvLanguages(sorted),
    count: sorted.length,
    requirements: sorted.map((requirement) => requirementFrontmatter(requirement))
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

export interface ReqJsonRead {
  requirements: Requirement[]
  /** What could not be read, named rather than skipped. */
  problems: string[]
}

/**
 * The same file, read back.
 *
 * Here so that the export can be proved lossless rather than asserted to be: a record
 * that goes out and comes back the same requirement is the only evidence that the file
 * holds everything. It reads through the note reader, for the same reason it writes
 * through the note writer.
 */
export function readReqJson(text: string): ReqJsonRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { requirements: [], problems: [error instanceof Error ? error.message : String(error)] }
  }
  if (typeof parsed !== 'object' || parsed === null) return { requirements: [], problems: ['not an object'] }
  const file = parsed as Partial<ReqJsonFile>
  const problems: string[] = []
  if (file.format !== REQ_JSON_FORMAT) problems.push(`format: ${String(file.format)}`)
  // A version from the future is read as far as it can be rather than refused: the
  // fields this build knows are still the fields it knows.
  if (typeof file.version === 'number' && file.version > REQ_JSON_VERSION) problems.push(`version: ${file.version}`)
  const rows = Array.isArray(file.requirements) ? file.requirements : []
  const requirements: Requirement[] = []
  rows.forEach((row, at) => {
    if (typeof row !== 'object' || row === null) {
      problems.push(`requirements[${at}]: not an object`)
      return
    }
    const record: Record<string, unknown> = row
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id) {
      problems.push(`requirements[${at}]: no identifier`)
      return
    }
    requirements.push(hydrateRequirement(record, ''))
  })
  return { requirements, problems }
}
