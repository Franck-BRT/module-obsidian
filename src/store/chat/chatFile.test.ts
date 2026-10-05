import { describe, expect, it } from 'vitest'
import { buildXlsx } from '../xlsx'
import {
  blocksText,
  currentFiles,
  excerptFor,
  FILE_BUDGET,
  fileShare,
  fileText,
  filesContext,
  FileReadError,
  imageDataUrl,
  isImage,
  isReadable,
  questionWords
} from './chatFile'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('blocksText', () => {
  it('writes headings, lists and tables as a model reads them', () => {
    expect(
      blocksText([
        { kind: 'p', style: 'title', styleName: '', text: 'Planning' },
        { kind: 'p', style: 'heading', level: 1, styleName: '', text: 'Génie civil' },
        { kind: 'p', style: 'list', styleName: '', text: 'Sondages en zone B' },
        {
          kind: 'table',
          rows: [
            ['Tâche', 'Début', 'Fin'],
            ['Soutènement', '14/09/2026', '09/10/2026'],
            ['', '', ''],
            ['Deux\nlignes | barre', 'a', 'b']
          ]
        },
        { kind: 'p', style: 'normal', styleName: '', text: '  ' }
      ])
    ).toBe(
      [
        '# Planning',
        '## Génie civil',
        '- Sondages en zone B',
        '| Tâche | Début | Fin |\n| Soutènement | 14/09/2026 | 09/10/2026 |\n| Deux lignes / barre | a | b |'
      ].join('\n\n')
    )
  })
})

describe('fileText', () => {
  it('reads plain text as it is, and HTML as its paragraphs and tables', async () => {
    expect(await fileText('CSV', bytes('Tâche;Fin\r\nSoutènement;09/10/2026\r\n'))).toBe(
      'Tâche;Fin\nSoutènement;09/10/2026'
    )
    expect(
      await fileText('html', bytes('<h1>Planning</h1><table><tr><td>Radier</td><td>13/11/2026</td></tr></table>'))
    ).toBe('# Planning\n\n| Radier | 13/11/2026 |')
  })

  it('reads a test bench’s .result as text, in UTF-8 or in the Windows code page', async () => {
    expect(await fileText('result', bytes('Essai 6.3.5 : conforme\n'))).toBe('Essai 6.3.5 : conforme')
    // « Température » as an older tool writes it: one byte for the é, which UTF-8 refuses.
    const latin = Uint8Array.from('Température 25 °C', (char) => char.charCodeAt(0))
    expect(await fileText('result', latin)).toBe('Température 25 °C')
  })

  it('reads a workbook sheet by sheet', async () => {
    const workbook = buildXlsx([
      {
        name: 'Lot 1',
        columns: [
          { label: 'Tâche', width: 10 },
          { label: 'Jours', width: 5 }
        ],
        rows: [['Radier', 20]]
      }
    ])
    expect(await fileText('xlsx', workbook)).toBe('## Lot 1\n\n| Tâche | Jours |\n| Radier | 20 |')
  })

  it('says why a file gives no text', async () => {
    await expect(fileText('png', bytes('x'))).rejects.toEqual(new FileReadError('unsupported'))
    await expect(fileText('txt', bytes('  \n '))).rejects.toEqual(new FileReadError('empty'))
    await expect(fileText('pdf', bytes('pas un PDF'))).rejects.toEqual(new FileReadError('unreadable'))
    await expect(fileText('docx', bytes('pas un zip'))).rejects.toEqual(new FileReadError('unreadable'))
  })

  it('knows which files it can read', () => {
    expect(['pdf', 'PDF', 'docx', 'xlsx', 'pptx', 'md', 'csv', 'html', 'result'].every(isReadable)).toBe(true)
    expect(['zip', 'msg', 'dwg', 'tiff'].some(isReadable)).toBe(false)
  })
})

describe('filesContext', () => {
  const words = {
    heading: (name: string, path: string) => `Fichier joint : ${name} (${path})`,
    truncated: (sent: number, total: number) => `[coupé : ${sent} sur ${total}]`
  }

  it('sends each file whole when it fits', () => {
    expect(filesContext([{ path: 'a/p.pdf', name: 'p.pdf', text: 'Radier' }], words)).toBe(
      'Fichier joint : p.pdf (a/p.pdf)\n<file path="a/p.pdf">\nRadier\n</file>'
    )
  })

  // Cut at a line, where one falls near the end, and the model told how much it read.
  it('cuts a long file at a line, and says so', () => {
    const text = Array.from({ length: 20 }, (_, at) => `ligne ${at}`).join('\n')
    const sent = filesContext([{ path: 'p.pdf', name: 'p.pdf', text }], words, 60)
    const body = sent.slice(sent.indexOf('>\n') + 2, sent.indexOf('\n\n['))
    expect(body.endsWith('ligne 6')).toBe(true)
    expect(sent).toContain(`[coupé : ${body.length} sur ${text.length}]`)
  })
})

describe('sharing the files’ budget', () => {
  it('sends a few files whole, and many a fair part each, never below a few pages', () => {
    expect(fileShare(1)).toBe(FILE_BUDGET)
    expect(fileShare(2)).toBe(FILE_BUDGET)
    expect(fileShare(4)).toBe(100000)
    expect(fileShare(10)).toBe(40000)
    expect(fileShare(100)).toBe(6000)
    // As the reader set it: whole, or their own budget shared.
    expect(fileShare(5, Infinity, Infinity)).toBe(Infinity)
    expect(fileShare(5, 50000, 100000)).toBe(20000)
  })

  it('looks for the question’s words of four letters or more, folded, once each', () => {
    expect(questionWords('Quand le radier est-il coulé ? Et le RADIER de la zone B ?')).toEqual([
      'quand',
      'radier',
      'coule',
      'zone'
    ])
  })
})

describe('excerptFor', () => {
  const filler = (n: number): string =>
    Array.from({ length: n }, (_, at) => `Paragraphe ${at} sans rapport.`).join('\n\n')
  const text = [
    '# Compte rendu',
    filler(40),
    'Le radier est décalé au 19/10.',
    filler(40),
    'Radier : coulage en zone B.',
    filler(10)
  ].join('\n\n')

  it('sends the opening, then the passages speaking of the question, in the document’s order', () => {
    const sent = excerptFor(text, 600, ['radier', 'zone']) ?? ''
    expect(sent.startsWith('# Compte rendu')).toBe(true)
    expect(sent).toContain('Le radier est décalé au 19/10.')
    expect(sent).toContain('Radier : coulage en zone B.')
    expect(sent.indexOf('décalé')).toBeLessThan(sent.indexOf('coulage'))
    // A mark wherever something was left out, between the passages too.
    expect(sent).toMatch(/décalé au 19\/10\.\n\n\[…\]\n\nRadier : coulage/)
    expect(sent).toContain('[…]')
    expect(sent.length).toBeLessThanOrEqual(600 + 40)
    expect(sent.endsWith('[…]')).toBe(true)
  })

  it('takes the passages holding the most of the words first when not all fit', () => {
    const sent = excerptFor(text, 45, ['radier', 'zone']) ?? ''
    expect(sent).toContain('coulage en zone B')
    expect(sent).not.toContain('décalé')
  })

  it('has nothing to offer when the text fits, or no passage holds a word', () => {
    expect(excerptFor('court', 600, ['radier'])).toBeNull()
    expect(excerptFor(text, 600, ['tunnel'])).toBeNull()
    expect(excerptFor(text, 600, [])).toBeNull()
  })

  it('takes a long table a few rows at a time', () => {
    const rows = Array.from(
      { length: 400 },
      (_, at) => `| Tâche ${at} | ${at === 250 ? 'Radier' : 'Autre'} | 19/10 |`
    ).join('\n')
    const sent = excerptFor(`# Planning\n\n${rows}`, 3000, ['radier']) ?? ''
    expect(sent).toContain('| Tâche 250 | Radier | 19/10 |')
    // Whole rows: none cut in the middle.
    for (const line of sent.split('\n').filter((each) => each.startsWith('|'))) expect(line).toMatch(/ \|$/)
    expect(sent.length).toBeLessThanOrEqual(3100)
  })
})

describe('filesContext with a question', () => {
  const words = {
    heading: (name: string) => `Fichier : ${name}`,
    truncated: (sent: number, total: number) => `[coupé : ${sent} sur ${total}]`,
    excerpted: (sent: number, total: number) => `[extraits : ${sent} sur ${total}]`
  }
  const text = `${'Début.\n\n'.repeat(30)}Le radier est décalé.\n\n${'Suite.\n\n'.repeat(30)}`

  it('sends the passages the question needs, and says it sent passages', () => {
    const sent = filesContext([{ path: 'p.pdf', name: 'p.pdf', text }], words, 120, ['radier'])
    expect(sent).toContain('Le radier est décalé.')
    expect(sent).toMatch(/\[extraits : \d+ sur \d+\]/)
  })

  it('cuts at the start as before when no passage speaks of it', () => {
    const sent = filesContext([{ path: 'p.pdf', name: 'p.pdf', text }], words, 120, ['tunnel'])
    expect(sent).not.toContain('radier')
    expect(sent).toMatch(/\[coupé : \d+ sur \d+\]/)
  })
})

describe('currentFiles', () => {
  it('is the files of the latest question', () => {
    expect(currentFiles([{ role: 'user', files: ['a.pdf'] }, { role: 'assistant' }])).toEqual(['a.pdf'])
    expect(currentFiles([{ role: 'user', files: ['a.pdf'] }, { role: 'user' }])).toEqual([])
  })
})

describe('pictures', () => {
  it('are attached, and handed to a model as a data URL', () => {
    expect(['png', 'JPG', 'jpeg', 'webp'].every(isReadable)).toBe(true)
    expect(isImage('PNG')).toBe(true)
    expect(isImage('pdf')).toBe(false)
    expect(imageDataUrl('png', new Uint8Array([137, 80, 78, 71]))).toBe('data:image/png;base64,iVBORw==')
  })

  // A scan is megabytes: turned into text in slices, or the call overflows.
  it('turns a large picture into a data URL', () => {
    const big = new Uint8Array(200_000).fill(65)
    const url = imageDataUrl('jpg', big)
    expect(url.startsWith('data:image/jpeg;base64,QUFB')).toBe(true)
    expect(url.length).toBe('data:image/jpeg;base64,'.length + Math.ceil(200_000 / 3) * 4)
  })
})
