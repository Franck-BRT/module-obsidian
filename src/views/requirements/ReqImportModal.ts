import { Modal, Notice, setIcon, type App } from 'obsidian'
import type PMPlugin from '../../main'
import {
  countPlan,
  planCsvImport,
  readCsvTable,
  type CsvAction,
  type CsvPlanRow
} from '../../store/requirements/reqCsv'
import { readReqJson, type ReqJsonRead } from '../../store/requirements/reqJson'
import { readReqXml } from '../../store/requirements/reqXml'
import { planReqifImport, type ReqifRead } from '../../store/requirements/reqifRead'
import {
  countJsonPlan,
  planJsonImport,
  type JsonPlanRow,
  type JsonReason
} from '../../store/requirements/reqJsonImport'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

/**
 * What a file would do to the library, before it does any of it.
 *
 * Every import is a moment where something nobody has read overwrites work somebody did.
 * So the plan is shown first, row by row, and the button says how many of each it will
 * write — and writes exactly that, never more, because an import that quietly did a
 * little extra is one nobody trusts again.
 *
 * One screen for the two files it can be handed, because the question a reader is
 * answering is the same one: what is about to happen to my library. What differs is the
 * words — a spreadsheet updates fields, a JSON record replaces a whole requirement — and
 * those are decided by whoever built the plan, not here.
 */

interface PlanLine {
  /** Drawn from this: added, changed, ok, removed. */
  kind: 'added' | 'changed' | 'ok' | 'removed'
  icon: string
  label: string
  id: string
  title: string
  /** Why it was refused, or what a replacement would change. */
  note?: string
}

interface PlanView {
  fileName: string
  /** Said before anything else, where a file carried something this could not use. */
  warning?: string
  counts: string
  lines: PlanLine[]
  /** How many rows the button would write. Zero disables it. */
  writes: number
  apply: () => Promise<{ created: number; updated: number; failed: number }>
}

class ReqImportModal extends Modal {
  constructor(
    app: App,
    private plugin: PMPlugin,
    private view: PlanView,
    private onDone: () => void
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    this.modalEl.addClass('pm-modal', 'pm-req-import')
    contentEl.createEl('h2', { text: t('req.importTitle', { file: this.view.fileName }) })

    if (this.view.warning) {
      // Named rather than ignored: something the reader meant to import and this did not
      // recognise is a field they will believe arrived.
      const warn = contentEl.createDiv('pm-reqblock-notice pm-reqblock-notice--warn')
      setIcon(warn.createSpan({ cls: 'pm-glyph-icon' }), 'triangle-alert')
      warn.createSpan({ text: this.view.warning })
    }

    contentEl.createDiv({ cls: 'pm-req-import-counts', text: this.view.counts })

    const list = contentEl.createDiv('pm-req-import-rows')
    for (const line of this.view.lines) this.renderLine(list, line)

    const actions = contentEl.createDiv('pm-te-actions')
    const cancel = actions.createEl('button', { text: t('common.cancel') })
    cancel.addEventListener('click', () => this.close())
    const apply = actions.createEl('button', {
      cls: 'mod-cta',
      text: t('req.importApply', { count: this.view.writes })
    })
    apply.disabled = this.view.writes === 0
    apply.addEventListener(
      'click',
      safeAsync(() => this.apply(apply))
    )
  }

  private renderLine(list: HTMLElement, line: PlanLine): void {
    const el = list.createDiv(`pm-req-import-row pm-req-import-row--${line.kind}`)
    const badge = el.createSpan({ cls: `pm-req-state pm-req-state--${line.kind}` })
    setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), line.icon)
    badge.createSpan({ text: line.label })
    el.createSpan({ cls: 'pm-req-id', text: line.id || t('req.importNewId') })
    el.createSpan({ cls: 'pm-req-wording', text: line.title })
    if (line.note) el.createSpan({ cls: 'pm-req-rev', text: line.note })
  }

  private async apply(button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    button.setText(t('req.importing'))
    const outcome = await this.view.apply()
    this.close()
    new Notice(t('req.importDone', outcome))
    this.plugin.index.build()
    this.onDone()
  }
}

/* ---- The two files it can be handed ------------------------------------------- */

function csvLine(row: CsvPlanRow): PlanLine {
  const first = Object.values(row.values.text)[0] ?? ''
  return {
    kind: csvKind(row.action),
    icon: csvIcon(row.action),
    label: csvLabel(row.action),
    id: row.id,
    title: row.title || first,
    note: row.reason ? (row.reason === 'no-wording' ? t('req.importNoWording') : t('req.importDuplicate')) : undefined
  }
}

function csvLabel(action: CsvAction): string {
  if (action === 'create') return t('req.change.added')
  if (action === 'update') return t('req.change.changed')
  return action === 'unchanged' ? t('req.change.unchanged') : t('req.importRefused')
}

function csvIcon(action: CsvAction): string {
  if (action === 'create') return 'plus'
  if (action === 'update') return 'pencil'
  return action === 'unchanged' ? 'equal' : 'circle-slash'
}

function csvKind(action: CsvAction): PlanLine['kind'] {
  if (action === 'create') return 'added'
  if (action === 'update') return 'changed'
  return action === 'unchanged' ? 'ok' : 'removed'
}

function jsonReason(reason: JsonReason): string {
  return reason === 'no-wording' ? t('req.importNoWording') : t('req.importDuplicate')
}

/** What a replacement would change, as words rather than as field names. */
function jsonNote(row: JsonPlanRow): string | undefined {
  if (row.reason) return jsonReason(row.reason)
  if (!row.changes.length) return undefined
  return row.changes
    .map((part) => {
      if (part === 'links') return t('req.links')
      if (part === 'history') return t('req.history')
      return part === 'fields' ? t('req.importFields') : part.toUpperCase()
    })
    .join(' · ')
}

function jsonLine(row: JsonPlanRow): PlanLine {
  const first = Object.values(row.requirement.text)[0]?.body ?? ''
  return {
    kind:
      row.action === 'create'
        ? 'added'
        : row.action === 'replace'
          ? 'changed'
          : row.action === 'unchanged'
            ? 'ok'
            : 'removed',
    icon:
      row.action === 'create'
        ? 'plus'
        : row.action === 'replace'
          ? 'replace'
          : row.action === 'unchanged'
            ? 'equal'
            : 'circle-slash',
    label:
      row.action === 'create'
        ? t('req.change.added')
        : row.action === 'replace'
          ? t('req.importReplaced')
          : row.action === 'unchanged'
            ? t('req.change.unchanged')
            : t('req.importRefused'),
    id: row.id,
    title: row.requirement.title || first,
    note: jsonNote(row)
  }
}

/**
 * Opens the right plan for the file it was handed.
 *
 * By extension, which is what the reader chose the file by. A file that is not JSON is
 * read as a table, because that is what every other thing a requirements library is sent
 * in turns out to be.
 */
export function openReqImport(plugin: PMPlugin, fileName: string, text: string, onDone: () => void): void {
  const lower = fileName.toLowerCase()
  // The two lossless formats share one plan: both are the note's own record, and both are
  // replaced rather than updated when they land on a requirement that exists.
  if (lower.endsWith('.json')) {
    openRecordImport(plugin, fileName, readReqJson(text), onDone)
    return
  }
  if (lower.endsWith('.xml')) {
    openRecordImport(plugin, fileName, readReqXml(text), onDone)
    return
  }
  const table = readCsvTable(text)
  if (!table.rows.length) {
    new Notice(t('req.importEmpty'))
    return
  }
  const plan = planCsvImport(table.rows, plugin.index.requirementRefs())
  const counts = countPlan(plan)
  new ReqImportModal(
    plugin.app,
    plugin,
    {
      fileName,
      warning: table.unknown.length ? t('req.importUnknown', { list: table.unknown.join(', ') }) : undefined,
      counts: t('req.importCounts', counts),
      lines: plan.map(csvLine),
      writes: counts.create + counts.update,
      apply: async () => {
        const outcome = await plugin.porter.applyCsvPlan(plan, plugin.settings.globalTeamMembers[0] ?? '')
        return { created: outcome.created.length, updated: outcome.updated.length, failed: outcome.failed.length }
      }
    },
    onDone
  ).open()
}

function openRecordImport(plugin: PMPlugin, fileName: string, read: ReqJsonRead, onDone: () => void): void {
  if (!read.requirements.length) {
    // The problems are worth more than "empty": a file refused for its format and a file
    // holding nothing are two different mornings.
    new Notice(
      read.problems.length ? t('req.importUnreadable', { list: read.problems.join(', ') }) : t('req.importEmpty')
    )
    return
  }
  const plan = planJsonImport(read, plugin.index.requirementRefs())
  const counts = countJsonPlan(plan)
  new ReqImportModal(
    plugin.app,
    plugin,
    {
      fileName,
      warning: read.problems.length ? t('req.importUnknown', { list: read.problems.join(', ') }) : undefined,
      counts: t('req.importCountsJson', counts),
      lines: plan.map(jsonLine),
      writes: counts.create + counts.replace,
      apply: async () => {
        const outcome = await plugin.porter.applyJsonPlan(plan)
        return { created: outcome.created.length, updated: outcome.updated.length, failed: outcome.failed.length }
      }
    },
    onDone
  ).open()
}

/**
 * A ReqIF, planned as the table it is read into.
 *
 * Updated field by field like a spreadsheet, never replaced: the file carries one wording
 * and a few fields, and replacing a requirement by that would throw away its other
 * languages and its history. Everything the file held that has no place here is named
 * above the plan, before anything is written.
 */
export function openReqifImport(plugin: PMPlugin, fileName: string, read: ReqifRead, onDone: () => void): void {
  if (read.error) {
    new Notice(t('req.importUnreadable', { list: read.error }))
    return
  }
  if (!read.rows.length) {
    new Notice(t('req.importEmpty'))
    return
  }
  const warnings: string[] = []
  if (!read.langFromFile) warnings.push(t('req.importReqifLangAssumed', { lang: read.lang.toUpperCase() }))
  if (read.ignored.length) warnings.push(t('req.importReqifIgnored', { list: read.ignored.join(', ') }))
  if (read.ignoredRelations.length) {
    warnings.push(t('req.importReqifRelations', { list: read.ignoredRelations.join(', ') }))
  }
  if (read.headings) warnings.push(t('req.importReqifHeadings', { count: read.headings }))

  const plan = planReqifImport(read, plugin.index.requirementRefs())
  const counts = countPlan(plan)
  const counted = t('req.importCounts', counts)
  new ReqImportModal(
    plugin.app,
    plugin,
    {
      fileName,
      warning: warnings.length ? warnings.join(' · ') : undefined,
      counts: read.langFromFile
        ? `${counted} · ${t('req.importReqifLang', { lang: read.lang.toUpperCase() })}`
        : counted,
      lines: plan.map(csvLine),
      writes: counts.create + counts.update,
      apply: async () => {
        const outcome = await plugin.porter.applyCsvPlan(plan, plugin.settings.globalTeamMembers[0] ?? '')
        return { created: outcome.created.length, updated: outcome.updated.length, failed: outcome.failed.length }
      }
    },
    onDone
  ).open()
}
