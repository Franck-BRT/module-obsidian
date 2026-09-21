import { describe, expect, it } from 'vitest'
import { makeRequirement, setText } from './Requirement'
import {
  compareToBaseline,
  countChanges,
  hydrateBaseline,
  makeBaseline,
  parseBaselineBody,
  serializeBaselineBody,
  type Baseline
} from './Baseline'

function req(id: string, fr: string, over: Parameters<typeof makeRequirement>[0] = {}) {
  return setText(makeRequirement({ id, sourceLang: 'fr', ...over }), 'fr', fr, 'franck')
}

const library = [
  req('REQ-SYS-0001', 'La trappe doit ouvrir en 3 s.', { title: 'Trappe', status: 'approved' }),
  req('REQ-SYS-0002', 'Le bus doit tenir 3 h.', { title: 'Bus', status: 'draft' })
]

describe('makeBaseline', () => {
  it('copies the words rather than pointing at them', () => {
    const baseline = makeBaseline('Revue de conception', library)
    expect(baseline.entries[0].text.fr).toBe('La trappe doit ouvrir en 3 s.')
    expect(baseline.entries[0].rev).toBe(1)
    expect(baseline.entries[0].status).toBe('approved')
  })

  it('sorts, so two baselines of the same set are the same document', () => {
    const one = makeBaseline('A', library)
    const other = makeBaseline('A', [...library].reverse())
    expect(serializeBaselineBody(one)).toBe(serializeBaselineBody(other))
  })
})

describe('the baseline note', () => {
  it('reads back exactly what was written', () => {
    const baseline = makeBaseline('Revue', library, { note: 'Signée le 14 mars.' })
    expect(parseBaselineBody(serializeBaselineBody(baseline))).toEqual(baseline.entries)
  })

  // Every wording line is quoted, which is what makes the format safe rather than tidy.
  it('survives a wording that looks like the format itself', () => {
    const nasty = req('REQ-SYS-0003', 'Le système doit écrire :\n### EN\n## REQ-SYS-9999 — faux\n> déjà cité')
    const baseline = makeBaseline('Piège', [nasty])
    expect(parseBaselineBody(serializeBaselineBody(baseline))[0].text.fr).toBe(nasty.text.fr.body)
    expect(parseBaselineBody(serializeBaselineBody(baseline))).toHaveLength(1)
  })

  it('keeps an empty line inside a wording', () => {
    const wrapped = req('REQ-SYS-0004', 'Premier paragraphe.\n\nSecond paragraphe.')
    const back = parseBaselineBody(serializeBaselineBody(makeBaseline('A', [wrapped])))
    expect(back[0].text.fr).toBe('Premier paragraphe.\n\nSecond paragraphe.')
  })

  it('keeps several languages apart', () => {
    const both = setText(req('REQ-SYS-0005', 'Source.'), 'en', 'Source in English.', 'a')
    const back = parseBaselineBody(serializeBaselineBody(makeBaseline('A', [both])))
    expect(back[0].text).toEqual({ fr: 'Source.', en: 'Source in English.' })
  })

  it('reads a requirement that was never given a title', () => {
    const untitled = req('REQ-SYS-0006', 'Sans titre.')
    const back = parseBaselineBody(serializeBaselineBody(makeBaseline('A', [untitled])))
    expect(back[0].title).toBe('')
    expect(back[0].id).toBe('REQ-SYS-0006')
  })

  it('ignores prose somebody added between the entries', () => {
    const body = `${serializeBaselineBody(makeBaseline('A', library))}\n\nRelu par Claire.\n`
    expect(parseBaselineBody(body)).toHaveLength(2)
  })

  it('refuses a note that is not a baseline', () => {
    expect(hydrateBaseline({ title: 'Plain' }, '# Plain\n', 'Notes/plain.md')).toBeNull()
  })

  it('reads the whole baseline back from a note', () => {
    const baseline = makeBaseline('Revue', library, { by: 'franck', scope: 'category: SYS' })
    const back = hydrateBaseline(
      {
        'pm-req-baseline': true,
        id: baseline.id,
        name: 'Revue',
        at: baseline.at,
        by: 'franck',
        scope: 'category: SYS'
      },
      serializeBaselineBody(baseline),
      'Requirements/Revue.md'
    )
    expect(back?.name).toBe('Revue')
    expect(back?.scope).toBe('category: SYS')
    expect(back?.entries).toEqual(baseline.entries)
  })
})

describe('compareToBaseline', () => {
  const taken: Baseline = makeBaseline('Revue', library)

  it('says nothing moved when nothing moved', () => {
    const changes = compareToBaseline(taken, library)
    expect(countChanges(changes)).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 2 })
  })

  it('shows the words that moved, not merely that they did', () => {
    const now = [
      req('REQ-SYS-0001', 'La trappe doit ouvrir en 5 s.', { title: 'Trappe', status: 'approved' }),
      library[1]
    ]
    const change = compareToBaseline(taken, now).find((entry) => entry.id === 'REQ-SYS-0001')
    expect(change?.kind).toBe('changed')
    expect(change?.wordings[0].diff.some((part) => part.kind === 'added' && part.text.includes('5'))).toBe(true)
  })

  it('names a field that moved', () => {
    const now = [{ ...library[0], status: 'implemented' }, library[1]]
    const change = compareToBaseline(taken, now).find((entry) => entry.id === 'REQ-SYS-0001')
    expect(change?.fields).toEqual([{ field: 'status', was: 'approved', now: 'implemented' }])
  })

  it('reports a requirement written since', () => {
    const now = [...library, req('REQ-SYS-0009', 'Nouvelle.')]
    const change = compareToBaseline(taken, now).find((entry) => entry.id === 'REQ-SYS-0009')
    expect(change?.kind).toBe('added')
  })

  it('reports a requirement that has gone', () => {
    const change = compareToBaseline(taken, [library[0]]).find((entry) => entry.id === 'REQ-SYS-0002')
    expect(change?.kind).toBe('removed')
    expect(change?.was?.text.fr).toBe('Le bus doit tenir 3 h.')
  })

  it('reports a translation written since as a change', () => {
    const now = [setText(library[0], 'en', 'The hatch shall open in 3 s.', 'a'), library[1]]
    const change = compareToBaseline(taken, now).find((entry) => entry.id === 'REQ-SYS-0001')
    expect(change?.kind).toBe('changed')
    expect(change?.wordings.map((entry) => entry.lang)).toEqual(['en'])
  })

  // The revision number is a good signal and a bad proof: a wording restored by hand sits
  // at a higher revision saying the same thing.
  it('compares the words, not the revision number', () => {
    let restored = setText(library[0], 'fr', 'Autre chose.', 'a')
    restored = setText(restored, 'fr', 'La trappe doit ouvrir en 3 s.', 'a')
    expect(restored.rev).toBeGreaterThan(library[0].rev)
    const change = compareToBaseline(taken, [restored, library[1]]).find((entry) => entry.id === 'REQ-SYS-0001')
    expect(change?.kind).toBe('unchanged')
  })

  it('is not fooled by a reflowed sentence', () => {
    const reflowed = setText(library[0], 'fr', 'La trappe doit ouvrir\nen 3 s.', 'a')
    const change = compareToBaseline(taken, [reflowed, library[1]]).find((entry) => entry.id === 'REQ-SYS-0001')
    expect(change?.kind).toBe('unchanged')
  })

  it('orders the report by identifier, so two runs read the same', () => {
    const now = [library[1], req('REQ-SYS-0000', 'Première.'), library[0]]
    expect(compareToBaseline(taken, now).map((change) => change.id)).toEqual([
      'REQ-SYS-0000',
      'REQ-SYS-0001',
      'REQ-SYS-0002'
    ])
  })
})
