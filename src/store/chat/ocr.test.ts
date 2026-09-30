import { describe, expect, it } from 'vitest'
import {
  needsOcr,
  readTranscript,
  readTranscriptSection,
  transcribe,
  transcriptNote,
  transcriptPath,
  withTranscriptSection,
  type OcrWords
} from './ocr'

const WORDS: OcrWords = {
  page: (page, total) => `Page ${page}/${total}`,
  failed: (page, reason) => `[Page ${page} illisible : ${reason}]`,
  skipped: (count) => `[${count} page(s) non lue(s)]`
}

describe('needsOcr', () => {
  it('takes a PDF with a title block around a picture for one to read as an image', () => {
    expect(needsOcr('# Planning\n\nIndice C', 1)).toBe(true)
    expect(needsOcr('', 3)).toBe(true)
    const table = Array.from({ length: 10 }, (_, at) => `| ${at} | Tâche ${at} | 01/09/2026 | 12/09/2026 |`).join('\n')
    expect(needsOcr(table, 1)).toBe(false)
    // The same text over twenty pages is too thin to be the document.
    expect(needsOcr(table, 20)).toBe(true)
  })
})

describe('transcribe', () => {
  const source = (pages: number) => ({
    pages,
    render: (page: number) => Promise.resolve(`data:image/jpeg;base64,P${page}`)
  })

  it('reads every page in turn, under its number', async () => {
    const seen: string[] = []
    const told: string[] = []
    const out = await transcribe(
      source(2),
      (image, page, total) => {
        seen.push(`${image} ${page}/${total}`)
        return Promise.resolve(` | Tâche ${page} | \n`)
      },
      WORDS,
      (page, total) => told.push(`${page}/${total}`)
    )
    expect(seen).toEqual(['data:image/jpeg;base64,P1 1/2', 'data:image/jpeg;base64,P2 2/2'])
    expect(told).toEqual(['1/2', '2/2'])
    expect(out).toEqual({ text: '## Page 1/2\n\n| Tâche 1 |\n\n## Page 2/2\n\n| Tâche 2 |', read: 2, failed: 0 })
  })

  it('reads a single page without a heading', async () => {
    const out = await transcribe(source(1), () => Promise.resolve('Radier'), WORDS)
    expect(out.text).toBe('Radier')
  })

  // One page failing says so in its place; the others are still read.
  it('keeps going past a page that cannot be read, and names the pages past the limit', async () => {
    const out = await transcribe(
      source(5),
      (_image, page) => (page === 2 ? Promise.reject(new Error('délai dépassé')) : Promise.resolve(`p${page}`)),
      WORDS,
      () => {},
      3
    )
    expect(out).toEqual({
      text: [
        '## Page 1/5\n\np1',
        '## Page 2/5\n\n[Page 2 illisible : délai dépassé]',
        '## Page 3/5\n\np3',
        '[2 page(s) non lue(s)]'
      ].join('\n\n'),
      read: 2,
      failed: 1
    })
  })
})

describe('the transcription note', () => {
  const meta = {
    source: 'Work/Ligne 6/_docs/Planning scanné.pdf',
    sourceMtime: 1759000000000,
    model: 'qwen2.5-vl-72b',
    at: '2026-09-28T12:00:00.000Z',
    pages: 2
  }

  it('says where it came from, and gives back its text as the reader left it', () => {
    const note = transcriptNote(meta, '| Radier | 19/10/2026 |', '> [!info] Lu par qwen2.5-vl-72b')
    expect(
      note.startsWith('---\npm-transcript: "[[Work/Ligne 6/_docs/Planning scanné.pdf]]"\nsource-mtime: 1759000000000\n')
    ).toBe(true)
    expect(readTranscript(note)).toEqual({
      sourceMtime: 1759000000000,
      text: '| Radier | 19/10/2026 |',
      model: 'qwen2.5-vl-72b',
      at: '2026-09-28T12:00:00.000Z',
      pages: 2
    })
    const corrected = note.replace('19/10/2026', '20/10/2026')
    expect(readTranscript(corrected)?.text).toBe('| Radier | 20/10/2026 |')
  })

  it('is not taken for any other note', () => {
    expect(readTranscript('---\ntitle: x\n---\nTexte')).toBeNull()
    expect(readTranscript('Texte')).toBeNull()
  })

  it('sits beside its document, named after it', () => {
    expect(transcriptPath('Work/_docs/Planning C.pdf', 'transcription')).toBe(
      'Work/_docs/Planning C (transcription).md'
    )
    expect(transcriptPath('scan.png', 'transcription')).toBe('scan (transcription).md')
  })
})

describe('the transcription in a library record', () => {
  const meta = { sourceMtime: 1759000000000, model: 'qwen2.5-vl', at: '2026-09-28T12:00:00.000Z', pages: 2 }
  const words = { heading: 'Transcription', note: '> [!info] Lu par qwen2.5-vl' }
  const record = '---\npm-library-doc: true\ntitle: Planning\n---\n\n## Notes\n\nÀ relire avec Anne.\n'
  const text = '## Page 1/2\n\n| Radier | 19/10/2026 |\n\n## Page 2/2\n\n| Dalle | 26/10/2026 |'

  it('goes at the end, under its heading, the notes left as they were, and reads back', () => {
    const kept = withTranscriptSection(record, meta, text, words)
    expect(
      kept.startsWith(`${record.trimEnd()}\n\n## Transcription\n\n%% pm-transcript {"sourceMtime":1759000000000,`)
    ).toBe(true)
    // One level under its own heading.
    expect(kept).toContain('\n### Page 1/2\n\n| Radier | 19/10/2026 |\n')
    expect(kept.endsWith('%% /pm-transcript %%\n')).toBe(true)
    expect(readTranscriptSection(kept)).toEqual({
      sourceMtime: 1759000000000,
      text: '### Page 1/2\n\n| Radier | 19/10/2026 |\n\n### Page 2/2\n\n| Dalle | 26/10/2026 |'
    })
    // Corrected by the reader: as corrected.
    expect(readTranscriptSection(kept.replace('19/10', '20/10'))?.text).toContain('| Radier | 20/10/2026 |')
  })

  it('replaces the one there, heading and all, whatever was written after it', () => {
    const first = withTranscriptSection(record, meta, text, words)
    const later = `${first}\n## Suite\n\nAjouté après.\n`
    const again = withTranscriptSection(later, { ...meta, sourceMtime: 1760000000000 }, 'Nouveau texte', words)
    expect(again.match(/## Transcription/g)).toHaveLength(1)
    expect(again).not.toContain('Radier')
    expect(again).toContain('Nouveau texte\n\n%% /pm-transcript %%\n\n## Suite\n\nAjouté après.')
    expect(again).toContain('À relire avec Anne.')
    expect(readTranscriptSection(again)).toEqual({ sourceMtime: 1760000000000, text: 'Nouveau texte' })
  })

  it('is none in a record without one, and read again when its facts do not read', () => {
    expect(readTranscriptSection(record)).toBeNull()
    expect(readTranscriptSection('%% pm-transcript oops %%\n> note\nTexte\n%% /pm-transcript %%')).toEqual({
      sourceMtime: 0,
      text: 'Texte'
    })
  })
})
