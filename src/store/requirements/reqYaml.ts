import type { Requirement, ReqLink, ReqRevision, ReqText, VerificationMethod } from './Requirement'
import { makeRequirement, REQ_LINK_KINDS, VERIFICATION_METHODS } from './Requirement'

/**
 * A requirement on disk.
 *
 * Frontmatter, like every other thing this plugin keeps, so a requirement is greppable,
 * diffable by git and readable in ten years without the plugin that wrote it. The wording
 * lives in the frontmatter too rather than in the note body: a requirement has several
 * wordings and exactly one of them would fit in a body.
 */

export const REQUIREMENT_FRONTMATTER_KEY = 'pm-requirement'

export const REQUIREMENT_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  REQUIREMENT_FRONTMATTER_KEY,
  'id',
  'title',
  'category',
  'type',
  'status',
  'criticality',
  'verification',
  'source',
  'rationale',
  'owner',
  'tags',
  'sourceLang',
  'rev',
  'text',
  'links',
  'history',
  'createdAt',
  'updatedAt'
])

function str(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw : fallback
}

function strList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : []
}

function posInt(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

function readVerification(raw: unknown): VerificationMethod {
  return VERIFICATION_METHODS.includes(raw as VerificationMethod) ? (raw as VerificationMethod) : 'none'
}

/**
 * One language's wording as it was stored.
 *
 * A note edited by hand may hold nothing but a string where the plugin writes an object —
 * `en: "The system shall…"` is what a person naturally types — and reading that as an
 * absent translation would lose what they wrote.
 */
function readText(raw: unknown, rev: number): ReqText | null {
  if (typeof raw === 'string') {
    return raw.trim() ? { body: raw, fromRev: rev, at: '', by: '', origin: 'human', reviewed: true } : null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  const body = str(row.body)
  if (!body.trim()) return null
  return {
    body,
    fromRev: posInt(row.fromRev, rev),
    at: str(row.at),
    by: str(row.by),
    origin: row.origin === 'machine' ? 'machine' : 'human',
    // Only an explicit false unreviews a wording: a note that says nothing about it is a
    // note written before the field existed, and calling that unreviewed would light up
    // a whole library at once.
    reviewed: row.reviewed !== false
  }
}

function readLinks(raw: unknown): ReqLink[] {
  if (!Array.isArray(raw)) return []
  const out: ReqLink[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const entry = row as Record<string, unknown>
    const kind = entry.kind
    const to = str(entry.to).trim()
    if (!to || !REQ_LINK_KINDS.includes(kind as ReqLink['kind'])) continue
    out.push({ kind: kind as ReqLink['kind'], to, ...(entry.suspect === true ? { suspect: true } : {}) })
  }
  return out
}

function readHistory(raw: unknown): ReqRevision[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      rev: posInt(row.rev, 1),
      at: str(row.at),
      by: str(row.by),
      lang: str(row.lang),
      was: str(row.was),
      note: str(row.note)
    }))
}

export function hydrateRequirement(frontmatter: Record<string, unknown>, filePath: string): Requirement {
  const rev = posInt(frontmatter.rev, 1)
  const text: Record<string, ReqText> = {}
  const rawText = frontmatter.text
  if (typeof rawText === 'object' && rawText !== null) {
    for (const [lang, value] of Object.entries(rawText as Record<string, unknown>)) {
      const held = readText(value, rev)
      if (held) text[lang] = held
    }
  }
  return makeRequirement({
    id: str(frontmatter.id, filePath),
    title: str(frontmatter.title),
    category: str(frontmatter.category),
    type: str(frontmatter.type),
    status: str(frontmatter.status),
    criticality: str(frontmatter.criticality),
    verification: readVerification(frontmatter.verification),
    source: str(frontmatter.source),
    rationale: str(frontmatter.rationale),
    owner: str(frontmatter.owner),
    tags: strList(frontmatter.tags),
    sourceLang: str(frontmatter.sourceLang, 'fr'),
    rev,
    text,
    links: readLinks(frontmatter.links),
    history: readHistory(frontmatter.history),
    createdAt: str(frontmatter.createdAt),
    updatedAt: str(frontmatter.updatedAt),
    filePath
  })
}

/**
 * What goes back into the note.
 *
 * Empty fields are left out rather than written as blanks: a requirement that says
 * nothing about its rationale should have no rationale line, so that opening the note
 * shows what was actually filled in.
 */
export function requirementFrontmatter(requirement: Requirement): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    [REQUIREMENT_FRONTMATTER_KEY]: true,
    id: requirement.id,
    title: requirement.title,
    sourceLang: requirement.sourceLang,
    rev: requirement.rev,
    text: Object.fromEntries(
      Object.entries(requirement.text).map(([lang, held]) => [
        lang,
        {
          body: held.body,
          fromRev: held.fromRev,
          at: held.at,
          by: held.by,
          origin: held.origin,
          reviewed: held.reviewed
        }
      ])
    ),
    createdAt: requirement.createdAt,
    updatedAt: requirement.updatedAt
  }
  for (const key of ['category', 'type', 'status', 'criticality', 'source', 'rationale', 'owner'] as const) {
    if (requirement[key]) fm[key] = requirement[key]
  }
  if (requirement.verification !== 'none') fm.verification = requirement.verification
  if (requirement.tags.length) fm.tags = requirement.tags
  if (requirement.links.length) fm.links = requirement.links
  if (requirement.history.length) fm.history = requirement.history
  return fm
}
