import type { XlsxSheet, XlsxValue } from '../xlsx'
import type { Coverage } from './ReqCoverage'
import type { Requirement } from './Requirement'
import { namesOf } from './reqAlias'
import { csvLanguages } from './reqCsv'
import { assessRequirement } from './reqScore'

/**
 * The library as a spreadsheet.
 *
 * The same columns the CSV carries, so the two say the same thing, plus the two a
 * spreadsheet is actually opened for: the rating, which is the column somebody sorts by
 * when deciding what to rewrite first, and the holes, which is the column somebody filters
 * on when deciding what to finish. Both are worked out rather than stored, which is
 * exactly why they belong in a file nobody reads back in.
 */

export interface XlsxWords {
  /** One label per column, in the reader's language. */
  columns: {
    id: string
    title: string
    category: string
    type: string
    status: string
    criticality: string
    verification: string
    source: string
    rationale: string
    owner: string
    tags: string
    aliases: string
    sourceLang: string
    rev: string
    links: string
    rating: string
    citedIn: string
    satisfiedBy: string
    derivedBy: string
    gaps: string
  }
  sheet: { requirements: string; trace: string }
  /** A field's value as the reader sees it on screen rather than as it is stored. */
  glyph: (requirement: Requirement, field: 'type' | 'status' | 'criticality' | 'verification') => string
  gap: (gap: string) => string
  /** A cited note's path, as its name. */
  note: (path: string) => string
}

export function requirementsSheet(requirements: Requirement[], langs: string[], words: XlsxWords): XlsxSheet {
  const columns = [
    { label: words.columns.id, width: 18 },
    { label: words.columns.title, width: 34 },
    { label: words.columns.category, width: 12 },
    { label: words.columns.type, width: 14 },
    { label: words.columns.status, width: 14 },
    { label: words.columns.criticality, width: 12 },
    { label: words.columns.verification, width: 14 },
    { label: words.columns.rating, width: 8 },
    { label: words.columns.source, width: 24 },
    { label: words.columns.rationale, width: 40, wrap: true },
    { label: words.columns.owner, width: 18 },
    { label: words.columns.tags, width: 18 },
    { label: words.columns.aliases, width: 20 },
    { label: words.columns.sourceLang, width: 8 },
    { label: words.columns.rev, width: 6 },
    { label: words.columns.links, width: 28, wrap: true },
    ...langs.map((lang) => ({ label: lang.toUpperCase(), width: 60, wrap: true }))
  ]
  const rows = requirements.map((requirement): XlsxValue[] => [
    requirement.id,
    requirement.title,
    requirement.category,
    words.glyph(requirement, 'type'),
    words.glyph(requirement, 'status'),
    words.glyph(requirement, 'criticality'),
    words.glyph(requirement, 'verification'),
    // A number, so the column sorts as one: a rating written "4/5" sorts as text and puts
    // 10 between 1 and 2.
    Math.round(assessRequirement(requirement, langs).score * 100),
    requirement.source,
    requirement.rationale,
    requirement.owner,
    requirement.tags.join(', '),
    requirement.aliases.join(', '),
    requirement.sourceLang,
    requirement.rev,
    requirement.links.map((link) => `${link.kind}: ${link.to}${link.suspect === true ? ' (?)' : ''}`).join('\n'),
    ...langs.map((lang) => requirement.text[lang]?.body ?? '')
  ])
  return { name: words.sheet.requirements, columns, rows }
}

/**
 * The second sheet: what covers what, and what covers nothing.
 *
 * Beside the requirements rather than in place of them, because the two questions are
 * asked by different people on different days — one is reading the library, the other is
 * counting what is missing from it.
 */
export function traceSheet(coverage: Coverage[], words: XlsxWords): XlsxSheet {
  return {
    name: words.sheet.trace,
    columns: [
      { label: words.columns.id, width: 18 },
      { label: words.columns.title, width: 34 },
      { label: words.columns.citedIn, width: 34, wrap: true },
      { label: words.columns.satisfiedBy, width: 26, wrap: true },
      { label: words.columns.derivedBy, width: 26, wrap: true },
      { label: words.columns.gaps, width: 34, wrap: true }
    ],
    rows: coverage.map((row): XlsxValue[] => [
      row.requirement.id,
      row.requirement.title || namesOf(row.requirement)[1] || '',
      row.citedIn.map((path) => words.note(path)).join('\n'),
      row.satisfiedBy.join('\n'),
      row.derivedBy.join('\n'),
      row.gaps.map((gap) => words.gap(gap)).join('\n')
    ])
  }
}

/** Both sheets, with a column per language the library is actually written in. */
export function libraryWorkbook(requirements: Requirement[], coverage: Coverage[], words: XlsxWords): XlsxSheet[] {
  return [requirementsSheet(requirements, csvLanguages(requirements), words), traceSheet(coverage, words)]
}
