import { Notice, type TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Requirement } from '../../store/requirements/Requirement'
import type { ReqBlockField } from '../../store/requirements/reqBlockFields'
import { buildDocx, type DocxDocument } from '../../store/docx'
import { buildPdf } from '../../store/pdf'
import { toMarkdown } from '../../store/markdownDoc'
import { toHtml } from '../../store/htmlDoc'
import { isReqId } from '../../store/requirements/reqId'
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
import { inEveryLocale, t } from '../../i18n'
import type { DocxVocabulary } from '../../store/requirements/reqDocxRead'
import { xlsxVocabulary } from './exportXlsx'

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

export type DocFormat = 'docx' | 'pdf' | 'md' | 'html'

/**
 * The same document, written as whichever of the three was asked for.
 *
 * Markdown is the one that comes out as text rather than bytes: it goes through the
 * ordinary export, which is what lets it be opened in the vault it was written from.
 */
async function write(
  plugin: PMPlugin,
  title: string,
  doc: DocxDocument,
  format: DocFormat,
  source?: string
): Promise<string> {
  if (format === 'md' || format === 'html') {
    const meta = { exported: new Date().toISOString(), source }
    const text =
      format === 'md'
        ? toMarkdown(doc, meta)
        : toHtml(doc, { meta, anchor: (name) => (isReqId(name) ? name : undefined) })
    return plugin.porter.writeExport(exportFileName(title, format), text)
  }
  const bytes = format === 'pdf' ? buildPdf(doc) : buildDocx(doc)
  return plugin.porter.writeBinaryExport(
    exportFileName(title, format),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
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
      // Stars where the format can draw them: Markdown is read in a terminal as often as
      // in a renderer, and both hold the glyph.
      words: docxWords(plugin, format !== 'pdf')
    },
    docxGlyph(plugin)
  )
  const path = await write(plugin, title, doc, format, file.path)
  new Notice(t('req.exported', { path }))
  // Opened straight away, and only this one: a Markdown export is a note the vault can
  // show, and an export nobody looks at is an export nobody notices is wrong.
  if (format === 'md') await plugin.app.workspace.openLinkText(path, '', 'tab')
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
  new Notice(t('req.exported', { path: await write(plugin, title, doc, format) }))
}

/** A catalogue entry as a pattern, with `{lang}` standing for the language it names. */
function templatePattern(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{lang\\}', '([A-Za-z-]+)')
  return new RegExp(`^${escaped}$`)
}

/**
 * The Word export's words, turned round to read a document back: the spreadsheet's,
 * plus what only a document writes — the source line, the heading for requirements with
 * no category, the notes under a wording — in every language, since the document may
 * have been written in whichever was active that day.
 */
export function docxVocabulary(plugin: PMPlugin): DocxVocabulary {
  const fallback = inEveryLocale('req.fallbackFrom').map(templatePattern)
  const marks = [...inEveryLocale('req.flag.stale'), ...inEveryLocale('req.machineWording')]
  return {
    ...xlsxVocabulary(plugin),
    sourceLabels: inEveryLocale('req.field.source'),
    noCategory: inEveryLocale('req.noCategory'),
    // Beside the export's own header, what other people's specifications title the column
    // that holds the words — so a supplier's table reads without being retitled first.
    wording: [
      ...inEveryLocale('req.field.wording'),
      'Exigence',
      'Requirement',
      'Texte',
      'Text',
      'Description',
      'Libellé'
    ],
    isMark: (line) => marks.includes(line) || fallback.some((pattern) => pattern.test(line)),
    fallbackLang: (line) => {
      for (const pattern of fallback) {
        const found = pattern.exec(line)
        if (found) return found[1].toLowerCase()
      }
      return undefined
    }
  }
}
