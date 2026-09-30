import { normalizePath, Notice, TFile, type App } from 'obsidian'
import { imageDataUrl, isImage } from '../../store/chat/chatFile'
import {
  readTranscript,
  readTranscriptSection,
  stripFurniture,
  transcribe,
  transcriptNote,
  transcriptPath,
  withTranscriptSection,
  type OcrSource,
  type TranscriptMeta
} from '../../store/chat/ocr'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import type { LlmClient } from '../../store/llm/client'
import { t } from '../../i18n'
import { pdfPages } from './pdfPages'

/**
 * A scan read by a model that sees: the chat's way of reading one, and the library's.
 *
 * Its transcription is kept and read instead, as long as the document has not changed — a
 * scan is slow and not free to read, and the reader may have corrected what the model
 * made of a blurred date. A document of the library keeps it in its own record, the note
 * made when it was poured in, under a heading of its own; any other file in a note beside
 * it. The chat and the library share it: a planning read once for a question is found by
 * the library's search, and the other way.
 */

/** The library's documents, to find the record a file has. */
export interface Records {
  docs(): LibraryDoc[]
}

/** The record a file of the library has: the note made when it was poured in. */
export function recordOf(app: App, records: Records | undefined, path: string): TFile | null {
  const doc = records?.docs().find((one) => one.file === path)
  const record = doc ? app.vault.getAbstractFileByPath(doc.record) : null
  return record instanceof TFile ? record : null
}

/** Where a file's transcription can be read: its record when it holds one, else the note beside it. */
export async function transcriptFile(app: App, records: Records | undefined, path: string): Promise<TFile | null> {
  const record = recordOf(app, records, path)
  if (record && readTranscriptSection(await app.vault.cachedRead(record))) return record
  const note = app.vault.getAbstractFileByPath(normalizePath(transcriptPath(path, t('chat.ocrSuffix'))))
  return note instanceof TFile ? note : null
}

/** The pages of a picture or a PDF, drawn for the model. */
export async function scanPages(file: TFile, bytes: Uint8Array): Promise<OcrSource & { close: () => void }> {
  if (isImage(file.extension)) {
    return { pages: 1, render: () => Promise.resolve(imageDataUrl(file.extension, bytes)), close: () => {} }
  }
  return pdfPages(bytes)
}

/**
 * The transcription kept for a document as it now is: in its record, or in the note beside
 * it. One found beside a document that has a record is moved into it, the note to the
 * trash: a transcription is the record's to hold.
 */
export async function keptTranscript(app: App, file: TFile, records?: Records): Promise<string | null> {
  const record = recordOf(app, records, file.path)
  if (record) {
    const held = readTranscriptSection(await app.vault.cachedRead(record))
    if (held && held.sourceMtime === file.stat.mtime && held.text) return held.text
  }
  const note = app.vault.getAbstractFileByPath(normalizePath(transcriptPath(file.path, t('chat.ocrSuffix'))))
  if (!(note instanceof TFile)) return null
  const kept = readTranscript(await app.vault.cachedRead(note))
  if (!kept || kept.sourceMtime !== file.stat.mtime || !kept.text) return null
  if (record) {
    await keepInRecord(app, record, kept, kept.text)
    await app.fileManager.trashFile(note)
  }
  return kept.text
}

async function keepInRecord(app: App, record: TFile, meta: Omit<TranscriptMeta, 'source'>, text: string) {
  const words = {
    heading: t('library.transcriptHeading'),
    note: t('library.transcriptNote', { model: meta.model || '—' })
  }
  await app.vault.process(record, (content) => withTranscriptSection(content, meta, text, words))
}

/**
 * The document's text as a model reads it, page by page, with a notice saying how far it
 * has got; kept in its record or beside it, or the one kept already read instead.
 */
export async function transcribeScan(
  app: App,
  llm: LlmClient,
  model: string,
  file: TFile,
  source: OcrSource,
  records?: Records
): Promise<{ text: string; fresh: boolean }> {
  const kept = await keptTranscript(app, file, records)
  if (kept) return { text: kept, fresh: false }
  const notice = new Notice(t('chat.ocrReading', { name: file.name, page: 1, total: source.pages }), 0)
  try {
    const result = await transcribe(
      source,
      (image, page, total) => llm.readImage({ model, prompt: t('chat.ocrPrompt', { page, total }), image }),
      {
        page: (page, total) => t('chat.ocrPage', { page, total }),
        failed: (page, reason) => t('chat.ocrPageFailed', { page, reason }),
        skipped: (count) => t('chat.ocrSkipped', { count })
      },
      (page, total) => notice.setMessage(t('chat.ocrReading', { name: file.name, page, total }))
    )
    // Nothing read at all is a model that does not see, most likely: said as such.
    if (!result.read) throw new Error(t('chat.ocrNothing', { model }))
    // What the printed pages repeat — headers, footers, page numbers — is not the document.
    const text = stripFurniture(result.text).text
    const meta = { sourceMtime: file.stat.mtime, model, at: new Date().toISOString(), pages: source.pages }
    const record = recordOf(app, records, file.path)
    if (record) {
      await keepInRecord(app, record, meta, text)
      new Notice(t('chat.ocrDone', { name: file.name, path: record.path }), 8000)
      return { text, fresh: true }
    }
    const path = normalizePath(transcriptPath(file.path, t('chat.ocrSuffix')))
    const note = transcriptNote({ source: file.path, ...meta }, text, t('chat.ocrHeading', { model }))
    const existing = app.vault.getAbstractFileByPath(path)
    if (existing instanceof TFile) await app.vault.modify(existing, note)
    else await app.vault.create(path, note)
    new Notice(t('chat.ocrDone', { name: file.name, path }), 8000)
    return { text, fresh: true }
  } finally {
    notice.hide()
  }
}
