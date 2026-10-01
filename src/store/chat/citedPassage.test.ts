import { describe, expect, it } from 'vitest'
import { noteBody } from '../notes/NoteLibrary'
import { chunkText } from '../rag/ragChunk'
import { bestPage, bestPassage, citationContext, locatePassage, transcriptPage } from './citedPassage'

const NOTE = [
  '---',
  'tags: [chantier]',
  '---',
  '# Réunion de chantier n° 7',
  '',
  '## Terrassement',
  '',
  'Les déblais sont terminés côté nord ; reste la rampe d’accès.',
  'Évacuation des terres vers la décharge de Saint-Jory.',
  '',
  '## Gros œuvre',
  '',
  'Le coulage du **radier** est décalé au 14 octobre, la centrale à béton étant en panne.',
  'La dalle haute suivra trois semaines plus tard.',
  '',
  '## Divers',
  '',
  '- Prochaine réunion le 21 octobre.'
].join('\n')

describe('the passage a citation points to', () => {
  const passages = [
    'Terrassement\n\nLes déblais sont terminés côté nord ; reste la rampe d’accès.',
    'Gros œuvre\n\nLe coulage du radier est décalé au 14 octobre, la centrale à béton étant en panne.'
  ]

  it('is the one sharing the most words with what the reply says around the link', () => {
    expect(bestPassage(passages, 'Le radier sera coulé le 14 octobre (centrale en panne).')?.index).toBe(1)
    expect(bestPassage(passages, 'Les déblais côté nord sont faits.')?.index).toBe(0)
  })

  it('is the first, the best found, when nothing around the link says which; none without passages', () => {
    expect(bestPassage(passages, 'Sources :')?.index).toBe(0)
    expect(bestPassage([], 'radier')).toBeNull()
  })

  it('is chosen by the whole reply when the words around the link say too little', () => {
    expect(citationContext('Sources : ', 'Le radier est décalé au 14 octobre.')).toContain('radier')
    const around = 'Le coulage du radier est décalé au 14 octobre.'
    expect(citationContext(around, 'tout autre chose')).toBe(around)
  })
})

describe('finding a passage again in its note', () => {
  it('finds it from its first line to its last, quoted and without its emphasis', () => {
    const place = locatePassage(
      NOTE,
      '> **Gros œuvre**\n>\n> Le coulage du radier est décalé au 14 octobre, la centrale à béton étant en panne.\n> La dalle haute suivra trois semaines plus tard.'
    )
    expect(place).toMatchObject({ from: 12, to: 13 })
    expect(NOTE.slice(place?.start, place?.end)).toBe(
      'Le coulage du **radier** est décalé au 14 octobre, la centrale à béton étant en panne.\nLa dalle haute suivra trois semaines plus tard.'
    )
  })

  it('finds a passage cut in the middle of a long line, and says when it is not there', () => {
    expect(locatePassage(NOTE, 'la centrale à béton étant en panne.')).toMatchObject({ from: 12, to: 12 })
    expect(locatePassage(NOTE, 'Rien de tout cela ne figure dans la note.')).toBeNull()
  })
})

describe('the page a passage is on', () => {
  const transcript = [
    '## Page 1 sur 3',
    '',
    'Compte rendu de la réunion de chantier.',
    '',
    '## Page 2 sur 3',
    '',
    'Le coulage du radier est décalé au 14 octobre.',
    '',
    '## Page 3 sur 3',
    '',
    'Prochaine réunion le 21 octobre.'
  ].join('\n')

  it('is said by the transcription’s page headings', () => {
    expect(transcriptPage(transcript, 'Le coulage du radier est décalé au 14 octobre.')).toBe(2)
    expect(transcriptPage('Le coulage du radier est décalé au 14 octobre.', 'Le coulage du radier est décalé')).toBe(
      null
    )
  })

  it('is the page holding most of its words, by runs of three first', () => {
    const pages = [
      'Compte rendu de la réunion de chantier du 7 octobre. Présents : MOE, GC.',
      'Le coulage du radier est décalé au 14 octobre, la centrale à béton étant en panne.',
      'Radier : voir planning. Octobre : réunion le 21.'
    ]
    expect(bestPage(pages, 'Le coulage du radier est décalé au 14 octobre')).toBe(2)
    expect(bestPage(pages, 'réunion présents MOE')).toBe(1)
    expect(bestPage(pages, 'xylophone')).toBeNull()
  })
})

describe('a passage the vault search cut from a note', () => {
  it('is found again in the note, whichever it is, and the one the reply speaks of is chosen', () => {
    const chunks = chunkText(noteBody(NOTE), 200).map((chunk) => chunk.text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(locatePassage(NOTE, chunk)).not.toBeNull()
    const chosen = bestPassage(chunks, 'Le radier ne sera coulé que le 14 octobre, la centrale est en panne.')
    const place = locatePassage(NOTE, chosen?.passage ?? '')
    expect(NOTE.split('\n')[place?.from ?? 0]).toContain('radier')
  })
})
