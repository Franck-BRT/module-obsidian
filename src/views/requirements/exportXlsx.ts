import { Notice } from 'obsidian'
import type PMPlugin from '../../main'
import type { Requirement } from '../../store/requirements/Requirement'
import { buildXlsx } from '../../store/xlsx'
import { buildPptx } from '../../store/pptx'
import { libraryDeck, type PptxWords } from '../../store/requirements/reqPptx'
import { assessRequirement } from '../../store/requirements/reqScore'
import { coverageOf, type CoverageGap } from '../../store/requirements/ReqCoverage'
import { libraryWorkbook, type XlsxWords } from '../../store/requirements/reqXlsx'
import { exportFileName } from '../../store/requirements/ReqPorter'
import { reqCriticalityGlyph, reqLanguages, reqStatusGlyph, reqTypeGlyph, verificationLabel } from './reqPalette'
import { t } from '../../i18n'

/**
 * The library as a spreadsheet, in the reader's words.
 *
 * The shape is decided in the store, where it can be proved; the labels are decided here,
 * where the palettes and the catalogue live. A status is written as the word on the badge
 * rather than the identifier behind it: a spreadsheet is filtered by reading it.
 */
function xlsxWords(
  plugin: PMPlugin,
  gapLabel: (gap: CoverageGap) => string,
  noteName: (path: string) => string
): XlsxWords {
  return {
    columns: {
      id: t('req.field.id'),
      title: t('req.field.title'),
      category: t('req.field.category'),
      type: t('req.field.type'),
      status: t('req.field.status'),
      criticality: t('req.field.criticality'),
      verification: t('req.field.verification'),
      source: t('req.field.source'),
      rationale: t('req.field.rationale'),
      owner: t('req.field.owner'),
      tags: t('req.field.tags'),
      aliases: t('req.aliases'),
      sourceLang: t('req.sourceLang'),
      rev: t('req.field.rev'),
      links: t('req.links'),
      rating: t('req.field.rating'),
      citedIn: t('req.citedIn'),
      satisfiedBy: t('req.satisfiedBy'),
      derivedBy: t('req.field.derivedBy'),
      gaps: t('req.field.state')
    },
    sheet: { requirements: t('req.libraryTitle'), trace: t('req.modeTrace') },
    glyph: (requirement, field) => {
      if (field === 'type') return reqTypeGlyph(plugin.settings, requirement.type).label
      if (field === 'status') return reqStatusGlyph(plugin.settings, requirement.status).label
      if (field === 'criticality') return reqCriticalityGlyph(plugin.settings, requirement.criticality).label
      return requirement.verification === 'none' ? '' : verificationLabel(requirement.verification)
    },
    gap: (gap) => gapLabel(gap as CoverageGap),
    note: noteName
  }
}

/**
 * Written with whatever has been counted, and honest about the rest.
 *
 * The citations are read from the notes, which takes a pass over the vault; a reader who
 * exports before that pass has run gets a traceability sheet with empty citation cells
 * rather than a wait they did not ask for. The count is started on the way out, so the
 * next export has it.
 */
export async function exportLibraryXlsx(
  plugin: PMPlugin,
  requirements: Requirement[],
  usage: Map<string, string[]> | null,
  gapLabel: (gap: CoverageGap) => string,
  noteName: (path: string) => string
): Promise<void> {
  const langs = reqLanguages(plugin.settings)
  const counted: Map<string, string[]> = usage ?? new Map<string, string[]>()
  const coverage = coverageOf({ library: requirements, usage: counted, languages: langs })
  const sheets = libraryWorkbook(requirements, coverage, xlsxWords(plugin, gapLabel, noteName))
  const bytes = buildXlsx(sheets)
  const path = await plugin.porter.writeBinaryExport(
    exportFileName(t('req.libraryTitle'), 'xlsx'),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  new Notice(t('req.exported', { path }))
}

/**
 * The library as a deck, in the reader's words.
 *
 * The rating is written in full — "4/5 · 90 %" — rather than as stars: a deck is shown on
 * whatever machine is in the room, and a glyph the room's font does not hold is a box on
 * the wall in front of everybody.
 */
function pptxWords(plugin: PMPlugin): PptxWords {
  const langs = reqLanguages(plugin.settings)
  return {
    title: t('req.libraryTitle'),
    subtitle: (count) => t('req.baselineCount', { count }),
    glyph: (requirement, field) => {
      if (field === 'type') return reqTypeGlyph(plugin.settings, requirement.type).label
      if (field === 'status') return reqStatusGlyph(plugin.settings, requirement.status).label
      if (field === 'criticality') return reqCriticalityGlyph(plugin.settings, requirement.criticality).label
      return requirement.verification === 'none' ? '' : verificationLabel(requirement.verification)
    },
    rating: (requirement) => {
      const report = assessRequirement(requirement, langs)
      return `${report.stars}/5 · ${Math.round(report.score * 100)} %`
    },
    rationale: t('req.field.rationale'),
    source: t('req.field.source'),
    noWording: t('req.noWording'),
    noCategory: t('req.noCategory'),
    section: t('req.field.category')
  }
}

/** One slide per requirement, for the review it will be walked through in. */
export async function exportLibraryPptx(plugin: PMPlugin, requirements: Requirement[], lang: string): Promise<void> {
  const deck = libraryDeck(requirements, lang, pptxWords(plugin))
  const bytes = buildPptx(deck)
  const path = await plugin.porter.writeBinaryExport(
    exportFileName(t('req.libraryTitle'), 'pptx'),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  new Notice(t('req.exported', { path }))
}
