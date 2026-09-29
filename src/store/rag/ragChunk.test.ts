import { describe, expect, it } from 'vitest'
import { chunkText, embeddingInput, propertyLines } from './ragChunk'

const para = (word: string, n = 12): string =>
  Array.from({ length: n }, (_, i) => `${word} ${i} ${'x'.repeat(40)}.`).join(' ')

describe('chunkText', () => {
  it('cuts by headings, each passage knowing the headings it is under', () => {
    const text = [
      '# Spécification thermique',
      '',
      para('intro', 20),
      '',
      '## Maintien en température',
      '',
      para('borne', 20),
      '',
      '### Essais',
      '',
      para('essai', 20),
      '',
      '## Alimentation',
      '',
      para('tension', 20)
    ].join('\n')
    const chunks = chunkText(text, 1100)
    expect(chunks.map((chunk) => chunk.heading)).toEqual([
      'Spécification thermique',
      'Spécification thermique › Maintien en température',
      'Spécification thermique › Maintien en température › Essais',
      'Spécification thermique › Alimentation'
    ])
    expect(chunks[2].text).toContain('essai 0')
    expect(chunks.every((chunk) => !chunk.text.startsWith('#'))).toBe(true)
  })

  it('cuts a long section into passages of about the size given', () => {
    const chunks = chunkText(`## Long\n\n${Array.from({ length: 12 }, (_, i) => para(`p${i}`, 6)).join('\n\n')}`, 1100)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every((chunk) => chunk.heading === 'Long' && chunk.text.length <= 1100)).toBe(true)
  })

  it('keeps short sections side by side together, their headings in the text, under what they share', () => {
    const chunks = chunkText(
      '# CR\n\n## Présents\n\nAnne, Bruno.\n\n## Décisions\n\nRadier décalé.\n\n## Actions\n\nRelancer Setec.'
    )
    expect(chunks).toEqual([
      { heading: 'CR', text: 'Présents\nAnne, Bruno.\n\nDécisions\nRadier décalé.\n\nActions\nRelancer Setec.' }
    ])
  })

  it('never reads a heading inside a code block as one', () => {
    const chunks = chunkText('## Script\n\n```\n# pas un titre\nrun()\n```')
    expect(chunks).toEqual([{ heading: 'Script', text: '```\n# pas un titre\nrun()\n```' }])
  })

  it('repeats a table’s header in each passage the table is cut into', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `| REQ-${i} | ${'énoncé '.repeat(6)} | Approuvée |`)
    const text = ['## Exigences', '', 'Tableau :', '', '| Identifiant | Énoncé | Statut |', ...rows].join('\n')
    const chunks = chunkText(text, 1100)
    expect(chunks.length).toBeGreaterThan(2)
    for (const chunk of chunks.slice(1)) expect(chunk.text.startsWith('| Identifiant | Énoncé | Statut |')).toBe(true)
    expect(chunks.map((chunk) => chunk.text).join('\n')).toContain('| REQ-39 |')
  })

  it('goes back up the headings right after a skipped level', () => {
    const long = (word: string): string => `${word} ${'mot '.repeat(160)}`
    const chunks = chunkText(['# A', '### C', long('c'), '#### D', long('d'), '### E', long('e')].join('\n\n'))
    expect(chunks.map((chunk) => chunk.heading)).toEqual(['A › C', 'A › C › D', 'A › E'])
  })

  it('handles text with no heading, a skipped level, and nothing at all', () => {
    expect(chunkText('Juste du texte.')).toEqual([{ heading: '', text: 'Juste du texte.' }])
    expect(chunkText('### Profond\n\nTexte.')).toEqual([{ heading: 'Profond', text: 'Texte.' }])
    expect(chunkText('')).toEqual([])
    expect(chunkText('# Titre seul')).toEqual([])
  })
})

describe('propertyLines', () => {
  it('says a note’s properties as lines, links by their names, without the plugin’s own', () => {
    expect(
      propertyLines({
        'pm-task': true,
        id: 't1',
        projectId: 'p1',
        title: 'Plan de coffrage',
        status: 'en cours',
        assignee: '[[People/Anne Martin|Anne]]',
        tags: ['lot2', '[[Setec]]', 3],
        due: '2026-10-12',
        position: { start: 1 },
        empty: ''
      })
    ).toBe('title: Plan de coffrage\nstatus: en cours\nassignee: Anne\ntags: lot2, Setec, 3\ndue: 2026-10-12')
    expect(propertyLines(undefined)).toBe('')
  })

  it('keeps to its length, at a line’s end', () => {
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, 'valeur']))
    const lines = propertyLines(many, 100)
    expect(lines.length).toBeLessThanOrEqual(100)
    expect(lines.endsWith('valeur')).toBe(true)
  })
})

describe('embeddingInput', () => {
  it('puts where the passage stands in front of it', () => {
    expect(embeddingInput('Spec', { heading: 'A › B', text: 'Texte' })).toBe('Spec › A › B\n\nTexte')
    expect(embeddingInput('', { heading: '', text: 'Texte' })).toBe('Texte')
  })
})
