import { describe, expect, it } from 'vitest'
import { diffCounts, diffWords, isMeaningfulDiff, tokenize } from './reqDiff'

/** The two sides, rebuilt from the parts. Neither may have gained or lost a character. */
function rebuild(parts: ReturnType<typeof diffWords>) {
  const before = parts
    .filter((p) => p.kind !== 'added')
    .map((p) => p.text)
    .join('')
  const after = parts
    .filter((p) => p.kind !== 'removed')
    .map((p) => p.text)
    .join('')
  return { before, after }
}

describe('tokenize', () => {
  it('lets the spacing ride with the word before it, so runs stay whole', () => {
    expect(tokenize('a  b\nc')).toEqual(['a  ', 'b\n', 'c'])
  })

  it('keeps spacing that leads, so nothing is lost', () => {
    expect(tokenize('  a b')).toEqual(['  ', 'a ', 'b'])
  })
})

describe('diffWords', () => {
  it('says nothing changed when nothing changed', () => {
    expect(diffWords('Le système doit ouvrir.', 'Le système doit ouvrir.')).toEqual([
      { kind: 'same', text: 'Le système doit ouvrir.' }
    ])
  })

  it('finds the one word that moved', () => {
    const parts = diffWords('Le système doit ouvrir.', 'Le système devrait ouvrir.')
    expect(parts.filter((p) => p.kind === 'removed').map((p) => p.text.trim())).toEqual(['doit'])
    expect(parts.filter((p) => p.kind === 'added').map((p) => p.text.trim())).toEqual(['devrait'])
  })

  it('rebuilds both sides exactly, whitespace and all', () => {
    const before = 'La trappe doit ouvrir\nen moins de 3 s.'
    const after = 'La trappe de service doit ouvrir\nen moins de 5 s.'
    expect(rebuild(diffWords(before, after))).toEqual({ before, after })
  })

  it('joins a run rather than reporting it word by word', () => {
    const parts = diffWords('a b c d', 'a x y d')
    // "b c" out, "x y" in: two parts, not four.
    expect(parts.filter((p) => p.kind === 'removed')).toHaveLength(1)
    expect(parts.filter((p) => p.kind === 'added')).toHaveLength(1)
  })

  it('reads an insertion as an insertion rather than as a rewrite', () => {
    const parts = diffWords('Le système doit ouvrir la trappe.', 'Le système doit ouvrir rapidement la trappe.')
    expect(parts.filter((p) => p.kind === 'removed')).toEqual([])
    expect(parts.filter((p) => p.kind === 'added').map((p) => p.text)).toEqual(['rapidement '])
  })

  it('handles an empty side', () => {
    expect(diffWords('', 'Nouveau.')).toEqual([{ kind: 'added', text: 'Nouveau.' }])
    expect(diffWords('Ancien.', '')).toEqual([{ kind: 'removed', text: 'Ancien.' }])
    expect(diffWords('', '')).toEqual([])
  })

  // A pasted document is not a requirement, and a hundred million cells to diff one would
  // freeze the editor for something nobody could read.
  it('gives up on something far too long rather than grinding', () => {
    const before = Array.from({ length: 2000 }, (_, i) => `mot${i}`).join(' ')
    const after = `${before} et encore un`
    const parts = diffWords(before, after)
    expect(parts.map((p) => p.kind)).toEqual(['removed', 'added'])
    expect(rebuild(parts)).toEqual({ before, after })
  })
})

describe('isMeaningfulDiff', () => {
  it('is quiet about a sentence that was only reflowed', () => {
    expect(isMeaningfulDiff(diffWords('a b', 'a  b'))).toBe(false)
  })

  it('is quiet about a line break that only moved', () => {
    expect(isMeaningfulDiff(diffWords('a b\nc', 'a\nb c'))).toBe(false)
  })

  it('is not quiet about a word', () => {
    expect(isMeaningfulDiff(diffWords('doit', 'devrait'))).toBe(true)
  })

  it('is not quiet about a word that was only added', () => {
    expect(isMeaningfulDiff(diffWords('a b', 'a b c'))).toBe(true)
  })
})

describe('diffCounts', () => {
  it('counts the words that came and went, not the spaces between them', () => {
    expect(diffCounts(diffWords('a b c', 'a x y z'))).toEqual({ added: 3, removed: 2 })
  })
})
