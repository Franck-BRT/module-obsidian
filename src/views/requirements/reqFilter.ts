import type { Requirement } from '../../store/requirements/Requirement'
import { isStale, isUnreviewedMachine, missingLanguages, textOf } from '../../store/requirements/Requirement'
import { needsReview } from '../../store/requirements/reqQuality'
import { assessRequirement, isWeak } from '../../store/requirements/reqScore'

/**
 * Narrowing a library down to what is being looked for.
 *
 * Kept apart from the view because this is the part that can be wrong in a way nobody
 * notices: a filter that quietly drops a requirement looks exactly like a library that
 * does not contain it.
 */

/** What a row can be singled out for, beyond its own fields. */
export type ReqFlag = 'all' | 'stale' | 'unreviewed' | 'missing' | 'suspect' | 'quality' | 'weak'

export interface ReqFilterState {
  search: string
  category: string
  type: string
  status: string
  criticality: string
  flag: ReqFlag
}

export const EMPTY_REQ_FILTER: ReqFilterState = {
  search: '',
  category: '',
  type: '',
  status: '',
  criticality: '',
  flag: 'all'
}

export function isReqFilterActive(state: ReqFilterState): boolean {
  return (
    state.search.trim() !== '' ||
    state.category !== '' ||
    state.type !== '' ||
    state.status !== '' ||
    state.criticality !== '' ||
    state.flag !== 'all'
  )
}

/**
 * Whether a requirement answers to a search.
 *
 * Every language at once, never just the one on screen: somebody who remembers a phrase
 * in English must find the requirement while reading the library in French, or the
 * second language may as well not be stored.
 */
export function matchesReqSearch(requirement: Requirement, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    requirement.id,
    requirement.title,
    requirement.source,
    requirement.rationale,
    requirement.owner,
    ...requirement.tags,
    ...Object.values(requirement.text).map((held) => held.body)
  ]
  return haystack.some((field) => field.toLowerCase().includes(needle))
}

function matchesFlag(requirement: Requirement, flag: ReqFlag, langs: string[]): boolean {
  switch (flag) {
    case 'all':
      return true
    case 'stale':
      return langs.some((lang) => isStale(requirement, lang))
    case 'unreviewed':
      return langs.some((lang) => isUnreviewedMachine(requirement, lang))
    case 'missing':
      return missingLanguages(requirement, langs).length > 0
    case 'suspect':
      return requirement.links.some((link) => link.suspect === true)
    case 'quality':
      // Judged on each wording in its own language: a French sentence run through the
      // English rules is found clean, which is worse than not looking.
      return Object.entries(requirement.text).some(([lang, held]) => needsReview(held.body, lang))
    case 'weak':
      return isWeak(assessRequirement(requirement, langs))
  }
}

export function filterRequirements(list: Requirement[], state: ReqFilterState, langs: string[]): Requirement[] {
  return list.filter(
    (requirement) =>
      (state.category === '' || requirement.category === state.category) &&
      (state.type === '' || requirement.type === state.type) &&
      (state.status === '' || requirement.status === state.status) &&
      (state.criticality === '' || requirement.criticality === state.criticality) &&
      matchesFlag(requirement, state.flag, langs) &&
      matchesReqSearch(requirement, state.search)
  )
}

/** Every category the library actually uses, in reading order. A blank one is not a category. */
export function reqCategories(list: Requirement[]): string[] {
  const seen = new Set(list.map((requirement) => requirement.category).filter((category) => category !== ''))
  return [...seen].sort((a, b) => a.localeCompare(b))
}

export type ReqSortKey = 'id' | 'title' | 'category' | 'type' | 'status' | 'criticality' | 'updated' | 'rating'

function valueOf(requirement: Requirement, key: ReqSortKey, lang: string): string {
  switch (key) {
    // Never reached: a rating is a number and is sorted as one, in sortRequirements.
    case 'rating':
      return ''
    case 'id':
      return requirement.id
    case 'title':
      return requirement.title || textOf(requirement, lang)?.body || ''
    case 'category':
      return requirement.category
    case 'type':
      return requirement.type
    case 'status':
      return requirement.status
    case 'criticality':
      return requirement.criticality
    case 'updated':
      return requirement.updatedAt
  }
}

/**
 * Orders the library, with the id as the tie-break.
 *
 * Always the id, never the position it happened to be read in: two requirements with the
 * same status should not swap places between one redraw and the next, or the reader loses
 * their place in a list they are working down.
 */
export function sortRequirements(
  list: Requirement[],
  key: ReqSortKey,
  dir: 'asc' | 'desc',
  lang: string,
  langs: string[] = [lang]
): Requirement[] {
  const sign = dir === 'asc' ? 1 : -1
  const collate = (a: string, b: string): number =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  // Scored once each rather than once per comparison: a sort asks for n log n of those,
  // and assessing a requirement reads every wording it has.
  const scores =
    key === 'rating'
      ? new Map(list.map((requirement) => [requirement.id, assessRequirement(requirement, langs).score]))
      : null
  return [...list].sort((a, b) => {
    const primary = scores
      ? (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0)
      : collate(valueOf(a, key, lang), valueOf(b, key, lang))
    return primary !== 0 ? primary * sign : collate(a.id, b.id)
  })
}
