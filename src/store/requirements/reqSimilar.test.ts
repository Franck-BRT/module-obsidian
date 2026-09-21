import { describe, expect, it } from 'vitest'
import {
  jaccard,
  lexicalPairs,
  mergePairs,
  normalizeForCompare,
  semanticPairs,
  thresholdsFor,
  trigrams,
  type SimilarPair
} from './reqSimilar'

describe('normalizeForCompare', () => {
  // "Le système doit répondre en 3s." and "le systeme doit repondre en 3 s" are the same
  // requirement typed twice, and a comparison that says otherwise finds nothing.
  it('drops accents, case and punctuation', () => {
    expect(normalizeForCompare('Le système doit répondre en 3s.')).toBe('le systeme doit repondre en 3s')
  })

  it('collapses the spacing', () => {
    expect(normalizeForCompare('  a   b  ')).toBe('a b')
  })
})

describe('trigrams', () => {
  it('cuts a word into letter triples', () => {
    expect([...trigrams('abcd')]).toEqual(['abc', 'bcd'])
  })

  it('keeps a word too short to cut', () => {
    expect([...trigrams('ab')]).toEqual(['ab'])
  })

  it('has nothing for nothing', () => {
    expect(trigrams('   ').size).toBe(0)
  })
})

describe('jaccard', () => {
  it('is one for two identical sets', () => {
    expect(jaccard(trigrams('le systeme doit ouvrir'), trigrams('le systeme doit ouvrir'))).toBe(1)
  })

  it('is zero when nothing is shared', () => {
    expect(jaccard(new Set(['abc']), new Set(['xyz']))).toBe(0)
  })

  it('is zero against nothing', () => {
    expect(jaccard(new Set(), new Set(['abc']))).toBe(0)
  })
})

describe('lexicalPairs', () => {
  const items = [
    { id: 'REQ-A-0001', text: 'La trappe doit pouvoir être ouverte en moins de trois secondes.' },
    { id: 'REQ-A-0002', text: 'La trappe doit pouvoir être ouverte en moins de 3 secondes.' },
    { id: 'REQ-A-0003', text: 'Le bus de données doit supporter une charge de 3 ampères.' }
  ]

  it('finds the requirement that was written twice', () => {
    const pairs = lexicalPairs(items, 0.6)
    expect(pairs).toHaveLength(1)
    expect([pairs[0].a, pairs[0].b]).toEqual(['REQ-A-0001', 'REQ-A-0002'])
    expect(pairs[0].lexical).toBeGreaterThan(0.6)
  })

  it('leaves two requirements about different things alone', () => {
    expect(lexicalPairs([items[0], items[2]], 0.6)).toEqual([])
  })

  it('does not pair a requirement with itself', () => {
    expect(lexicalPairs([items[0]], 0.1)).toEqual([])
  })

  it('reports each pair once, in identifier order whichever way round they came', () => {
    const pairs = lexicalPairs([items[1], items[0]], 0.6)
    expect(pairs).toHaveLength(1)
    expect([pairs[0].a, pairs[0].b]).toEqual(['REQ-A-0001', 'REQ-A-0002'])
  })

  it('ignores a requirement with nothing written in it', () => {
    expect(lexicalPairs([items[0], { id: 'REQ-A-0009', text: '   ' }], 0.1)).toEqual([])
  })

  // A pair whose statements differ in length by more than the threshold allows cannot
  // reach it however they are worded, so the arithmetic is skipped rather than performed.
  it('does not pair a sentence with a paragraph', () => {
    const filler = Array.from({ length: 40 }, (_, i) => `clause${i} de portee particuliere numero ${i * 7}`).join(', ')
    const long = { id: 'REQ-A-0010', text: `${items[0].text} ${filler}.` }
    expect(lexicalPairs([items[0], long], 0.6)).toEqual([])
  })

  it('finds it anyway when the reader looks wider', () => {
    const reworded = { id: 'REQ-A-0011', text: 'La trappe doit être ouverte en moins de trois secondes.' }
    expect(lexicalPairs([items[0], reworded], 0.45)).toHaveLength(1)
  })
})

describe('semanticPairs', () => {
  const a = { id: 'REQ-A-0001', vector: [1, 0, 0] }
  const b = { id: 'REQ-A-0002', vector: [0.99, 0.1, 0] }
  const c = { id: 'REQ-A-0003', vector: [0, 1, 0] }

  it('finds what a model put close together', () => {
    const pairs = semanticPairs([a, b, c], 0.9)
    expect(pairs).toHaveLength(1)
    expect([pairs[0].a, pairs[0].b]).toEqual(['REQ-A-0001', 'REQ-A-0002'])
    expect(pairs[0].semantic).toBeGreaterThan(0.9)
  })

  it('leaves apart what the model put apart', () => {
    expect(semanticPairs([a, c], 0.9)).toEqual([])
  })
})

describe('mergePairs', () => {
  const lexical: SimilarPair[] = [{ a: 'REQ-A-0001', b: 'REQ-A-0002', lexical: 0.7, score: 0.7 }]
  const semantic: SimilarPair[] = [
    { a: 'REQ-A-0001', b: 'REQ-A-0002', lexical: 0, semantic: 0.95, score: 0.95 },
    { a: 'REQ-A-0003', b: 'REQ-A-0004', lexical: 0, semantic: 0.9, score: 0.9 }
  ]

  it('keeps a pair both passes found once, with both numbers', () => {
    const merged = mergePairs(lexical, semantic)
    expect(merged).toHaveLength(2)
    const both = merged.find((pair) => pair.a === 'REQ-A-0001')
    expect(both?.lexical).toBe(0.7)
    expect(both?.semantic).toBe(0.95)
  })

  it('ranks on the stronger of the two signals', () => {
    expect(mergePairs(lexical, semantic)[0].score).toBe(0.95)
  })

  it('puts the likeliest first', () => {
    expect(mergePairs(lexical, semantic).map((pair) => pair.a)).toEqual(['REQ-A-0001', 'REQ-A-0003'])
  })

  // Two runs that found the same thing must not present it in a different order.
  it('breaks a tie on the identifiers', () => {
    const tied: SimilarPair[] = [
      { a: 'REQ-B-0001', b: 'REQ-B-0002', lexical: 0.8, score: 0.8 },
      { a: 'REQ-A-0001', b: 'REQ-A-0002', lexical: 0.8, score: 0.8 }
    ]
    expect(mergePairs(tied, []).map((pair) => pair.a)).toEqual(['REQ-A-0001', 'REQ-B-0001'])
  })

  it('keeps what only one pass found', () => {
    expect(mergePairs([], semantic)).toHaveLength(2)
    expect(mergePairs(lexical, [])).toHaveLength(1)
  })
})

describe('thresholdsFor', () => {
  // Sharing three quarters of your letters is a near-copy; a cosine of 0.75 is two
  // requirements about the same subsystem. One slider driving both would be wrong at one
  // end or the other, always.
  it('holds the two scales apart', () => {
    for (const strictness of ['strict', 'normal', 'wide'] as const) {
      const { lexical, semantic } = thresholdsFor(strictness)
      expect(semantic).toBeGreaterThan(lexical)
    }
  })

  it('loosens as the reader looks wider', () => {
    expect(thresholdsFor('wide').lexical).toBeLessThan(thresholdsFor('normal').lexical)
    expect(thresholdsFor('normal').lexical).toBeLessThan(thresholdsFor('strict').lexical)
  })
})
