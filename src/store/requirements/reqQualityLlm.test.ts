import { describe, expect, it } from 'vitest'
import { LlmError } from '../llm'
import { checkWording, type QualityFinding } from './reqQuality'
import {
  DEFAULT_REVIEW_PROMPT,
  deepReviewPrompt,
  mergeFindings,
  qualitySystemPrompt,
  readDeepReview,
  readQualityFindings,
  REVIEW_PROMPT_KEYS
} from './reqQualityLlm'

describe('qualitySystemPrompt', () => {
  it('names the language of the statement', () => {
    expect(qualitySystemPrompt('fr')).toContain('French')
  })

  it('pins the model to the vocabulary the rules use', () => {
    const prompt = qualitySystemPrompt('fr')
    for (const rule of ['no-modal', 'weak-word', 'passive-no-actor', 'unquantified']) {
      expect(prompt).toContain(rule)
    }
  })
})

describe('readQualityFindings', () => {
  it('reads what the model reported', () => {
    const found = readQualityFindings({
      findings: [{ rule: 'weak-word', severity: 'warning', term: 'rapide', message: 'Préciser un délai.' }]
    })
    expect(found).toEqual([
      { rule: 'weak-word', severity: 'warning', term: 'rapide', fromModel: true, message: 'Préciser un délai.' }
    ])
  })

  it('reads an empty verdict as an empty verdict, not as a failure', () => {
    expect(readQualityFindings({ findings: [] })).toEqual([])
  })

  // The reader has a legend; an entry that is not in it is noise they cannot act on.
  it('drops a defect name that is not in the vocabulary', () => {
    expect(readQualityFindings({ findings: [{ rule: 'mal-écrit', severity: 'error', message: 'Bof.' }] })).toEqual([])
  })

  it('treats an unknown severity as the lesser one', () => {
    expect(readQualityFindings({ findings: [{ rule: 'tbd', severity: 'fatal', message: 'x' }] })[0].severity).toBe(
      'warning'
    )
  })

  it('refuses a reply that is not the shape it asked for', () => {
    expect(() => readQualityFindings({})).toThrow(LlmError)
    expect(() => readQualityFindings(null)).toThrow(LlmError)
  })
})

describe('mergeFindings', () => {
  const rules: QualityFinding[] = checkWording('Le système ouvre la trappe.', 'fr')

  it('keeps a defect both of them raise once, as the rule', () => {
    const model: QualityFinding[] = [{ rule: 'no-modal', severity: 'error', term: '', fromModel: true, message: 'x' }]
    const merged = mergeFindings(rules, model)
    expect(merged.filter((finding) => finding.rule === 'no-modal')).toHaveLength(1)
    expect(merged[0].fromModel).toBeUndefined()
  })

  it('keeps what only the model saw', () => {
    const model: QualityFinding[] = [
      { rule: 'unquantified', severity: 'warning', term: '', fromModel: true, message: 'Quel délai ?' }
    ]
    expect(mergeFindings(rules, model).some((finding) => finding.rule === 'unquantified')).toBe(true)
  })
})

describe('deepReviewPrompt', () => {
  const context = {
    lang: 'fr',
    title: 'Trappe',
    weak: [
      { axis: 'unambiguous', misses: ['weak-word'], gain: 0.12 },
      { axis: 'verifiable', misses: ['verification'], gain: 0.1 }
    ],
    score: 0.52,
    target: 0.8,
    count: 3
  }

  // A reviewer told "this scores 52 and loses most on ambiguity" writes different advice
  // from one shown a bare sentence.
  it('hands over the verdict rather than hiding it', () => {
    const prompt = deepReviewPrompt(context)
    expect(prompt).toContain('52 %')
    expect(prompt).toContain('80 %')
    expect(prompt).toContain('unambiguous: missing weak-word (worth 12 points)')
  })

  it('asks for as many proposals as the reader wanted', () => {
    expect(deepReviewPrompt({ ...context, count: 2 })).toContain('exactly 2')
  })

  it('names the language the answer is to be written in', () => {
    expect(deepReviewPrompt(context)).toContain('French')
  })

  // The one thing a rewrite must never do is quietly decide a figure nobody has agreed.
  it('forbids inventing what the original does not state', () => {
    expect(deepReviewPrompt(context)).toContain('Never invent a figure')
  })
})

describe('readDeepReview', () => {
  const full = {
    assessment: '  La formulation reste vague.  ',
    findings: [{ rule: 'weak-word', severity: 'warning', term: 'rapide', message: 'Préciser.' }],
    proposals: [
      {
        axis: 'unambiguous',
        action: 'Remplacer « rapide » par un délai.',
        rewrite: 'Le système doit répondre en 3 s.'
      },
      { axis: 'verifiable', action: 'Choisir une méthode de vérification.' }
    ]
  }

  it('reads the prose, the defects and what to do', () => {
    const review = readDeepReview(full)
    expect(review.assessment).toBe('La formulation reste vague.')
    expect(review.findings).toHaveLength(1)
    expect(review.proposals[0].rewrite).toBe('Le système doit répondre en 3 s.')
    expect(review.proposals[1].rewrite).toBeUndefined()
  })

  // A sound requirement has neither, and that is a real answer.
  it('accepts a review with nothing to fix', () => {
    expect(readDeepReview({ assessment: 'Rien à redire.', findings: [], proposals: [] }).proposals).toEqual([])
  })

  it('drops a proposal naming an axis the rubric does not have', () => {
    const review = readDeepReview({ ...full, proposals: [{ axis: 'élégance', action: 'Faire mieux.' }] })
    expect(review.proposals).toEqual([])
  })

  it('drops a proposal with nothing to do in it', () => {
    const review = readDeepReview({ ...full, proposals: [{ axis: 'verifiable', action: '   ' }] })
    expect(review.proposals).toEqual([])
  })

  it('refuses a reply that said nothing at all', () => {
    expect(() => readDeepReview({ assessment: '', findings: [], proposals: [] })).toThrow(LlmError)
    expect(() => readDeepReview(null)).toThrow(LlmError)
  })
})

describe('the instruction as a template', () => {
  const context = {
    lang: 'fr',
    title: 'Trappe',
    weak: [{ axis: 'unambiguous', misses: ['weak-word'], gain: 0.12 }],
    score: 0.52,
    target: 0.8,
    count: 3
  }

  it('fills the placeholders it knows', () => {
    const prompt = deepReviewPrompt(context, 'Review in {lang}, get past {target} %, give {count}.')
    expect(prompt).toContain('Review in French, get past 80 %, give 3.')
  })

  // A brace somebody typed in prose is prose, and a template that ate it would be one
  // nobody could write French in.
  it('leaves a name it does not know exactly as it was typed', () => {
    expect(deepReviewPrompt(context, 'Écrire {joliment} en {lang}.')).toContain('Écrire {joliment} en French.')
  })

  it('weaves in the rubric verdict where the template asks for it', () => {
    expect(deepReviewPrompt(context, 'Axes: {weak}')).toContain('unambiguous: missing weak-word (worth 12 points)')
  })

  it('says nothing about a title there is none of, and leaves no hole', () => {
    const prompt = deepReviewPrompt({ ...context, title: '' }, 'Before.\n{title}\nAfter.')
    expect(prompt).toContain('Before.\nAfter.')
  })

  // The fields the editor reads back and the names its badges match on: a review that
  // renamed them would arrive and show nothing.
  it('appends the output contract whatever the template says', () => {
    const prompt = deepReviewPrompt(context, 'Faites au mieux.')
    expect(prompt).toContain('"assessment"')
    expect(prompt).toContain('"proposals": exactly 3')
    expect(prompt).toContain('weak-word')
  })

  it('falls back to the default rather than sending an empty instruction', () => {
    expect(deepReviewPrompt(context, '   ')).toContain('systems-engineering library')
  })

  it('uses the default when none was given', () => {
    expect(deepReviewPrompt(context)).toBe(deepReviewPrompt(context, DEFAULT_REVIEW_PROMPT))
  })

  it('offers every placeholder the default uses', () => {
    for (const match of DEFAULT_REVIEW_PROMPT.matchAll(/\{(\w+)\}/g)) {
      expect(REVIEW_PROMPT_KEYS).toContain(match[1])
    }
  })
})
