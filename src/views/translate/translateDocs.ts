import { normalizePath, Notice, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import { LlmClient } from '../../store/llm/client'
import { chatModel } from '../../store/chat/chatModels'
import { openDocxForTranslation, translatedName } from '../../store/translate/docxTranslate'
import {
  parseGlossary,
  translateTexts,
  TranslationStopped,
  type GlossaryEntry
} from '../../store/translate/translateTexts'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { today } from '../../dates'
import { t } from '../../i18n'

/** The documents that can be translated: Word documents, PowerPoint decks and Excel workbooks. */
export function translatable(doc: LibraryDoc): boolean {
  return !!doc.file && /\.(docx|pptx|xlsx)$/i.test(doc.file)
}

/** The glossary note's path. */
export function glossaryPath(plugin: PMPlugin): string {
  const set = plugin.settings.translationGlossary.trim()
  const path = set || t('translate.glossaryDefault')
  return normalizePath(path.endsWith('.md') ? path : `${path}.md`)
}

/** The glossary note, made with an example when there is none yet; opened for the reader. */
export async function openGlossary(plugin: PMPlugin): Promise<void> {
  const app = plugin.app
  const path = glossaryPath(plugin)
  let file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) {
    const folder = folderOf(path)
    if (folder) await ensureFolder(app, folder)
    file = await app.vault.create(path, t('translate.glossaryTemplate'))
  }
  if (file instanceof TFile) await app.workspace.getLeaf('tab').openFile(file)
}

async function readGlossary(plugin: PMPlugin): Promise<GlossaryEntry[]> {
  const file = plugin.app.vault.getAbstractFileByPath(glossaryPath(plugin))
  return file instanceof TFile ? parseGlossary(await plugin.app.vault.cachedRead(file)) : []
}

/**
 * Documents translated, one after another in the queue the scans wait in: each read,
 * translated a batch of paragraphs at a time, written back as a Word document of its
 * own, poured into the library beside the source — same folder, same projects, filed
 * alike — and marked as its translation. False when no model is set up.
 */
export async function translateDocuments(
  plugin: PMPlugin,
  docs: LibraryDoc[],
  language: string,
  useGlossary: boolean
): Promise<boolean> {
  const llm = plugin.settings.llm
  const model = llm.modelTranslate.trim() || chatModel(plugin.settings.chat.model, llm.modelText)
  if (!llm.enabled || !llm.baseUrl.trim() || !model) {
    new Notice(t('translate.noModel'), 10000)
    return false
  }
  const client = new LlmClient({ settings: llm })
  const glossary = useGlossary ? await readGlossary(plugin) : []
  const code = language.toUpperCase()
  void plugin.scans.add(
    docs.filter(translatable).map((doc) => ({
      key: `translate:${doc.record}:${language}`,
      title: `${doc.title} → ${code}`,
      kind: 'translate' as const,
      run: async (progress, stopped) => {
        const file = plugin.app.vault.getAbstractFileByPath(doc.file)
        if (!(file instanceof TFile)) throw new Error(t('library.fileMissing'))
        try {
          const opened = await openDocxForTranslation(new Uint8Array(await plugin.app.vault.readBinary(file)), language)
          const translations = await translateTexts(
            client,
            opened.texts,
            { model, to: language, glossary },
            progress,
            stopped
          )
          const bytes = opened.build((text) => translations.get(text))
          const report = await plugin.library.pour(
            [
              {
                kind: 'bytes',
                name: translatedName(doc.file, language),
                bytes,
                title: `${doc.title} (${code})`,
                projects: doc.projects,
                classification: { category: doc.category, lot: doc.lot, issuer: doc.issuer, tags: doc.tags }
              }
            ],
            { projects: [], move: false, today: today().toString(), folder: doc.folder }
          )
          if (report.failed.length) throw new Error(report.failed[0].reason)
          const made = report.docs[0] ?? plugin.library.docs().find((one) => one.record === report.known[0])
          if (made) await plugin.library.setTranslationOf(made, doc, language)
          new Notice(t('translate.written', { title: doc.title, name: translatedName(doc.file, language) }), 8000)
          // Texts the workbook's formulas compare with, left as they were: said, so none is a surprise.
          if (opened.kept.length) {
            new Notice(
              t('translate.kept', { count: opened.kept.length, list: opened.kept.slice(0, 8).join(', ') }),
              15000
            )
          }
        } catch (error) {
          if (error instanceof TranslationStopped) new Notice(t('translate.stopped', { title: doc.title }))
          else {
            new Notice(
              t('translate.failed', {
                title: doc.title,
                reason: error instanceof Error ? error.message : String(error)
              }),
              10000
            )
          }
          throw error
        }
      }
    }))
  )
  return true
}
