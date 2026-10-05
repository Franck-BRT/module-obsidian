import type PMPlugin from '../../main'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import { excludedFolders, leftOut, libraryKey, type SourceDeps } from '../../store/rag/ragSources'
import { t } from '../../i18n'

/** How a document's filing is said to the index: the same words the indexing uses. */
export function ragFilingWords(): SourceDeps['words'] {
  return { category: t('rag.category'), lot: t('rag.lot'), issuer: t('rag.issuer'), tags: t('rag.tags') }
}

export type RagDocState = 'indexed' | 'stale' | 'missing' | 'excluded'

/**
 * Where a document of the library stands in the vault index: in it as it now is, in it as
 * it was before a change not read yet, not in it yet, or in a folder left out of it. Null
 * when the vault index is off.
 */
export function ragDocState(plugin: PMPlugin, doc: LibraryDoc): { state: RagDocState; passages: number } | null {
  if (!plugin.settings.rag.enabled || !plugin.ragIndexer.ready || !doc.file) return null
  if (leftOut(doc.file, excludedFolders(plugin.settings.rag.exclude))) return { state: 'excluded', passages: 0 }
  const entry = plugin.ragIndex.entry(doc.file)
  if (!entry) return { state: 'missing', passages: 0 }
  const key = libraryKey(doc, plugin.libraryText.entry(doc), ragFilingWords())
  return { state: entry.key === key ? 'indexed' : 'stale', passages: entry.passages.length }
}
