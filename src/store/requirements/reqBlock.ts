import type { Requirement } from './Requirement'
import { isStale, isUnreviewedMachine, textOf } from './Requirement'

/**
 * A `pm-req` block: requirements pulled into a document rather than copied into it.
 *
 * The whole point of a requirements library is that a specification cites the library
 * instead of holding its own copy of the words. A copy is right on the day it is pasted
 * and wrong from the next revision onward, and nobody can tell by looking. A citation is
 * never wrong, and can say out loud that what it is showing has gone stale.
 *
 * The syntax is `key: value` lines, because a document author is writing prose and should
 * not have to learn a query language to quote six requirements.
 */

export const REQ_BLOCK_LANGUAGE = 'pm-req'

export interface ReqBlockSpec {
  /** Named outright, in the order written. An empty list means "whatever matches". */
  ids: string[]
  category: string
  type: string
  status: string
  criticality: string
  tags: string[]
  search: string
  /** Which wording to show. Empty means each requirement's own source language. */
  lang: string
  /** Which columns to draw, in order. Empty means the sensible default. */
  fields: ReqBlockField[]
  sort: 'id' | 'title' | 'status'
  /** Keys the block used that mean nothing here, so the block can say so rather than ignore them. */
  unknown: string[]
}

export const REQ_BLOCK_FIELDS = [
  'id',
  'title',
  'text',
  'type',
  'status',
  'criticality',
  'verification',
  'rating'
] as const
export type ReqBlockField = (typeof REQ_BLOCK_FIELDS)[number]

/**
 * What a block shows when it was not told.
 *
 * The rating is not among them, and that is the one deliberate absence: a `pm-req` block
 * ends up in specifications that are sent to suppliers, and how well a requirement is
 * *written* is this organisation's business rather than theirs. It is one word away —
 * `fields: id, text, status, rating` — for the documents where it belongs, which are the
 * internal reviews.
 */
export const DEFAULT_REQ_BLOCK_FIELDS: ReqBlockField[] = ['id', 'text', 'status']

function splitList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')
}

/**
 * Reads the block's body.
 *
 * Forgiving about shape — blank lines, stray spacing, a list written with commas or
 * semicolons — and strict about vocabulary: a key nobody recognises is collected and
 * reported, because a silently ignored `statut:` is a document author convinced they
 * filtered something.
 */
export function parseReqBlock(source: string): ReqBlockSpec {
  const spec: ReqBlockSpec = {
    ids: [],
    category: '',
    type: '',
    status: '',
    criticality: '',
    tags: [],
    search: '',
    lang: '',
    fields: [],
    sort: 'id',
    unknown: []
  }
  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf(':')
    // A bare line is taken as an identifier: quoting one requirement is the common case
    // and should not need a key at all.
    if (at === -1) {
      spec.ids.push(...splitList(trimmed))
      continue
    }
    const key = trimmed.slice(0, at).trim().toLowerCase()
    const value = trimmed.slice(at + 1).trim()
    switch (key) {
      case 'id':
      case 'ids':
        spec.ids.push(...splitList(value))
        break
      case 'category':
        spec.category = value
        break
      case 'type':
        spec.type = value
        break
      case 'status':
        spec.status = value
        break
      case 'criticality':
        spec.criticality = value
        break
      case 'tag':
      case 'tags':
        spec.tags = splitList(value)
        break
      case 'search':
        spec.search = value
        break
      case 'lang':
        spec.lang = value.toLowerCase()
        break
      case 'fields':
        spec.fields = splitList(value.toLowerCase()).filter((field): field is ReqBlockField =>
          REQ_BLOCK_FIELDS.includes(field as ReqBlockField)
        )
        break
      case 'sort':
        spec.sort = value === 'title' || value === 'status' ? value : 'id'
        break
      default:
        spec.unknown.push(key)
    }
  }
  return spec
}

/** Whether the block asked for anything at all. An empty one would otherwise pull the library in. */
export function isEmptySpec(spec: ReqBlockSpec): boolean {
  return (
    spec.ids.length === 0 &&
    spec.tags.length === 0 &&
    spec.category === '' &&
    spec.type === '' &&
    spec.status === '' &&
    spec.criticality === '' &&
    spec.search === ''
  )
}

export interface ReqBlockResult {
  rows: Requirement[]
  /** Identifiers the block names that the library does not hold. Named, never swallowed. */
  missing: string[]
}

function matchesSearch(requirement: Requirement, needle: string): boolean {
  const q = needle.toLowerCase()
  return (
    requirement.id.toLowerCase().includes(q) ||
    requirement.title.toLowerCase().includes(q) ||
    Object.values(requirement.text).some((held) => held.body.toLowerCase().includes(q))
  )
}

/**
 * What the block resolves to.
 *
 * Identifiers come out in the order they were written, because a specification quotes its
 * requirements in an order somebody chose. Everything else is a selection, and a selection
 * has no order of its own, so it is sorted.
 *
 * An identifier that matches nothing is reported rather than dropped: a requirement
 * deleted or renumbered under a document must show up as a hole in the document, not as a
 * document that quietly got shorter.
 */
export function selectRequirements(spec: ReqBlockSpec, library: Requirement[]): ReqBlockResult {
  if (spec.ids.length) {
    const byId = new Map(library.map((requirement) => [requirement.id.toUpperCase(), requirement]))
    const rows: Requirement[] = []
    const missing: string[] = []
    for (const id of spec.ids) {
      const found = byId.get(id.toUpperCase())
      if (found) rows.push(found)
      else missing.push(id)
    }
    return { rows, missing }
  }

  const rows = library.filter(
    (requirement) =>
      (spec.category === '' || requirement.category === spec.category) &&
      (spec.type === '' || requirement.type === spec.type) &&
      (spec.status === '' || requirement.status === spec.status) &&
      (spec.criticality === '' || requirement.criticality === spec.criticality) &&
      (spec.tags.length === 0 || spec.tags.every((tag) => requirement.tags.includes(tag))) &&
      (spec.search === '' || matchesSearch(requirement, spec.search))
  )
  const key = (requirement: Requirement): string =>
    spec.sort === 'title' ? requirement.title || requirement.id : spec.sort === 'status' ? requirement.status : ''
  rows.sort((a, b) => {
    const primary = key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: 'base' })
    // Always the id as the tie-break, so a document that is regenerated twice reads the
    // same both times.
    return primary !== 0 ? primary : a.id.localeCompare(b.id, undefined, { numeric: true })
  })
  return { rows, missing: [] }
}

export interface QuotedWording {
  lang: string
  body: string
  /** The wording asked for did not exist, so this is the source language standing in. */
  fallback: boolean
  stale: boolean
  unreviewed: boolean
}

/**
 * The wording a block shows, and what is wrong with it.
 *
 * A specification that embeds a translation which has fallen behind its source is the
 * exact failure this whole library exists to prevent, so the state travels with the words
 * rather than being something the reader has to go and check.
 */
export function quotedWording(requirement: Requirement, lang: string): QuotedWording | null {
  const wanted = lang || requirement.sourceLang
  const held = textOf(requirement, wanted)
  if (held) {
    return {
      lang: wanted,
      body: held.body,
      fallback: false,
      stale: isStale(requirement, wanted),
      unreviewed: isUnreviewedMachine(requirement, wanted)
    }
  }
  const source = textOf(requirement, requirement.sourceLang)
  if (!source) return null
  return {
    lang: requirement.sourceLang,
    body: source.body,
    fallback: true,
    stale: false,
    unreviewed: isUnreviewedMachine(requirement, requirement.sourceLang)
  }
}
