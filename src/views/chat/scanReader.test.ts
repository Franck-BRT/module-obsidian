import { TFile, type App } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { makeFakeApp } from '../../../test/fakeVault'
import type { LlmClient } from '../../store/llm/client'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import { setLocale } from '../../i18n'
import { keptTranscript, transcribeScan, transcriptFile } from './scanReader'

/**
 * A scan's transcription, kept where the reader expects it: in the record of a document of
 * the library, beside any other file — and one kept beside a document of the library before
 * is moved into its record.
 */

setLocale('fr')

const doc = (file: string, record: string): LibraryDoc => ({
  record,
  title: 'Planning',
  file,
  projects: [],
  added: '2026-09-28',
  size: 0,
  hash: 'h',
  category: '',
  lot: '',
  issuer: '',
  tags: [],
  folder: ''
})

async function setUp() {
  const fake = makeFakeApp({ liveMetadataCache: true })
  const app = fake.app as unknown as App
  await fake.vault.createBinary('Bibliothèque/_files/Planning.pdf', new ArrayBuffer(4))
  await fake.vault.create('Bibliothèque/Planning.md', '---\npm-library-doc: true\n---\n\n## Notes\n\nÀ relire.\n')
  await fake.vault.createBinary('Ailleurs/Scan.pdf', new ArrayBuffer(4))
  const records = { docs: () => [doc('Bibliothèque/_files/Planning.pdf', 'Bibliothèque/Planning.md')] }
  const file = (path: string): TFile => {
    const found = app.vault.getAbstractFileByPath(path)
    if (!(found instanceof TFile)) throw new Error(`no file ${path}`)
    return found
  }
  let reads = 0
  const llm = {
    readImage: () => {
      reads++
      return Promise.resolve('| Radier | 19/10/2026 |')
    }
  } as unknown as LlmClient
  const source = { pages: 1, render: () => Promise.resolve('data:image/png;base64,') }
  return { app, records, file, llm, source, reads: () => reads }
}

describe('a scan read by a model', () => {
  it('keeps the transcription of a library document in its record, and reads it from there', async () => {
    const { app, records, file, llm, source, reads } = await setUp()
    const pdf = file('Bibliothèque/_files/Planning.pdf')
    expect(await transcribeScan(app, llm, 'vision', pdf, source, records)).toEqual({
      text: '| Radier | 19/10/2026 |',
      fresh: true
    })
    const record = await app.vault.read(file('Bibliothèque/Planning.md'))
    expect(record).toContain('## Notes\n\nÀ relire.\n\n## Transcription\n\n%% pm-transcript')
    expect(record).toContain('| Radier | 19/10/2026 |')
    // No note beside it.
    expect(app.vault.getAbstractFileByPath('Bibliothèque/_files/Planning (transcription).md')).toBeNull()
    // Asked again: read from the record, not from the model.
    expect(await transcribeScan(app, llm, 'vision', pdf, source, records)).toMatchObject({ fresh: false })
    expect(reads()).toBe(1)
    expect((await transcriptFile(app, records, pdf.path))?.path).toBe('Bibliothèque/Planning.md')
  })

  it('keeps any other file’s beside it, as before', async () => {
    const { app, records, file, llm, source } = await setUp()
    const scan = file('Ailleurs/Scan.pdf')
    await transcribeScan(app, llm, 'vision', scan, source, records)
    expect(app.vault.getAbstractFileByPath('Ailleurs/Scan (transcription).md')).toBeInstanceOf(TFile)
    expect(await keptTranscript(app, scan, records)).toBe('| Radier | 19/10/2026 |')
    expect((await transcriptFile(app, records, scan.path))?.path).toBe('Ailleurs/Scan (transcription).md')
  })

  it('moves a transcription kept beside a library document into its record, the note to the trash', async () => {
    const { app, records, file, llm, source } = await setUp()
    const pdf = file('Bibliothèque/_files/Planning.pdf')
    // Made the old way: no record known then.
    await transcribeScan(app, llm, 'vision', pdf, source)
    const beside = 'Bibliothèque/_files/Planning (transcription).md'
    const note = file(beside)
    await app.vault.modify(note, (await app.vault.read(note)).replace('19/10', '20/10'))
    expect(await keptTranscript(app, pdf, records)).toBe('| Radier | 20/10/2026 |')
    expect(app.vault.getAbstractFileByPath(beside)).toBeNull()
    const record = await app.vault.read(file('Bibliothèque/Planning.md'))
    expect(record).toContain('| Radier | 20/10/2026 |')
    expect(record).toContain('"model":"vision"')
    expect(await keptTranscript(app, pdf, records)).toBe('| Radier | 20/10/2026 |')
  })

  it('takes out what the printed pages repeat before keeping the transcription', async () => {
    const { app, records, file } = await setUp()
    let page = 0
    const llm = {
      readImage: () => {
        page++
        return Promise.resolve(
          `Texte propre au chapitre ${page}.\n\nToute reproduction interdite © Éditeur\n\nS 7 212 - ${page}`
        )
      }
    } as unknown as LlmClient
    const source = { pages: 3, render: () => Promise.resolve('data:image/png;base64,') }
    const read = await transcribeScan(app, llm, 'vision', file('Bibliothèque/_files/Planning.pdf'), source, records)
    expect(read.text).toContain('Texte propre au chapitre 3.')
    expect(read.text).not.toContain('Toute reproduction')
    expect(read.text).not.toContain('S 7 212')
    expect(await app.vault.read(file('Bibliothèque/Planning.md'))).not.toContain('© Éditeur')
  })
})
