import { describe, expect, it } from 'vitest'
import {
  needsOcr,
  readTranscript,
  readTranscriptSection,
  cleanTranscriptIn,
  stripFurniture,
  readsWhole,
  transcribe,
  transcriptNote,
  transcriptPath,
  withTranscriptSection,
  type OcrWords
} from './ocr'

const WORDS: OcrWords = {
  page: (page, total) => `Page ${page}/${total}`,
  failed: (page, reason) => `[Page ${page} illisible : ${reason}]`,
  skipped: (count) => `[${count} page(s) non lue(s)]`,
  layer: (page) => `[Page ${page} : texte du PDF]`
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
      3,
      { wait: () => Promise.resolve() }
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

describe('transcribing a whole document', () => {
  const noWait = { wait: () => Promise.resolve() }
  const source = (pages: number, layer?: (page: number) => string) => ({
    pages,
    render: (page: number) => Promise.resolve(`P${page}`),
    ...(layer ? { layer: (page: number) => Promise.resolve(layer(page)) } : {})
  })

  it('reads every page, however many, with no limit of its own', async () => {
    const out = await transcribe(source(45), (_image, page) => Promise.resolve(`p${page}`), WORDS)
    expect(out.read).toBe(45)
    expect(out.text).toContain('## Page 45/45\n\np45')
    expect(out.text).not.toContain('non lue')
  })

  it('asks again for a page that failed, a moment later, and names it only when it failed every time', async () => {
    const tries = new Map<number, number>()
    const waits: number[] = []
    const out = await transcribe(
      source(3),
      (_image, page) => {
        const n = (tries.get(page) ?? 0) + 1
        tries.set(page, n)
        if (page === 2 && n < 3) return Promise.reject(new Error('délai dépassé'))
        if (page === 3) return Promise.reject(new Error('refusé'))
        return Promise.resolve(`p${page}`)
      },
      WORDS,
      () => {},
      undefined,
      {
        wait: (ms) => {
          waits.push(ms)
          return Promise.resolve()
        }
      }
    )
    expect(out.text).toContain('## Page 2/3\n\np2')
    expect(out.text).toContain('[Page 3 illisible : refusé]')
    expect(out).toMatchObject({ read: 2, failed: 1 })
    expect([...tries.values()]).toEqual([1, 3, 3])
    expect(waits).toEqual([2000, 4000, 2000, 4000])
  })

  it('reads again a page read only in part, told so, and adds the PDF’s own text when it is still short', async () => {
    const layer = (page: number) => `Texte complet de la page ${page}. `.repeat(20)
    const insisted: number[] = []
    const out = await transcribe(
      source(3, layer),
      (_image, page, _total, insist) => {
        if (insist) insisted.push(page)
        // Page 1 whole at once; page 2 whole once told; page 3 short both times.
        if (page === 1 || (page === 2 && insist)) return Promise.resolve(layer(page))
        return Promise.resolve(`Début de la page ${page}.`)
      },
      WORDS,
      () => {},
      undefined,
      noWait
    )
    expect(insisted).toEqual([2, 3])
    expect(out.text).toContain(`## Page 2/3\n\n${layer(2).trim()}`)
    expect(out.text).toContain(`## Page 3/3\n\nDébut de la page 3.\n\n[Page 3 : texte du PDF]\n\n${layer(3).trim()}`)
    expect(out.text).not.toContain('[Page 1 : texte du PDF]')
  })

  it('judges a reading against the file’s own text only when that holds a page’s worth', () => {
    const page = 'Le placement fait partie du problème de découpe. '.repeat(10)
    expect(readsWhole(page, page)).toBe(true)
    expect(readsWhole(page.slice(0, page.length / 2), page)).toBe(false)
    expect(readsWhole('', 'Titre seul')).toBe(true)
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

describe('a transcription without its pages’ furniture', () => {
  // As a vision model reads a journal article: a running header, the publisher's footer,
  // the article's page number, a delivery stamp at the foot of some pages.
  const page = (n: number, body: string[], stamp = false): string =>
    [
      `## Page ${n} sur 6`,
      '',
      n === 1
        ? '## Optimisation du placement des formes irrégulières'
        : '## OPTIMISATION DU PLACEMENT DES FORMES IRRÉGULIÈRES',
      '',
      ...body,
      '',
      'Toute reproduction sans autorisation du Centre français d’exploitation du droit de copie est strictement interdite.',
      '© Techniques de l’Ingénieur, traité Informatique industrielle',
      '',
      `**S 7 212 - ${n}**`,
      ...(stamp
        ? ['', `Parution : décembre 2000 - Ce document a été délivré pour le compte de 7200105995 // 194.199.174.235`]
        : [])
    ].join('\n')
  const text = [
    page(1, ['Le placement fait partie du problème de découpe.', '| Colonne | Valeur |', '| --- | --- |']),
    page(2, ['### 1. Considérations générales', 'Le domaine du placement reste ouvert.', '| --- | --- |']),
    page(3, ['### 2. Description des formes', 'Le contour est discrétisé.', '$$', 'D = Int[C]', '$$'], true),
    page(4, ['Les peignes de contour.', '$$', 'D = Int[C]', '$$']),
    page(5, ['### 3. Représentation', 'Le placement est une combinaison ordonnée.'], true),
    page(6, ['### 7. Conclusion', 'Trois algorithmes ont été présentés.'])
  ].join('\n\n')

  it('drops the header, the footers, the page numbers and the stamp, and keeps the text, the title and the markup', () => {
    const { text: cleaned, removed } = stripFurniture(text)
    expect(cleaned).not.toContain('Toute reproduction')
    expect(cleaned).not.toContain('© Techniques')
    expect(cleaned).not.toContain('S 7 212')
    expect(cleaned).not.toContain('Parution')
    expect(cleaned).not.toContain('OPTIMISATION DU PLACEMENT')
    // The first heading of it is the document's title: kept.
    expect(cleaned).toContain('## Optimisation du placement des formes irrégulières')
    for (const kept of [
      'Le placement fait partie du problème de découpe.',
      '### 1. Considérations générales',
      '| --- | --- |',
      'D = Int[C]',
      'Trois algorithmes ont été présentés.',
      '## Page 3 sur 6'
    ]) {
      expect(cleaned).toContain(kept)
    }
    expect(cleaned).not.toMatch(/\n{3,}/)
    expect(removed.map((one) => [one.line.slice(0, 20), one.count])).toEqual([
      ['Toute reproduction s', 6],
      ['© Techniques de l’In', 6],
      ['**S 7 212 - 1**', 6],
      ['## OPTIMISATION DU P', 5],
      ['Parution : décembre ', 2]
    ])
  })

  it('tells a line of text from a page number, though both differ by a number from page to page', () => {
    const text = [1, 2, 3]
      .map((n) => `## Page ${n} sur 3\n\nRésultats du chapitre ${n}.\n\nCorps du chapitre ${n}.\n\nPage ${n}/3`)
      .join('\n\n')
    const { text: cleaned, removed } = stripFurniture(text)
    expect(cleaned).toContain('Résultats du chapitre 2.')
    expect(removed.map((one) => one.line)).toEqual(['Page 1/3'])
    // Nor a line that speaks of a page.
    const pages = [1, 2, 3, 4].map((n) => `## Page ${n} sur 4\n\nVoir la page ${n + 10}.\n\nPage ${n}`).join('\n\n')
    expect(stripFurniture(pages).text).toContain('Voir la page 13.')
  })

  it('leaves a text of one page, or with nothing repeated, as it is', () => {
    expect(stripFurniture(page(1, ['Seul.']))).toEqual({ text: page(1, ['Seul.']), removed: [] })
    const plain = '## Page 1 sur 2\n\nUn.\n\n## Page 2 sur 2\n\nDeux.'
    expect(stripFurniture(plain)).toEqual({ text: plain, removed: [] })
  })

  it('cleans the transcription of a record, and of a transcription note, and nothing else', () => {
    const words = { heading: 'Transcription', note: '> [!info] Lu' }
    const record = withTranscriptSection(
      '## Notes\n\nÀ relire.\n',
      { sourceMtime: 1, model: 'm', at: '', pages: 6 },
      text,
      words
    )
    const after = `${record}\n## Mes notes\n\nToute reproduction sans autorisation du Centre français d’exploitation du droit de copie est strictement interdite.\n`
    const cleaned = cleanTranscriptIn(after)
    expect(cleaned?.removed).toHaveLength(5)
    // What the reader wrote after the section is theirs.
    expect(
      cleaned?.content.endsWith(
        '## Mes notes\n\nToute reproduction sans autorisation du Centre français d’exploitation du droit de copie est strictement interdite.\n'
      )
    ).toBe(true)
    expect(readTranscriptSection(cleaned!.content)?.text).not.toContain('© Techniques')
    const note = transcriptNote({ source: 'a.pdf', sourceMtime: 1, model: 'm', at: '', pages: 6 }, text, '> [!info] Lu')
    const cleanedNote = cleanTranscriptIn(note)
    expect(cleanedNote?.content.startsWith('---\npm-transcript:')).toBe(true)
    expect(readTranscript(cleanedNote!.content)?.text).not.toContain('S 7 212')
    expect(cleanTranscriptIn('# Une note\n\nTexte.')).toBeNull()
  })
})
