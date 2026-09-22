import { Notice, type TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Requirement } from '../../store/requirements/Requirement'
import type { ReqBlockField } from '../../store/requirements/reqBlockFields'
import { buildDocx } from '../../store/docx'
import { libraryDocx, noteDocx, type DocxWords } from '../../store/requirements/reqDocx'
import { resolveBlockFields } from '../../store/requirements/reqBlockFields'
import { assessRequirement } from '../../store/requirements/reqScore'
import { exportFileName } from '../../store/requirements/ReqPorter'
import {
  reqBlockFieldLabel,
  reqCriticalityGlyph,
  reqLanguages,
  reqStatusGlyph,
  reqTypeGlyph,
  verificationLabel
} from './reqPalette'
import { t } from '../../i18n'

/**
 * The words a Word document needs, which the store has no business knowing.
 *
 * The shape of the document is decided down in the store, where it can be proved; what
 * it is called in French is decided here, where the palettes and the catalogue are.
 */
export function docxWords(plugin: PMPlugin): DocxWords {
  const langs = reqLanguages(plugin.settings)
  return {
    column: (field) => reqBlockFieldLabel(field),
    rating: (requirement) => {
      const report = assessRequirement(requirement, langs)
      return `${'★'.repeat(report.stars)}${'☆'.repeat(5 - report.stars)} ${Math.round(report.score * 100)} %`
    },
    note: (kind, lang) => {
      if (kind === 'fallback') return t('req.fallbackFrom', { lang: lang.toUpperCase() })
      return kind === 'stale' ? t('req.flag.stale') : t('req.machineWording')
    },
    missing: (id) => t('req.block.missing', { id }),
    empty: t('req.block.none')
  }
}

/** A field's value as the reader sees it on screen: the palette's label, not the stored id. */
export function docxGlyph(plugin: PMPlugin): (requirement: Requirement, field: ReqBlockField) => string {
  return (requirement, field) => {
    if (field === 'type') return reqTypeGlyph(plugin.settings, requirement.type).label
    if (field === 'status') return reqStatusGlyph(plugin.settings, requirement.status).label
    if (field === 'criticality') return reqCriticalityGlyph(plugin.settings, requirement.criticality).label
    if (field === 'verification') {
      return requirement.verification === 'none' ? '' : verificationLabel(requirement.verification)
    }
    return ''
  }
}

/**
 * The note as a Word file, with every `pm-req` block expanded into its table.
 *
 * Written beside the library rather than opened: Obsidian cannot show a Word file, and a
 * tab of binary would be a worse answer than a line saying where the file is.
 */
export async function exportNoteDocx(plugin: PMPlugin, file: TFile): Promise<void> {
  const content = await plugin.app.vault.cachedRead(file)
  const title = file.basename
  const doc = noteDocx(
    content,
    {
      title,
      lang: reqLanguages(plugin.settings)[0],
      library: plugin.index.requirementRefs(),
      fields: resolveBlockFields([], plugin.settings.requirements.blockFields),
      words: docxWords(plugin)
    },
    docxGlyph(plugin)
  )
  const bytes = buildDocx(doc)
  const path = await plugin.porter.writeBinaryExport(
    exportFileName(title, 'docx'),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  new Notice(t('req.exported', { path }))
}

/** The library itself as a Word file, the same shape the markdown export gives it. */
export async function exportLibraryDocx(plugin: PMPlugin, requirements: Requirement[], lang: string): Promise<void> {
  const title = t('req.libraryTitle')
  const doc = libraryDocx(requirements, {
    title,
    lang,
    meta: (requirement) => {
      const bits = [
        reqStatusGlyph(plugin.settings, requirement.status).label,
        reqTypeGlyph(plugin.settings, requirement.type).label,
        reqCriticalityGlyph(plugin.settings, requirement.criticality).label
      ].filter((bit) => bit !== '')
      if (requirement.verification !== 'none') bits.push(verificationLabel(requirement.verification))
      return bits.join(' · ')
    },
    sourceLabel: t('req.field.source'),
    noCategory: t('req.noCategory')
  })
  const bytes = buildDocx(doc)
  const path = await plugin.porter.writeBinaryExport(
    exportFileName(title, 'docx'),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  new Notice(t('req.exported', { path }))
}
