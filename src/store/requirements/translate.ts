import type { ChatRequest } from '../llm'
import { LlmError } from '../llm'

/**
 * Translating a requirement, which is not the same job as translating a sentence.
 *
 * A requirement is a contract clause. Its modal force is the whole of its meaning —
 * "shall" and "should" are two different obligations — and every number in it is a figure
 * somebody will be held to. So the prompt says so in those terms, and the answer is
 * checked against the source afterwards rather than trusted: a model that quietly turns
 * "−40 °C" into "40 °C" produces a sentence that reads perfectly and is wrong in the one
 * way that matters.
 *
 * Everything here is pure. The gateway this was written for answers only from inside its
 * own network, so the whole of the translation logic has to be provable without it.
 */

/** Language names the model will recognise. An unknown code is passed through as given. */
const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'French',
  en: 'English',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  ja: 'Japanese',
  zh: 'Chinese',
  ar: 'Arabic'
}

export function languageName(code: string): string {
  const key = code.trim().toLowerCase().split(/[-_]/)[0]
  return LANGUAGE_NAMES[key] ?? code.trim().toUpperCase()
}

export interface TranslationReply {
  text: string
  /** What the model could not resolve. Empty when it had no doubt, which is the usual case. */
  notes: string
}

export const TRANSLATION_SCHEMA = {
  name: 'requirement_translation',
  schema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      notes: { type: 'string' }
    },
    required: ['text'],
    additionalProperties: false
  }
} as const

export interface TranslationContext {
  /** The requirement's own title, which often carries the noun the statement is about. */
  title?: string
  /** Terms that must come out exactly as given: product names, acronyms, cited standards. */
  glossary?: string[]
}

/**
 * The instruction, written as a specification rather than a request.
 *
 * Each line of it exists because of a way requirement translation goes wrong: force
 * softened, a constraint added out of helpfulness, an identifier localised, a comma
 * decimal separator silently read as a thousands separator.
 */
export function translationSystemPrompt(from: string, to: string, context: TranslationContext = {}): string {
  const lines = [
    `You translate requirements from ${languageName(from)} into ${languageName(to)} for a systems-engineering requirements library.`,
    'Return one requirement statement, not a paraphrase and not a commentary.',
    'Preserve the modal force exactly: an obligation stays an obligation, a recommendation stays a recommendation. Never soften or strengthen it.',
    'Add no constraint the source does not state, and drop none that it does.',
    'Keep every number exactly as it is; convert only the decimal separator to the target convention.',
    'Keep units, symbols, acronyms, product names and identifiers unchanged.',
    'Do not explain, do not add a preamble, do not wrap the answer in quotes.',
    'Answer as JSON with "text" holding the translation and "notes" holding anything genuinely ambiguous in the source, or an empty string when nothing is.'
  ]
  if (context.title?.trim()) lines.push(`The requirement is titled: ${context.title.trim()}`)
  if (context.glossary?.length) {
    lines.push(`Leave these terms exactly as written: ${context.glossary.join(', ')}.`)
  }
  return lines.join('\n')
}

export function buildTranslationRequest(
  model: string,
  body: string,
  from: string,
  to: string,
  context: TranslationContext = {}
): ChatRequest & { schema: { name: string; schema: unknown } } {
  return {
    model,
    messages: [
      { role: 'system', content: translationSystemPrompt(from, to, context) },
      { role: 'user', content: body }
    ],
    schema: TRANSLATION_SCHEMA,
    // Zero, always: the same requirement translated twice must come out the same, or a
    // library cannot be reviewed.
    temperature: 0
  }
}

/** The reply, read defensively: a translation that came back empty is a failure, not a blank. */
export function readTranslation(payload: unknown): TranslationReply {
  if (typeof payload !== 'object' || payload === null) {
    throw new LlmError('shape', 'The translation reply was not an object.')
  }
  const row = payload as Record<string, unknown>
  const text = typeof row.text === 'string' ? row.text.trim() : ''
  if (!text) throw new LlmError('shape', 'The translation reply carried no text.')
  return { text, notes: typeof row.notes === 'string' ? row.notes.trim() : '' }
}

/* ---- The guard ----------------------------------------------------------- */

const NUMBER = /[-−]?\d+(?:[.,\p{Zs}]\d+)*/gu
/** Symbols that mean the same thing in every language, and so must survive a translation. */
const SYMBOLS = ['%', '°C', '°F', '°K', '±', '€', '$', '£', '‰']

/**
 * A number reduced to something two languages can be compared on.
 *
 * A space separator of any width counts as a thousands separator — a plain space, the
 * non-breaking one French typography uses, the narrow one it uses more often — matched by
 * class rather than by listing them, because the list is longer than anyone remembers and
 * a missed one reads as a number that vanished.
 *
 * This is a comparison, not a parse: nothing here needs to know what the number *is*,
 * only whether the same one came out the other side. Thousands separators are dropped and
 * a decimal separator becomes a point, so "1 500", "1,500" and "1.500" all reduce to the
 * same thing — which is exactly right here, because where the two conventions are
 * genuinely ambiguous both sides resolve the same way and the comparison still holds.
 *
 * The sign is kept, because dropping a minus is the failure this is here to catch.
 */
export function numberSignature(raw: string): string {
  const negative = /^[-−]/.test(raw)
  let body = raw.replace(/^[-−]/, '').replace(/\p{Zs}/gu, '')

  const lastDot = body.lastIndexOf('.')
  const lastComma = body.lastIndexOf(',')
  const decimalAt = Math.max(lastDot, lastComma)
  if (decimalAt === -1) return (negative ? '-' : '') + body

  const integer = body.slice(0, decimalAt).replace(/[.,]/g, '')
  const fraction = body.slice(decimalAt + 1)
  // Exactly three digits behind a short integer that does not start with a zero is a
  // thousands group, not a fraction: "1,500" is fifteen hundred and "0,001" is not.
  const grouped = fraction.length === 3 && integer.length <= 3 && !integer.startsWith('0')
  body = grouped ? integer + fraction : `${integer}.${fraction.replace(/0+$/, '') || '0'}`
  return (negative ? '-' : '') + body
}

export function numberSignatures(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((match) => numberSignature(match[0]))
}

export function symbolSignatures(text: string): string[] {
  const out: string[] = []
  for (const symbol of SYMBOLS) {
    // Counted, not merely looked for: a range "−40 °C to +70 °C" losing one of its two
    // degree symbols is a sentence that still reads.
    let from = 0
    for (;;) {
      const at = text.indexOf(symbol, from)
      if (at === -1) break
      out.push(symbol)
      from = at + symbol.length
    }
  }
  return out
}

export interface QuantityDrift {
  /** In the source and not in the translation. The dangerous direction. */
  missing: string[]
  /** In the translation and not in the source. An invented figure. */
  added: string[]
}

function drift(source: string[], target: string[]): QuantityDrift {
  const remaining = [...target]
  const missing: string[] = []
  for (const token of source) {
    const at = remaining.indexOf(token)
    if (at === -1) missing.push(token)
    else remaining.splice(at, 1)
  }
  return { missing, added: remaining }
}

/**
 * What the translation did to the figures.
 *
 * Numbers and symbols only. Units spelled out as words are deliberately left alone:
 * "3 secondes" becoming "3 seconds" is the translation doing its job, and a check that
 * complained about it would be ignored within a week, taking the real warnings with it.
 */
export function quantityDrift(source: string, translation: string): QuantityDrift {
  const numbers = drift(numberSignatures(source), numberSignatures(translation))
  const symbols = drift(symbolSignatures(source), symbolSignatures(translation))
  return {
    missing: [...numbers.missing, ...symbols.missing],
    added: [...numbers.added, ...symbols.added]
  }
}

export function hasDrifted(result: QuantityDrift): boolean {
  return result.missing.length > 0 || result.added.length > 0
}
