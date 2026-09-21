/**
 * What is wrong with the way a requirement is written.
 *
 * Every rule here is one a reviewer would raise in a requirements review, and every one
 * of them is decidable from the sentence alone — no model, no network, no waiting. That
 * matters more than it sounds: a check that needs a gateway is a check that is off when
 * the gateway is down, and a check that is sometimes off is one nobody trusts. The model
 * is asked afterwards, for the things a word list cannot see.
 *
 * The lexicons are per language because the defects are: "le cas échéant" and "as
 * appropriate" are the same failure in two vocabularies, and running one language's list
 * over the other's prose finds nothing and accuses nobody, which is the worst of both.
 */

export const QUALITY_RULES = [
  'no-modal',
  'multiple',
  'weak-word',
  'and-or',
  'passive-no-actor',
  'tbd',
  'unquantified',
  'too-long'
] as const
export type QualityRule = (typeof QUALITY_RULES)[number]

export interface QualityFinding {
  rule: QualityRule
  severity: 'error' | 'warning'
  /** The words that triggered it, so the reader is not left hunting. Empty when the whole sentence is. */
  term: string
  /** Set when a model raised it rather than a rule. */
  fromModel?: boolean
  /** A model's own words. Rules are described from their id, so this stays empty for them. */
  message?: string
}

interface Lexicon {
  /** The verbs that make a sentence an obligation. */
  modals: RegExp
  /** Vague terms that cannot be verified. */
  weak: string[]
  /** A comparative with nothing to compare against. */
  comparatives: string[]
  /** "shall be done" with nobody doing it. */
  passive: RegExp
  /** What marks the actor in a passive sentence. */
  actor: RegExp
}

const LEXICONS: Record<string, Lexicon> = {
  fr: {
    modals: /\b(doit|doivent|devra|devront|devrait|devraient)\b/gi,
    weak: [
      'si possible',
      'le cas échéant',
      'approprié',
      'appropriée',
      'adapté',
      'adaptée',
      'suffisant',
      'suffisante',
      'rapide',
      'rapidement',
      'convivial',
      'ergonomique',
      'robuste',
      'performant',
      'raisonnable',
      'si nécessaire',
      'autant que possible',
      'etc.',
      'notamment',
      'généralement',
      'environ'
    ],
    comparatives: ['plus rapide', 'moins de', 'plus de', 'meilleur', 'supérieur', 'inférieur', 'réduit'],
    passive: /\bdoi(?:t|vent)\s+être\s+\S+(?:é|ée|és|ées|i|ie|is|ies|u|ue|us|ues)\b/i,
    actor: /\bpar\s+\S/i
  },
  en: {
    modals: /\b(shall|must|will)\b/gi,
    weak: [
      'if possible',
      'as appropriate',
      'appropriate',
      'adequate',
      'sufficient',
      'fast',
      'quickly',
      'user-friendly',
      'robust',
      'efficient',
      'reasonable',
      'as needed',
      'as much as possible',
      'etc.',
      'including but not limited to',
      'generally',
      'approximately',
      'about'
    ],
    comparatives: ['faster', 'better', 'greater than', 'less than', 'more than', 'higher', 'lower', 'reduced'],
    passive: /\b(?:shall|must|will)\s+be\s+\w+(?:ed|en)\b/i,
    actor: /\bby\s+\S/i
  }
}

/**
 * Placeholders that mean "we have not decided".
 *
 * Checked whatever the language, along with "and/or", because both are markers rather
 * than vocabulary — but only the markers this tool knows. A German "und/oder" goes
 * unseen, and that is a gap in the lexicons rather than in the rule.
 */
const UNDECIDED = /\b(TBD|TBC|TBS|XXX|à définir|a definir|à préciser|a preciser|to be defined)\b/i

const AND_OR = /\b(et\s*\/\s*ou|and\s*\/\s*or|et\/ou|and\/or)\b/i

/** Long enough that it is two requirements wearing one identifier. */
const TOO_LONG_WORDS = 50

function words(text: string): number {
  return text.split(/\s+/).filter((token) => token.trim() !== '').length
}

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The first vague term in the sentence, or null.
 *
 * Bounded on both sides, with room for French agreement in between: "approprié" has to
 * match "appropriées" and must not match anything longer of its own. Unbounded on the
 * right, "environ" fires inside "environnement" — and a checker that cries about the
 * word "environment" is switched off within a day, taking every real finding with it.
 */
function findTerm(text: string, terms: string[]): string | null {
  const haystack = text.toLowerCase()
  for (const term of terms) {
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}e?s?(?![\\p{L}\\p{N}])`, 'u').test(haystack)) return term
  }
  return null
}

/**
 * The findings for one wording.
 *
 * A language the tool has no lexicon for still gets the checks that are about symbols
 * rather than vocabulary — an undecided placeholder and an "and/or" are the same in any
 * prose — and is spared the ones that would silently find nothing and so quietly declare
 * the sentence clean.
 */
export function checkWording(body: string, lang: string): QualityFinding[] {
  const text = body.trim()
  const findings: QualityFinding[] = []
  if (!text) return findings

  const undecided = UNDECIDED.exec(text)
  if (undecided) findings.push({ rule: 'tbd', severity: 'error', term: undecided[0] })
  const andOr = AND_OR.exec(text)
  if (andOr) findings.push({ rule: 'and-or', severity: 'warning', term: andOr[0] })
  if (words(text) > TOO_LONG_WORDS) findings.push({ rule: 'too-long', severity: 'warning', term: '' })

  const lexicon = LEXICONS[lang.trim().toLowerCase().split(/[-_]/)[0]]
  if (!lexicon) return findings

  const modals = text.match(lexicon.modals) ?? []
  if (modals.length === 0) findings.push({ rule: 'no-modal', severity: 'error', term: '' })
  // Two obligations under one identifier cannot be accepted or rejected separately, and
  // cannot be traced separately either — which is the whole reason an identifier exists.
  else if (modals.length > 1) findings.push({ rule: 'multiple', severity: 'warning', term: modals.join(', ') })

  const weak = findTerm(text, lexicon.weak)
  if (weak) findings.push({ rule: 'weak-word', severity: 'warning', term: weak })

  if (lexicon.passive.test(text) && !lexicon.actor.test(text)) {
    findings.push({ rule: 'passive-no-actor', severity: 'warning', term: '' })
  }

  const comparative = findTerm(text, lexicon.comparatives)
  // A comparative is only a defect when there is nothing to compare against; "less than
  // 3 s" is exactly how a requirement should be written.
  if (comparative && !/\d/.test(text)) {
    findings.push({ rule: 'unquantified', severity: 'warning', term: comparative })
  }

  return findings
}

export function worstSeverity(findings: QualityFinding[]): 'error' | 'warning' | null {
  if (findings.some((finding) => finding.severity === 'error')) return 'error'
  return findings.length ? 'warning' : null
}

/** Whether a wording has anything a reviewer would stop on. */
export function needsReview(body: string, lang: string): boolean {
  return checkWording(body, lang).length > 0
}
