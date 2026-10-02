import type { Task } from '../types'

/**
 * A risk weighed: its probability and its impact on a scale of four, their product its
 * criticality, read in four bands — what a 4 × 4 matrix shows at a glance, and what a
 * register is sorted by.
 */

export type RiskBand = 'low' | 'medium' | 'high' | 'critical'

export const RISK_LEVELS = [1, 2, 3, 4] as const

export function isRisk(task: Pick<Task, 'type'>): boolean {
  return task.type === 'risk'
}

/** A level as it is kept: a whole number from 1 to 4, 1 when it is nothing. */
export function riskLevel(raw: unknown): number {
  const number = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN
  return Number.isFinite(number) && number > 0 ? Math.min(4, Math.max(1, Math.round(number))) : 1
}

/** A level's words, folded, in either language, for what they mean on the scale of four. */
const LEVEL_WORDS: [number, string[]][] = [
  [1, ['rare', 'improbable', 'tres faible', 'faible', 'mineur', 'minor', 'negligeable', 'low', 'unlikely']],
  [2, ['possible', 'peu probable', 'modere', 'moderee', 'moyen', 'moyenne', 'moderate', 'medium']],
  [3, ['probable', 'likely', 'fort', 'forte', 'eleve', 'elevee', 'majeur', 'major', 'important', 'high']],
  [
    4,
    [
      'quasi certain',
      'quasi-certain',
      'certain',
      'almost certain',
      'tres eleve',
      'critique',
      'critical',
      'grave',
      'catastrophique',
      'very high',
      'severe'
    ]
  ]
]

/**
 * A level as the model or the reader wrote it — « 3 », « 3/4 », « probable », « critique » —
 * on the scale of four; null when it says none.
 */
export function readRiskLevel(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 1 && raw <= 4 ? Math.round(raw) : null
  if (typeof raw !== 'string') return null
  const folded = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  const digit = /^([1-4])(?:\s*\/\s*4)?\b/.exec(folded)
  if (digit) return Number(digit[1])
  for (const [level, words] of [...LEVEL_WORDS].reverse()) {
    if (words.some((word) => folded === word || folded.startsWith(`${word} `))) return level
  }
  return null
}

/** Its probability and impact — those of a risk not weighed yet being 1 —, and their product. */
export function riskScore(task: Pick<Task, 'risk'>): { probability: number; impact: number; score: number } {
  const probability = riskLevel(task.risk?.probability)
  const impact = riskLevel(task.risk?.impact)
  return { probability, impact, score: probability * impact }
}

/** The band a criticality falls in: up to 3 low, to 6 medium, to 9 high, 12 and above critical. */
export function riskBand(score: number): RiskBand {
  if (score >= 12) return 'critical'
  if (score >= 8) return 'high'
  if (score >= 4) return 'medium'
  return 'low'
}

/**
 * A register's order: the most critical first, then the most likely, then by title — a
 * risk closed or mitigated after all those still open.
 */
export function orderRisks<T extends Pick<Task, 'risk' | 'title'>>(risks: T[], open: (risk: T) => boolean): T[] {
  return [...risks].sort((a, b) => {
    const openFirst = Number(open(b)) - Number(open(a))
    if (openFirst) return openFirst
    const sa = riskScore(a)
    const sb = riskScore(b)
    return sb.score - sa.score || sb.probability - sa.probability || a.title.localeCompare(b.title)
  })
}

/** How many risks sit in each cell of the matrix, by probability then impact, 1 to 4. */
export function riskMatrix(risks: Pick<Task, 'risk'>[]): number[][] {
  const cells = RISK_LEVELS.map(() => RISK_LEVELS.map(() => 0))
  for (const risk of risks) {
    const { probability, impact } = riskScore(risk)
    cells[probability - 1][impact - 1]++
  }
  return cells
}

/** Words for a level's reading, from the probability's or the impact's scale. */
export interface RiskWords {
  probability: (level: number) => string
  impact: (level: number) => string
  band: (band: RiskBand) => string
}
