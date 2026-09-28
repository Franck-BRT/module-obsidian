import { describe, expect, it } from 'vitest'
import { buildXlsx } from '../xlsx'
import {
  blocksText,
  currentFiles,
  fileText,
  filesContext,
  FileReadError,
  imageDataUrl,
  isImage,
  isReadable
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
    expect(['pdf', 'PDF', 'docx', 'xlsx', 'pptx', 'md', 'csv', 'html'].every(isReadable)).toBe(true)
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
