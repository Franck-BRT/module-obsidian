import { normalizePath, Notice, TFile, type App } from 'obsidian'
import { imageDataUrl, isImage } from '../../store/chat/chatFile'
import { readTranscript, transcribe, transcriptNote, transcriptPath, type OcrSource } from '../../store/chat/ocr'
import type { LlmClient } from '../../store/llm/client'
import { t } from '../../i18n'
import { pdfPages } from './pdfPages'

/**
 * A scan read by a model that sees: the chat's way of reading one, and the library's.
 *
 * Its transcription is kept in a note beside it and read instead, as long as the document
 * has not changed — a scan is slow and not free to read, and the reader may have corrected
 * what the model made of a blurred date. The chat and the library share that note: a
 * planning read once for a question is found by the library's search, and the other way.
 */

/** The pages of a picture or a PDF, drawn for the model. */
export async function scanPages(file: TFile, bytes: Uint8Array): Promise<OcrSource & { close: () => void }> {
  if (isImage(file.extension)) {
    return { pages: 1, render: () => Promise.resolve(imageDataUrl(file.extension, bytes)), close: () => {} }
  }
  return pdfPages(bytes)
}

/** The transcription kept beside a document, when there is one for it as it now is. */
export async function keptTranscript(app: App, file: TFile): Promise<string | null> {
  const note = app.vault.getAbstractFileByPath(normalizePath(transcriptPath(file.path, t('chat.ocrSuffix'))))
  if (!(note instanceof TFile)) return null
  const kept = readTranscript(await app.vault.cachedRead(note))
  return kept && kept.sourceMtime === file.stat.mtime && kept.text ? kept.text : null
}

/**
 * The document's text as a model reads it, page by page, with a notice saying how far it
 * has got; the transcription kept beside it, or the one kept already read instead.
 */
export async function transcribeScan(
  app: App,
  llm: LlmClient,
  model: string,
  file: TFile,
  source: OcrSource
): Promise<{ text: string; fresh: boolean }> {
  const kept = await keptTranscript(app, file)
  if (kept) return { text: kept, fresh: false }
  const path = normalizePath(transcriptPath(file.path, t('chat.ocrSuffix')))
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
    const note = transcriptNote(
      { source: file.path, sourceMtime: file.stat.mtime, model, at: new Date().toISOString(), pages: source.pages },
      result.text,
      t('chat.ocrHeading', { model })
    )
    const existing = app.vault.getAbstractFileByPath(path)
    if (existing instanceof TFile) await app.vault.modify(existing, note)
    else await app.vault.create(path, note)
    new Notice(t('chat.ocrDone', { name: file.name, path }), 8000)
    return { text: result.text, fresh: true }
  } finally {
    notice.hide()
  }
}
