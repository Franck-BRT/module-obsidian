import { describe, expect, it } from 'vitest'
import { LlmError } from '../llm'
import {
  buildTranslationRequest,
  hasDrifted,
  languageName,
  numberSignature,
  numberSignatures,
  quantityDrift,
  readTranslation,
  symbolSignatures,
  translationSystemPrompt
} from './translate'

describe('languageName', () => {
  it('names the codes a model will recognise', () => {
    expect(languageName('fr')).toBe('French')
    expect(languageName('EN')).toBe('English')
    expect(languageName('pt-BR')).toBe('Portuguese')
  })

  it('passes an unknown code through rather than guessing at it', () => {
    expect(languageName('oc')).toBe('OC')
  })
})

describe('translationSystemPrompt', () => {
  it('names both languages', () => {
    const prompt = translationSystemPrompt('fr', 'en')
    expect(prompt).toContain('French')
    expect(prompt).toContain('English')
  })

  it('forbids the three ways a requirement translation goes wrong', () => {
    const prompt = translationSystemPrompt('fr', 'en')
    expect(prompt).toContain('modal force')
    expect(prompt).toContain('Add no constraint')
    expect(prompt).toContain('Keep every number')
  })

  it('carries the terms that must come out untouched', () => {
    const prompt = translationSystemPrompt('fr', 'en', { glossary: ['Ariane 6', 'ECSS-E-ST-10C'] })
    expect(prompt).toContain('Ariane 6, ECSS-E-ST-10C')
  })

  it('says nothing about a glossary there is none of', () => {
    expect(translationSystemPrompt('fr', 'en')).not.toContain('exactly as written')
  })
})

describe('buildTranslationRequest', () => {
  it('asks for JSON and asks for it at zero temperature', () => {
    const request = buildTranslationRequest('m', 'La trappe doit ouvrir.', 'fr', 'en')
    expect(request.schema.name).toBe('requirement_translation')
    expect(request.temperature).toBe(0)
    expect(request.messages[1]).toEqual({ role: 'user', content: 'La trappe doit ouvrir.' })
  })
})

describe('readTranslation', () => {
  it('reads the text and the notes', () => {
    expect(readTranslation({ text: ' The hatch shall open. ', notes: ' unclear subject ' })).toEqual({
      text: 'The hatch shall open.',
      notes: 'unclear subject'
    })
  })

  it('treats a missing note as no note rather than as a failure', () => {
    expect(readTranslation({ text: 'x' }).notes).toBe('')
  })

  it('refuses an empty translation rather than storing a blank wording', () => {
    expect(() => readTranslation({ text: '   ' })).toThrow(LlmError)
    expect(() => readTranslation(null)).toThrow(LlmError)
  })
})

describe('numberSignature', () => {
  it('reads a comma and a point decimal as the same number', () => {
    expect(numberSignature('3,5')).toBe(numberSignature('3.5'))
  })

  it('keeps a minus, which is the sign a translation drops', () => {
    expect(numberSignature('−40')).toBe('-40')
    expect(numberSignature('-40')).toBe('-40')
    expect(numberSignature('40')).toBe('40')
  })

  it('reads a thousands group whichever way it was written', () => {
    expect(numberSignature('1 500')).toBe('1500')
    expect(numberSignature('1 500')).toBe('1500')
    expect(numberSignature('1,500')).toBe('1500')
    expect(numberSignature('1.500')).toBe('1500')
  })

  it('does not read a fraction as a thousands group when the integer says otherwise', () => {
    expect(numberSignature('0,001')).toBe('0.001')
    expect(numberSignature('0.001')).toBe('0.001')
  })

  it('does not confuse three and a half with thirty-five', () => {
    expect(numberSignature('3,5')).not.toBe(numberSignature('35'))
  })

  it('ignores trailing zeroes, which are a convention rather than a value', () => {
    expect(numberSignature('3,50')).toBe(numberSignature('3.5'))
  })
})

describe('numberSignatures', () => {
  it('finds every number in a statement', () => {
    expect(numberSignatures('Entre −40 °C et +70 °C pendant 3,5 h')).toEqual(['-40', '70', '3.5'])
  })
})

describe('symbolSignatures', () => {
  it('counts a symbol each time rather than once', () => {
    expect(symbolSignatures('de −40 °C à 70 °C')).toEqual(['°C', '°C'])
  })
})

describe('quantityDrift', () => {
  const source = 'La trappe doit ouvrir en moins de 3 s entre −40 °C et +70 °C.'

  it('says nothing about a faithful translation', () => {
    const drift = quantityDrift(source, 'The hatch shall open in under 3 s between −40 °C and +70 °C.')
    expect(hasDrifted(drift)).toBe(false)
  })

  it('catches a dropped minus, which reads perfectly and is wrong', () => {
    const drift = quantityDrift(source, 'The hatch shall open in under 3 s between 40 °C and +70 °C.')
    expect(drift.missing).toContain('-40')
    expect(drift.added).toContain('40')
  })

  it('catches a figure that disappeared', () => {
    const drift = quantityDrift(source, 'The hatch shall open quickly between −40 °C and +70 °C.')
    expect(drift.missing).toEqual(['3'])
  })

  it('catches a figure that was invented', () => {
    const drift = quantityDrift('The hatch shall open quickly.', 'La trappe doit ouvrir en 3 s.')
    expect(drift.added).toEqual(['3'])
  })

  it('catches a lost unit symbol even where the number survived', () => {
    const drift = quantityDrift('at least 95 %', 'au moins 95')
    expect(drift.missing).toEqual(['%'])
  })

  it('does not complain about a unit that was translated, which is the job', () => {
    expect(hasDrifted(quantityDrift('en moins de 3 secondes', 'in under 3 seconds'))).toBe(false)
  })

  it('does not complain about the decimal separator changing convention', () => {
    expect(hasDrifted(quantityDrift('une masse de 3,5 kg', 'a mass of 3.5 kg'))).toBe(false)
  })
})

describe('the translation instruction as a template', () => {
  it('fills the two languages', () => {
    expect(translationSystemPrompt('fr', 'en', {}, 'From {from} to {to}.')).toContain('From French to English.')
  })

  it('appends the fields the editor reads back, whatever the instruction says', () => {
    const prompt = translationSystemPrompt('fr', 'en', {}, 'Faites au mieux.')
    expect(prompt).toContain('"text"')
    expect(prompt).toContain('"notes"')
  })

  it('falls back rather than sending an empty instruction', () => {
    expect(translationSystemPrompt('fr', 'en', {}, '  ')).toContain('modal force')
  })

  it('carries the glossary where the instruction asks for it', () => {
    const prompt = translationSystemPrompt('fr', 'en', { glossary: ['Ariane 6'] }, 'Termes : {glossary}')
    expect(prompt).toContain('Ariane 6')
  })
})
