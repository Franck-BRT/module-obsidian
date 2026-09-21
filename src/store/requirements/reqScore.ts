import type { Requirement } from './Requirement'
import { isStale, isUnreviewedMachine, textOf } from './Requirement'
import { checkWording, type QualityFinding, type QualityRule } from './reqQuality'

/**
 * How good a requirement is, as something a reader can take in at a glance.
 *
 * A single number would be a lie by compression — "72 %" of what? — so the number is a
 * weighted mean of six axes that each mean one thing, and the axes are shown beside it.
 * The rating is the headline; the axes are why. Anybody who disagrees with the rating can
 * see which judgement they disagree with, which is the only thing that makes a score
 * worth showing at all.
 *
 * The axes are the characteristics the trade already names — ISO/IEC/IEEE 29148 calls
 * them singular, unambiguous, verifiable, complete and traceable — rather than six
 * invented by this plugin. A reviewer who knows the standard recognises them; one who
 * does not learns something transferable instead of something local.
 */

export const QUALITY_AXES = ['singular', 'unambiguous', 'verifiable', 'attributable', 'complete', 'traceable'] as const
export type QualityAxisId = (typeof QUALITY_AXES)[number]

/**
 * What each axis is worth.
 *
 * The wording outweighs the record, and deliberately: a requirement stated badly is
 * wrong, while one stated well with an empty rationale is merely unfinished. Summing to
 * one so the total is a fraction and not an arbitrary point score.
 */
const WEIGHTS: Record<QualityAxisId, number> = {
  singular: 0.2,
  unambiguous: 0.25,
  verifiable: 0.2,
  attributable: 0.1,
  complete: 0.15,
  traceable: 0.1
}

export interface QualityAxis {
  id: QualityAxisId
  /** From 0 to 1. */
  score: number
  /** What cost it, named so the axis explains itself rather than merely judging. */
  misses: string[]
}

export interface QualityReport {
  axes: QualityAxis[]
  /** The weighted mean, from 0 to 1. */
  score: number
  /** The same, as whole stars out of five. */
  stars: number
  /** The findings the wording axes were judged on, so nothing is computed twice. */
  findings: QualityFinding[]
}

function has(findings: QualityFinding[], rule: QualityRule): boolean {
  return findings.some((finding) => finding.rule === rule)
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Exactly one obligation.
 *
 * Zero is not a requirement and two cannot be accepted, rejected or traced separately,
 * which is the whole reason an identifier exists. Stating none is the worse of the two,
 * because there is nothing there to fix.
 */
function singular(findings: QualityFinding[]): QualityAxis {
  const misses: string[] = []
  let score = 1
  if (has(findings, 'no-modal')) {
    score = 0
    misses.push('no-modal')
  } else if (has(findings, 'multiple')) {
    score = 0.3
    misses.push('multiple')
  }
  return { id: 'singular', score, misses }
}

/** One reading, and only one. */
function unambiguous(findings: QualityFinding[]): QualityAxis {
  const misses: string[] = []
  let score = 1
  const cost: [QualityRule, number][] = [
    ['tbd', 0.6],
    ['weak-word', 0.5],
    ['and-or', 0.4],
    ['too-long', 0.15]
  ]
  for (const [rule, amount] of cost) {
    if (!has(findings, rule)) continue
    score -= amount
    misses.push(rule)
  }
  return { id: 'unambiguous', score: clamp(score), misses }
}

/**
 * Somebody can show it is met.
 *
 * A method with no figure to measure against is half an answer, and so is a figure with
 * no method, so neither alone reaches the top.
 */
function verifiable(requirement: Requirement, findings: QualityFinding[]): QualityAxis {
  const misses: string[] = []
  let score = 1
  if (requirement.verification === 'none') {
    score -= 0.5
    misses.push('verification')
  }
  if (has(findings, 'unquantified')) {
    score -= 0.5
    misses.push('unquantified')
  }
  return { id: 'verifiable', score: clamp(score), misses }
}

/** Somebody is bound by it, and somebody answers for it. */
function attributable(requirement: Requirement, findings: QualityFinding[]): QualityAxis {
  const misses: string[] = []
  let score = 1
  if (has(findings, 'passive-no-actor')) {
    score -= 0.6
    misses.push('passive-no-actor')
  }
  if (!requirement.owner.trim()) {
    score -= 0.2
    misses.push('owner')
  }
  return { id: 'attributable', score: clamp(score), misses }
}

/**
 * The record is filled in, in every language it is meant to exist in.
 *
 * A translation that has fallen behind its source, or one a machine wrote that nobody has
 * read, does not count as written: the point of the library is that somebody is
 * answerable for each statement in each language, and neither of those has anybody.
 */
function complete(requirement: Requirement, langs: string[]): QualityAxis {
  const misses: string[] = []
  const fields: [string, boolean][] = [
    ['category', requirement.category.trim() !== ''],
    ['type', requirement.type.trim() !== ''],
    ['status', requirement.status.trim() !== ''],
    ['criticality', requirement.criticality.trim() !== ''],
    ['source', requirement.source.trim() !== ''],
    ['rationale', requirement.rationale.trim() !== '']
  ]
  for (const lang of langs) {
    const held = textOf(requirement, lang)
    fields.push([
      `text.${lang}`,
      held !== null && held.body.trim() !== '' && !isStale(requirement, lang) && !isUnreviewedMachine(requirement, lang)
    ])
  }
  for (const [name, filled] of fields) {
    if (!filled) misses.push(name)
  }
  return { id: 'complete', score: fields.filter(([, filled]) => filled).length / fields.length, misses }
}

/**
 * It is tied to something above it or below it.
 *
 * A link the far end moved under costs, but does not cost everything: a relation somebody
 * has to re-check is still more than no relation at all.
 */
function traceable(requirement: Requirement): QualityAxis {
  const misses: string[] = []
  const structural = requirement.links.filter(
    (link) => link.kind === 'derives-from' || link.kind === 'refines' || link.kind === 'satisfied-by'
  )
  let score = structural.length ? 1 : requirement.links.length ? 0.4 : 0
  if (!structural.length) misses.push('links')
  if (requirement.links.some((link) => link.suspect === true)) {
    score -= 0.3
    misses.push('suspect')
  }
  return { id: 'traceable', score: clamp(score), misses }
}

/**
 * The whole assessment.
 *
 * Judged on the source wording, because that is the one that governs: a requirement is
 * not better for having a well-written translation of a badly-written original.
 */
export function assessRequirement(requirement: Requirement, langs: string[]): QualityReport {
  const source = textOf(requirement, requirement.sourceLang)
  const findings = source ? checkWording(source.body, requirement.sourceLang) : []
  const axes: QualityAxis[] = [
    singular(findings),
    unambiguous(findings),
    verifiable(requirement, findings),
    attributable(requirement, findings),
    complete(requirement, langs),
    traceable(requirement)
  ]
  // A requirement with no words at all scores nothing, whatever its fields say. The
  // alternative is a blank statement rated three stars for having a category.
  const score =
    source && source.body.trim() !== '' ? axes.reduce((sum, axis) => sum + axis.score * WEIGHTS[axis.id], 0) : 0
  return { axes, score, stars: Math.round(score * 5), findings }
}

/**
 * Below this, a requirement wants rewriting rather than finishing.
 *
 * Three of five: at two, at least one of the wording axes has collapsed, and no amount
 * of filling in the record makes up for a statement that obliges nobody or says two
 * things at once.
 */
export const WEAK_STARS = 3

export function isWeak(report: QualityReport): boolean {
  return report.stars < WEAK_STARS
}

/** The weight an axis carries, for a view that wants to show it. */
export function axisWeight(id: QualityAxisId): number {
  return WEIGHTS[id]
}
