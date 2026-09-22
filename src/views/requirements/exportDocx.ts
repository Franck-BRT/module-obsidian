import { Notice, type TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Requirement } from '../../store/requirements/Requirement'
import type { ReqBlockField } from '../../store/requirements/reqBlockFields'
import { buildDocx, type DocxDocument } from '../../store/docx'
import { buildPdf } from '../../store/pdf'
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
export function docxWords(plugin: PMPlugin, stars = true): DocxWords {
  const langs = reqLanguages(plugin.settings)
  return {
    column: (field) => reqBlockFieldLabel(field),
    // Stars where the format can draw them. A PDF is written in Helvetica, which has no
    // star, and five question marks in a table would say something else entirely.
    rating: (requirement) => {
      const report = assessRequirement(requirement, langs)
      const score = Math.round(report.score * 100)
      return stars
        ? `${'★'.repeat(report.stars)}${'☆'.repeat(5 - report.stars)} ${score} %`
        : `${report.stars}/5 · ${score} %`
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

export type DocFormat = 'docx' | 'pdf'

/** The same document, written as whichever of the two was asked for. */
function render(doc: DocxDocument, format: DocFormat): Uint8Array {
  return format === 'pdf' ? buildPdf(doc) : buildDocx(doc)
}

async function write(plugin: PMPlugin, title: string, doc: DocxDocument, format: DocFormat): Promise<void> {
  const bytes = render(doc, format)
  const path = await plugin.porter.writeBinaryExport(
    exportFileName(title, format),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  new Notice(t('req.exported', { path }))
}

/**
 * The note, with every `pm-req` block expanded into its table.
 *
 * Written beside the library rather than opened: Obsidian shows neither a Word file nor a
 * PDF in a tab, and a tab of binary would be a worse answer than a line saying where the
 * file is.
 */
export async function exportNoteDocx(plugin: PMPlugin, file: TFile, format: DocFormat = 'docx'): Promise<void> {
  const content = await plugin.app.vault.cachedRead(file)
  const title = file.basename
  const doc = noteDocx(
    content,
    {
      title,
      lang: reqLanguages(plugin.settings)[0],
      library: plugin.index.requirementRefs(),
      fields: resolveBlockFields([], plugin.settings.requirements.blockFields),
      words: docxWords(plugin, format === 'docx')
    },
    docxGlyph(plugin)
  )
  await write(plugin, title, doc, format)
}

/** The library itself, the same shape the markdown export gives it. */
export async function exportLibraryDocx(
  plugin: PMPlugin,
  requirements: Requirement[],
  lang: string,
  format: DocFormat = 'docx'
): Promise<void> {
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
  await write(plugin, title, doc, format)
}
