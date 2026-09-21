import type { PMSettings } from '../../types'
import type { HttpTransport } from '../llm'
import { LlmClient, LlmError } from '../llm'
import { languageName } from './translate'
import { QUALITY_RULES, type QualityFinding, type QualityRule } from './reqQuality'
import { QUALITY_AXES } from './reqScore'

/**
 * Asking a model what the word lists cannot see.
 *
 * The rules run first and always; this runs on top and only when somebody asks. The
 * division is deliberate: a rule can say "there is no obligation verb here" and be right
 * every time, and no rule can say "this sentence assumes the reader knows which subsystem
 * is meant". Each is bad at what the other is good at, and pretending either alone is a
 * review is how a requirements process becomes a formality.
 *
 * The model is pinned to the same vocabulary as the rules, so a reader is not left
 * holding two incompatible lists of defect names.
 */

export const QUALITY_SCHEMA = {
  name: 'requirement_quality',
  schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            rule: { type: 'string', enum: [...QUALITY_RULES] },
            severity: { type: 'string', enum: ['error', 'warning'] },
            term: { type: 'string' },
            message: { type: 'string' }
          },
          required: ['rule', 'severity', 'message'],
          additionalProperties: false
        }
      }
    },
    required: ['findings'],
    additionalProperties: false
  }
} as const

export function qualitySystemPrompt(lang: string): string {
  return [
    `You review requirements written in ${languageName(lang)} for a systems-engineering library.`,
    'Judge one statement. Report only defects that would be raised in a requirements review.',
    'Use these defect names and no others:',
    '- no-modal: the sentence states no obligation.',
    '- multiple: it states more than one obligation and should be split.',
    '- weak-word: it uses a term that cannot be verified.',
    '- and-or: it offers an alternative that cannot be tested.',
    '- passive-no-actor: it obliges somebody, without saying who.',
    '- tbd: it contains a decision nobody has taken.',
    '- unquantified: it compares or bounds something without a figure.',
    '- too-long: it has become a paragraph rather than a statement.',
    'Say nothing about spelling, style or tone. Report an empty list when the statement is sound.',
    'Write each message as one short sentence in the language of the statement, naming what to change.'
  ].join('\n')
}

interface RawFinding {
  rule?: unknown
  severity?: unknown
  term?: unknown
  message?: unknown
}

/**
 * The reply, read defensively.
 *
 * A finding naming a defect that is not in the vocabulary is dropped rather than shown:
 * the reader has a legend, and an entry that is not in it is noise they cannot act on.
 */
export function readQualityFindings(payload: unknown): QualityFinding[] {
  const rows = (payload as { findings?: unknown } | null)?.findings
  if (!Array.isArray(rows)) throw new LlmError('shape', 'The reply carried no findings.')
  const out: QualityFinding[] = []
  for (const row of rows as RawFinding[]) {
    if (typeof row !== 'object' || row === null) continue
    const rule = row.rule
    if (typeof rule !== 'string' || !QUALITY_RULES.includes(rule as QualityRule)) continue
    const message = typeof row.message === 'string' ? row.message.trim() : ''
    out.push({
      rule: rule as QualityRule,
      severity: row.severity === 'error' ? 'error' : 'warning',
      term: typeof row.term === 'string' ? row.term : '',
      fromModel: true,
      ...(message ? { message } : {})
    })
  }
  return out
}

/**
 * Merges what the model found into what the rules found.
 *
 * A defect both of them raise is kept once, as the rule's: the rule is the one that will
 * still be there tomorrow when the gateway is down, and showing the same complaint twice
 * in two wordings teaches a reader to skim the list.
 */
export function mergeFindings(rules: QualityFinding[], model: QualityFinding[]): QualityFinding[] {
  const known = new Set(rules.map((finding) => finding.rule))
  return [...rules, ...model.filter((finding) => !known.has(finding.rule))]
}

export class RequirementReviewer {
  constructor(
    private getSettings: () => PMSettings,
    private transport?: HttpTransport
  ) {}

  get available(): boolean {
    const llm = this.getSettings().llm
    return llm.enabled && llm.baseUrl.trim() !== '' && llm.modelText.trim() !== ''
  }

  /**
   * The full review: prose, defects and what to do about them.
   *
   * The rubric's own verdict goes into the question, so the advice is about the score the
   * reader is looking at rather than about requirements in general.
   */
  async deepReview(body: string, context: ReviewContext): Promise<DeepReview> {
    return readDeepReview(
      await this.client().chatJson({
        model: this.getSettings().llm.modelText,
        messages: [
          { role: 'system', content: deepReviewPrompt(context) },
          { role: 'user', content: body }
        ],
        schema: DEEP_REVIEW_SCHEMA,
        temperature: 0
      })
    )
  }

  private client(): LlmClient {
    return new LlmClient({
      settings: this.getSettings().llm,
      ...(this.transport ? { transport: this.transport } : {})
    })
  }

  /** What the model makes of one wording. Throws an LlmError the caller can name. */
  async review(body: string, lang: string): Promise<QualityFinding[]> {
    return readQualityFindings(
      await this.client().chatJson({
        model: this.getSettings().llm.modelText,
        messages: [
          { role: 'system', content: qualitySystemPrompt(lang) },
          { role: 'user', content: body }
        ],
        schema: QUALITY_SCHEMA,
        temperature: 0
      })
    )
  }
}

/* ---- The full review ------------------------------------------------------- */

/**
 * What a model is asked for beyond the defect list.
 *
 * Prose and rewrites: the two things a rubric cannot produce. The rubric already knows
 * which axes are weak and what each is worth — asking a model to guess that would give
 * advice that sounds right and moves nothing, which is how "AI suggestions" become
 * something nobody reads.
 */
export interface ReviewProposal {
  /** Which axis it lifts. One of the ones it was asked about. */
  axis: string
  /** What to do, in one sentence. */
  action: string
  /** The statement rewritten, where the action is to restate it. */
  rewrite?: string
}

export interface DeepReview {
  /** A few sentences on the statement as a whole, in its own language. */
  assessment: string
  findings: QualityFinding[]
  proposals: ReviewProposal[]
}

export const DEEP_REVIEW_SCHEMA = {
  name: 'requirement_review',
  schema: {
    type: 'object',
    properties: {
      assessment: { type: 'string' },
      findings: QUALITY_SCHEMA.schema.properties.findings,
      proposals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            axis: { type: 'string', enum: [...QUALITY_AXES] },
            action: { type: 'string' },
            rewrite: { type: 'string' }
          },
          required: ['axis', 'action'],
          additionalProperties: false
        }
      }
    },
    required: ['assessment', 'findings', 'proposals'],
    additionalProperties: false
  }
} as const

export interface ReviewContext {
  lang: string
  title: string
  /** The axes the rubric found wanting, and what each is missing. */
  weak: { axis: string; misses: string[]; gain: number }[]
  /** Where the requirement stands and where the reader wants it, as percentages. */
  score: number
  target: number
  /** How many proposals are wanted. The reader chose the number of things to do. */
  count: number
}

/**
 * The instruction for the full review.
 *
 * The rubric's verdict is handed over rather than hidden: a reviewer told "this scores 52
 * and loses most on ambiguity" writes different advice from one shown a bare sentence,
 * and the whole point is advice that moves the number the reader is looking at.
 */
export function deepReviewPrompt(context: ReviewContext): string {
  const lines = [
    `You review requirements written in ${languageName(context.lang)} for a systems-engineering library.`,
    'A rubric has already scored this one. Its verdict is below; do not dispute it, work from it.',
    `Current score: ${Math.round(context.score * 100)} %. The reviewer wants it above ${Math.round(context.target * 100)} %.`,
    'The axes it loses on, with what each is missing and what fixing it is worth:',
    ...context.weak.map(
      (entry) =>
        `- ${entry.axis}: missing ${entry.misses.join(', ') || 'nothing named'} (worth ${Math.round(entry.gain * 100)} points)`
    ),
    '',
    'Answer as JSON with three fields.',
    `"assessment": two to four sentences in ${languageName(context.lang)} on what this requirement does and does not say. Plain, specific, no praise.`,
    '"findings": the defects you see, using only these names: ' + QUALITY_RULES.join(', ') + '.',
    `"proposals": exactly ${context.count}, each naming one of the axes above, each with an "action" of one sentence saying what to change.`,
    `Where the action is to restate the requirement, add "rewrite" holding the whole statement rewritten in ${languageName(context.lang)} — one sentence, one obligation, every figure and unit from the original kept exactly.`,
    'Never invent a figure, a unit, an actor or a constraint the original does not state. Where one is missing, say in the action that it has to be decided, and leave it out of any rewrite.'
  ]
  if (context.title.trim()) lines.push(`The requirement is titled: ${context.title.trim()}`)
  return lines.join('\n')
}

function readProposals(raw: unknown): ReviewProposal[] {
  if (!Array.isArray(raw)) return []
  const out: ReviewProposal[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const entry = row as { axis?: unknown; action?: unknown; rewrite?: unknown }
    const axis = typeof entry.axis === 'string' ? entry.axis : ''
    const action = typeof entry.action === 'string' ? entry.action.trim() : ''
    // A proposal with nothing to do is not a proposal, and an axis outside the rubric
    // cannot be checked against anything.
    if (!action || !QUALITY_AXES.includes(axis as (typeof QUALITY_AXES)[number])) continue
    const rewrite = typeof entry.rewrite === 'string' ? entry.rewrite.trim() : ''
    out.push({ axis, action, ...(rewrite ? { rewrite } : {}) })
  }
  return out
}

export function readDeepReview(payload: unknown): DeepReview {
  if (typeof payload !== 'object' || payload === null) {
    throw new LlmError('shape', 'The review reply was not an object.')
  }
  const row = payload as { assessment?: unknown; findings?: unknown; proposals?: unknown }
  const assessment = typeof row.assessment === 'string' ? row.assessment.trim() : ''
  // Findings and proposals may both be empty — a sound requirement has neither — but a
  // review with nothing to say at all is a reply that did not happen.
  const findings = Array.isArray(row.findings) ? readQualityFindings({ findings: row.findings }) : []
  const proposals = readProposals(row.proposals)
  if (!assessment && !findings.length && !proposals.length) {
    throw new LlmError('shape', 'The review reply was empty.')
  }
  return { assessment, findings, proposals }
}
