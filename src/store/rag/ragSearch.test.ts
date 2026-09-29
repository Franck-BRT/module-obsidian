import { describe, expect, it } from 'vitest'
import { RagIndex, type RagSourceSpec } from './RagIndex'
import { readRewrite, rewriteMessages, searchVault, SEARCH_DEFAULTS, vaultContext } from './ragSearch'
import { MemoryStorage, source, wordEmbedder } from './ragTestKit'

const MODEL = 'm'
const SYNONYMS = [['coulage', 'coule', 'couler', 'coulee', 'bétonnage', 'betonnage']]

async function indexOf(sources: RagSourceSpec[]): Promise<RagIndex> {
  const index = new RagIndex(new MemoryStorage())
  await index.update(sources, wordEmbedder(SYNONYMS), { model: MODEL })
  return index
}

const filler = (word: string): string => `${word} ${'autre chose sans rapport. '.repeat(30)}`
const embed = async (text: string): Promise<number[]> => (await wordEmbedder(SYNONYMS)([text]))[0]

describe('searchVault', () => {
  const sources = [
    source('Library/_files/Planning.pdf', '## Semaine 42\n\nBétonnage du radier prévu le 16/10.', {
      kind: 'document',
      title: 'Planning GC'
    }),
    source('Notes/Budget.md', '# Budget\n\nVentilation : 340 000 €.'),
    source('Work/GC/_tasks/t1.md', 'title: Plan de coffrage PL-002\nstatus: en cours', {
      kind: 'ticket',
      title: 'Plan de coffrage'
    }),
    source('Notes/Divers.md', filler('radier'))
  ]

  it('finds by meaning what shares no word with the question, which the words alone miss', async () => {
    const index = await indexOf(sources)
    const question = 'quand coule-t-on ?'
    const withMeaning = await searchVault(index, question, { embed })
    expect(withMeaning.used.vectors).toBe(true)
    expect(withMeaning.found[0].entry.path).toBe('Library/_files/Planning.pdf')
    const wordsOnly = await searchVault(index, question, {})
    expect(wordsOnly.found.map((each) => each.entry.path)).not.toContain('Library/_files/Planning.pdf')
  })

  it('finds a reference exactly by its words, and searches by words when the meaning cannot be had', async () => {
    const index = await indexOf(sources)
    const failing = async (): Promise<number[]> => {
      throw new Error('down')
    }
    const errors = console.error
    console.error = () => undefined
    const report = await searchVault(index, 'où en est PL-002 ?', { embed: failing })
    console.error = errors
    expect(report.used.vectors).toBe(false)
    expect(report.found[0].entry.path).toBe('Work/GC/_tasks/t1.md')
    expect(await searchVault(index, '   ', { embed })).toEqual({ found: [], used: { vectors: false, rerank: false } })
    expect(await searchVault(new RagIndex(new MemoryStorage()), 'radier', { embed })).toMatchObject({ found: [] })
  })

  it('keeps the order the reranking model gives, and the fused one when it fails', async () => {
    const index = await indexOf(sources)
    const asked: string[][] = []
    const preferBudget = async (query: string, texts: string[]): Promise<number[]> => {
      asked.push(texts)
      return texts.map((text) => (text.includes('340 000') ? 10 : text.includes('radier') ? 5 : 0))
    }
    const report = await searchVault(index, 'radier ventilation budget', { embed, rerank: preferBudget })
    expect(report.used.rerank).toBe(true)
    expect(report.found[0].entry.path).toBe('Notes/Budget.md')
    // Read with where each passage stands.
    expect(asked[0].some((text) => text.startsWith('Budget › Budget\n\n'))).toBe(true)

    const errors = console.error
    console.error = () => undefined
    const broken = await searchVault(index, 'radier ventilation budget', {
      embed,
      rerank: async () => {
        throw new Error('no reranker')
      }
    })
    console.error = errors
    expect(broken.used.rerank).toBe(false)
    expect(broken.found.length).toBeGreaterThan(0)
  })

  it('follows the reranking model even against the search’s own order, and keeps only as many as asked', async () => {
    const index = await indexOf(sources)
    const report = await searchVault(
      index,
      'radier',
      { embed, rerank: async (_query, texts) => texts.map((text) => (text.includes('autre chose') ? 9 : 1)) },
      { ...SEARCH_DEFAULTS, keep: 1, budget: 100000 }
    )
    expect(report.found.map((each) => each.entry.path)).toEqual(['Notes/Divers.md'])
    const two = await searchVault(index, 'radier', { embed }, { ...SEARCH_DEFAULTS, keep: 2 })
    expect(two.found.flatMap((each) => each.passages.filter((p) => !p.around))).toHaveLength(2)
  })

  it('puts first, by words, the passage holding more of the question over one saying one word often', async () => {
    const common = Array.from({ length: 12 }, (_, i) => source(`C${i}.md`, `Le coulage ${i} est fait.`))
    const index = await indexOf([
      ...common,
      source('Souvent.md', 'Radier radier radier radier radier radier.'),
      source('Deux.md', 'Le radier et son coulage sont prévus.')
    ])
    const report = await searchVault(index, 'radier coulage', {}, { ...SEARCH_DEFAULTS, keep: 20 })
    const order = report.found.map((each) => each.entry.path)
    expect(order.indexOf('Deux.md')).toBeLessThan(order.indexOf('Souvent.md'))
  })

  it('counts a word where a word starts with it, not inside another, and weighs it less in a long passage', async () => {
    const index = await indexOf([
      source('Culot.md', 'Le ballottage du culot.'),
      source('Long.md', `Lot 3. ${'Remplissage sans objet ni rapport. '.repeat(25)}`),
      source('Court.md', 'Lot 3 : radier.'),
      source('Pluriel.md', 'Les lots du marché.')
    ])
    const report = await searchVault(index, 'lot', {}, { ...SEARCH_DEFAULTS, keep: 10 })
    expect(report.found.map((each) => each.entry.path)).toEqual(['Court.md', 'Pluriel.md', 'Long.md'])
  })

  it('leaves the meaning out when the question’s vector is not the size of the stored ones', async () => {
    const index = await indexOf(sources)
    const report = await searchVault(index, 'PL-002', { embed: async () => [1, 2, 3] })
    expect(report.found.map((each) => each.entry.path)).toEqual(['Work/GC/_tasks/t1.md'])
  })

  it('puts a little ahead what belongs to the projects the conversation is about', async () => {
    const twins = [source('Other/A.md', 'Le radier du lot.'), source('Work/GC/B.md', 'Le radier du lot.', { key: 'b' })]
    const index = await indexOf(twins)
    // Same words: read once, the one of the project kept.
    const report = await searchVault(index, 'radier', { embed }, { ...SEARCH_DEFAULTS, projects: ['Work/GC/GC.md'] })
    expect(report.found.map((each) => each.entry.path)).toEqual(['Work/GC/B.md'])
    const plain = await searchVault(index, 'radier', { embed })
    expect(plain.found).toHaveLength(1)
  })

  it('gives what is around each passage found, as far as the room allows, in the order of the source', async () => {
    const long = Array.from(
      { length: 5 },
      (_, i) =>
        `## Partie ${i}\n\n${i === 2 ? 'Le radier est coulé. ' : ''}${'Texte de remplissage sans objet. '.repeat(25)}`
    ).join('\n\n')
    const index = await indexOf([source('Spec.md', long)])
    const report = await searchVault(index, 'radier', {}, { ...SEARCH_DEFAULTS, keep: 1 })
    expect(report.found[0].passages.map((p) => [p.at, p.around])).toEqual([
      [1, true],
      [2, false],
      [3, true]
    ])
    const tight = await searchVault(index, 'radier', {}, { ...SEARCH_DEFAULTS, keep: 1, budget: 500 })
    expect(tight.found[0].passages.map((p) => p.at)).toEqual([2])
  })
})

describe('vaultContext', () => {
  it('quotes each source’s passages under their headings, marking a gap between two apart', async () => {
    const index = await indexOf([source('Spec.md', 'x')])
    const entry = { ...(index.entry('Spec.md') ?? ({} as never)), title: 'Spec | A', kind: 'document' as const }
    const text = vaultContext(
      [
        {
          entry,
          passages: [
            { at: 0, heading: 'Intro', text: 'Un.', around: true },
            { at: 1, heading: 'Intro', text: 'Deux.', around: false },
            { at: 4, heading: 'Fin', text: 'Cinq\nsix.', around: false }
          ]
        }
      ],
      { intro: 'INTRO', none: 'NONE', heading: (n, t) => `[${n}] ${t}`, kind: (k) => k.toUpperCase() }
    )
    expect(text).toBe(
      [
        'INTRO',
        '',
        '### [1] Spec | A',
        'DOCUMENT · [[Spec.md|Spec   A]]',
        '> **Intro**',
        '>',
        '> Un.',
        '>',
        '> Deux.',
        '>',
        '> …',
        '>',
        '> **Fin**',
        '>',
        '> Cinq',
        '> six.'
      ].join('\n')
    )
    expect(vaultContext([], { intro: '', none: 'NONE', heading: () => '', kind: () => '' })).toBe('NONE')
  })
})

describe('rewriting a follow-up', () => {
  it('asks with the last exchanges only, each on a line', () => {
    const history = Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 ? ('assistant' as const) : ('user' as const),
      content: `tour ${i}\navec   des blancs`
    }))
    const messages = rewriteMessages(history, 'et pour le lot 3 ?', 'CONSIGNE')
    expect(messages[0]).toEqual({ role: 'system', content: 'CONSIGNE' })
    expect(messages[1].content).toBe(
      'Q : tour 2 avec des blancs\nR : tour 3 avec des blancs\nQ : tour 4 avec des blancs\nR : tour 5 avec des blancs\n\nQ : et pour le lot 3 ?'
    )
  })

  it('reads the question back without its label or quotes, and keeps the original when the reply is no question', () => {
    expect(readRewrite('Requête : « date de coulage du radier du lot 3 »\n', 'x')).toBe(
      'date de coulage du radier du lot 3'
    )
    expect(readRewrite('\n\n"lot 3 radier"', 'x')).toBe('lot 3 radier')
    expect(readRewrite('', 'et pour le lot 3 ?')).toBe('et pour le lot 3 ?')
    expect(readRewrite('a'.repeat(500), 'court')).toBe('court')
  })
})

describe('lookUpVault', () => {
  it('makes a follow-up stand alone before looking it up, and looks the first question up as asked', async () => {
    const { lookUpVault } = await import('./ragSearch')
    const index = await indexOf([
      source('Planning.md', '## Lot 3\n\nBétonnage du radier du lot 3 le 22/10.'),
      source('Autre.md', 'Pour le reste, rien.')
    ])
    const asked: string[] = []
    const rewrite = async (messages: { content: string }[]): Promise<string> => {
      asked.push(messages[1].content)
      return 'Requête : date de coulage du radier du lot 3'
    }
    const follow = await lookUpVault(
      index,
      {
        question: 'et pour le lot 3 ?',
        history: [
          { role: 'user', content: 'Quand coule-t-on le radier du lot 2 ?' },
          { role: 'assistant', content: 'Le 16/10.' }
        ],
        rewrite,
        instruction: 'CONSIGNE'
      },
      { embed }
    )
    expect(follow.query).toBe('date de coulage du radier du lot 3')
    expect(follow.report.found[0].entry.path).toBe('Planning.md')
    expect(asked[0]).toContain('Q : et pour le lot 3 ?')

    const first = await lookUpVault(index, { question: 'radier', history: [], rewrite, instruction: '' }, {})
    expect(first.query).toBe('radier')
    expect(asked).toHaveLength(1)

    const errors = console.error
    console.error = () => undefined
    const failed = await lookUpVault(
      index,
      {
        question: 'et le lot 3 ?',
        history: [{ role: 'user', content: 'radier ?' }],
        rewrite: async () => {
          throw new Error('down')
        },
        instruction: ''
      },
      {}
    )
    console.error = errors
    expect(failed.query).toBe('et le lot 3 ?')
  })
})
