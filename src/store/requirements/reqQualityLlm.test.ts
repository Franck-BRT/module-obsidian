import { describe, expect, it } from 'vitest'
import { LlmError } from '../llm'
import { checkWording, type QualityFinding } from './reqQuality'
import { mergeFindings, qualitySystemPrompt, readQualityFindings } from './reqQualityLlm'

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
