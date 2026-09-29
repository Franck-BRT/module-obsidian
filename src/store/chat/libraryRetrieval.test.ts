import { describe, expect, it } from 'vitest'
import { passagesOf, retrievalContext, retrieve, searchTerms, sourceLink, type LibrarySource } from './libraryRetrieval'

const doc = (title: string, text: string, over: Partial<LibrarySource> = {}): LibrarySource => ({
  path: `Library/_files/${title}.pdf`,
  title,
  kind: 'document',
  detail: '',
  text,
  ...over
})
const filler = (n: number): string =>
  Array.from({ length: n }, (_, i) => `Paragraphe ${i} sur l’organisation générale du chantier et ses réunions.`).join(
    '\n\n'
  )

describe('searchTerms', () => {
  it('keeps what a question is about, folded, without the words that only ask', () => {
    expect(searchTerms('Quelle est la date de coulage du radier ?')).toEqual(['date', 'coulage', 'radier'])
    expect(searchTerms('Que disent les documents sur les Fissures de la pile P3 ?')).toEqual([
      'disent',
      'fissure',
      'pile',
      'p3'
    ])
    expect(searchTerms('le 12 ou le 19')).toEqual(['12', '19'])
    expect(searchTerms('de la et ou')).toEqual([])
  })
})

describe('passagesOf', () => {
  it('gathers short paragraphs into passages and cuts a long one at a sentence', () => {
    expect(passagesOf('Un.\n\nDeux.\n\n\nTrois.', 100)).toEqual(['Un.\n\nDeux.\n\nTrois.'])
    expect(passagesOf('Un.\n\nDeux.', 5)).toEqual(['Un.', 'Deux.'])
    const long = `${'a'.repeat(60)}. ${'b'.repeat(60)}. ${'c'.repeat(30)}`
    const cut = passagesOf(long, 100)
    expect(cut[0]).toBe(`${'a'.repeat(60)}.`)
    expect(cut.join(' ')).toBe(long)
    expect(cut.every((passage) => passage.length <= 100)).toBe(true)
    // Nothing to cut at: cut at the size.
    expect(passagesOf('x'.repeat(250), 100)).toEqual(['x'.repeat(100), 'x'.repeat(100), 'x'.repeat(50)])
    expect(passagesOf('  \n\n ')).toEqual([])
  })
})

describe('retrieve', () => {
  const planning = doc(
    'Planning GC S39',
    `${filler(3)}\n\nSemaine 42 : coulage du radier, réception prévue le 16/10.\n\n${filler(80)}`,
    { detail: 'Planning · Génie civil' }
  )
  const cctp = doc('CCTP lot 2', `${filler(4)}\n\nLe radier sera coulé après réception du fond de fouille.`)
  const photo = doc('Photo fissure pile P3', '', { detail: 'Photo · Tunnel' })
  const note = doc('CR réunion 12', 'Le radier est décalé au 19/10, la zone B reste à sonder.', {
    kind: 'note',
    path: 'Notes/CR réunion 12.md'
  })
  const unrelated = doc('Budget', 'Ventilation : 340 000 €. Éclairage : 80 000 €.')

  it('finds the passages that hold the question’s words, the one holding most of them first', () => {
    const found = retrieve([unrelated, cctp, planning, note, photo], 'Quand est prévu le coulage du radier ?')
    expect(found[0].source.title).toBe('Planning GC S39')
    expect(found.map((each) => each.source.title).sort()).toEqual(['CCTP lot 2', 'CR réunion 12', 'Planning GC S39'])
    expect(found[0].passages.join('\n')).toContain('Semaine 42 : coulage du radier')
    // Not the whole document: only its passages that say something of it.
    expect(found[0].passages.join('').length).toBeLessThan(planning.text.length / 2)
  })

  it('finds a document by its title or description when what it says was never read', () => {
    const found = retrieve([unrelated, photo, planning], 'la fissure de la pile P3')
    expect(found.map((each) => each.source.title)).toEqual(['Photo fissure pile P3'])
    expect(found[0].passages).toEqual(['Photo fissure pile P3 — Photo · Tunnel'])
  })

  it('finds a word whatever its accents, its case or its plural', () => {
    const found = retrieve([doc('Rapport', 'Les RÉCEPTIONS partielles du lot 1.')], 'reception')
    expect(found).toHaveLength(1)
    expect(retrieve([planning], 'de la et')).toEqual([])
    expect(retrieve([], 'radier')).toEqual([])
  })

  it('keeps to the room given: a few passages a source, a few sources, a budget of characters', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      doc(`Doc ${i}`, Array.from({ length: 5 }, (_, j) => `Radier ${i}.${j} ${'x'.repeat(400)}`).join('\n\n'))
    )
    const found = retrieve(many, 'radier', { budget: 100000, perSource: 2, maxSources: 3 })
    expect(found).toHaveLength(3)
    expect(found.every((each) => each.passages.length === 2)).toBe(true)
    const tight = retrieve(many, 'radier', { budget: 1000, perSource: 5, maxSources: 10 })
    expect(tight.flatMap((each) => each.passages).join('').length).toBeLessThanOrEqual(1000)
    // Even a budget smaller than one passage gives the best one.
    expect(retrieve(many, 'radier', { budget: 10, perSource: 5, maxSources: 10 })).toHaveLength(1)
  })

  it('gives a source’s passages in the order they come in it, whichever answers best', () => {
    const text = [
      'Radier : un mot en passant.',
      filler(30),
      'Radier et coulage : le coulage du radier est prévu le 12, coulage de nuit.'
    ].join('\n\n')
    const [found] = retrieve([doc('Notice', text)], 'coulage radier', { budget: 10000, perSource: 3, maxSources: 3 })
    expect(found.passages).toHaveLength(2)
    expect(found.passages[0]).toContain('un mot en passant')
    expect(found.passages[1]).toContain('coulage de nuit')
  })

  it('puts first a document whose title says what is asked, over one that only mentions it', () => {
    const titled = doc('CCTP terrassements', `${filler(8)}\n\nLes terrassements généraux et le CCTP du lot.`)
    const mentioned = doc('Compte rendu', 'Le CCTP des terrassements est à revoir.')
    const found = retrieve([mentioned, titled], 'CCTP terrassements')
    expect(found.map((each) => each.source.title)).toEqual(['CCTP terrassements', 'Compte rendu'])
  })

  it('puts first a passage holding more of the question’s words over one saying one of them often', () => {
    const common = Array.from({ length: 12 }, (_, i) => doc(`Autre ${i}`, `Le coulage ${i} est fait.`))
    const often = doc('Souvent', 'Radier radier radier radier radier radier.')
    const both = doc('Les deux', 'Le radier et son coulage sont prévus.')
    const found = retrieve([...common, often, both], 'radier coulage', { budget: 100000, perSource: 1, maxSources: 20 })
    expect(found.map((each) => each.source.title).indexOf('Les deux')).toBeLessThan(
      found.map((each) => each.source.title).indexOf('Souvent')
    )
  })

  it('weighs a word less in a long passage than in a short one', () => {
    const long = doc('Long', `${'Paragraphe sans rapport, sur autre chose entièrement. '.repeat(15)}Radier.`)
    const short = doc('Court', 'Radier coulé.')
    expect(retrieve([long, short], 'radier').map((each) => each.source.title)).toEqual(['Court', 'Long'])
  })
})

describe('retrievalContext', () => {
  const words = {
    intro: 'INTRO',
    none: 'NONE',
    heading: (index: number, title: string) => `[${index}] ${title}`
  }

  it('quotes each source’s passages under its heading, with its link and what is known of it', () => {
    const source = doc('Plan | coffrage [R+1]', '', { detail: 'Plan · Setec' })
    const text = retrievalContext([{ source, passages: ['Ligne 1\nLigne 2', 'Plus loin'] }], words)
    expect(text).toBe(
      [
        'INTRO',
        '',
        '### [1] Plan | coffrage [R+1]',
        'Plan · Setec · [[Library/_files/Plan | coffrage [R+1].pdf|Plan   coffrage  R+1]]',
        '> Ligne 1',
        '> Ligne 2',
        '>',
        '> …',
        '>',
        '> Plus loin'
      ].join('\n')
    )
    expect(retrievalContext([], words)).toBe('NONE')
    expect(sourceLink(doc('', '', { path: 'N/x.md' }))).toBe('[[N/x.md|N/x.md]]')
  })
})
