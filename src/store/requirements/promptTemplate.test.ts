import { describe, expect, it } from 'vitest'
import { applyPromptTemplate, fillPrompt } from './promptTemplate'

describe('applyPromptTemplate', () => {
  it('fills the names it knows', () => {
    expect(applyPromptTemplate('Write in {lang}.', { lang: 'French' })).toBe('Write in French.')
  })

  // A brace somebody typed in prose is prose, and a template that ate it would be one
  // nobody could write French in.
  it('leaves a name it does not know exactly as it was typed', () => {
    expect(applyPromptTemplate('Écrire {joliment}.', { lang: 'French' })).toBe('Écrire {joliment}.')
  })

  it('fills the same name everywhere it appears', () => {
    expect(applyPromptTemplate('{a} et {a}', { a: 'x' })).toBe('x et x')
  })
})

describe('fillPrompt', () => {
  const values = { lang: 'French', title: '' }
  const contract = 'Answer as JSON.'

  it('puts the contract after the instruction, always', () => {
    expect(fillPrompt('Do the thing.', 'fallback', values, contract)).toBe('Do the thing.\n\nAnswer as JSON.')
  })

  // A field somebody cleared by accident should not quietly turn a review into whatever
  // the model feels like doing.
  it('falls back rather than sending an empty instruction', () => {
    expect(fillPrompt('   ', 'The shipped one.', values, contract)).toContain('The shipped one.')
  })

  it('drops a line that was nothing but a placeholder with nothing to say', () => {
    expect(fillPrompt('Before.\n{title}\nAfter.', 'x', values, '')).toBe('Before.\nAfter.')
  })

  it('keeps a blank line somebody typed on purpose', () => {
    expect(fillPrompt('Before.\n\nAfter.', 'x', values, '')).toBe('Before.\n\nAfter.')
  })

  it('keeps a line that has a placeholder and words of its own', () => {
    expect(fillPrompt('Titled: {title}', 'x', { title: '' }, '')).toBe('Titled:')
  })

  it('writes no contract when there is none', () => {
    expect(fillPrompt('Do the thing.', 'x', values, '   ')).toBe('Do the thing.')
  })
})
