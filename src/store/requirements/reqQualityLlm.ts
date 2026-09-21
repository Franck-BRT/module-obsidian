import type { PMSettings } from '../../types'
import type { HttpTransport } from '../llm'
import { LlmClient, LlmError } from '../llm'
import { languageName } from './translate'
import { QUALITY_RULES, type QualityFinding, type QualityRule } from './reqQuality'

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

  /** What the model makes of one wording. Throws an LlmError the caller can name. */
  async review(body: string, lang: string): Promise<QualityFinding[]> {
    const client = new LlmClient({
      settings: this.getSettings().llm,
      ...(this.transport ? { transport: this.transport } : {})
    })
    return readQualityFindings(
      await client.chatJson({
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
