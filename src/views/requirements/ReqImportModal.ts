import { Modal, Notice, setIcon, type App } from 'obsidian'
import type PMPlugin from '../../main'
import {
  countPlan,
  planCsvImport,
  readCsvTable,
  type CsvAction,
  type CsvPlanRow
} from '../../store/requirements/reqCsv'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

/**
 * What a file would do to the library, before it does any of it.
 *
 * Every import is a moment where something nobody has read overwrites work somebody did.
 * So the plan is shown first, row by row, and the button says how many of each it will
 * write — and writes exactly that, never more, because an import that quietly did a
 * little extra is one nobody trusts again.
 */
class ReqImportModal extends Modal {
  private plan: CsvPlanRow[]

  constructor(
    app: App,
    private plugin: PMPlugin,
    private fileName: string,
    private table: ReturnType<typeof readCsvTable>,
    private onDone: () => void
  ) {
    super(app)
    this.plan = planCsvImport(table.rows, plugin.index.requirementRefs())
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    this.modalEl.addClass('pm-modal', 'pm-req-import')
    contentEl.createEl('h2', { text: t('req.importTitle', { file: this.fileName }) })

    if (this.table.unknown.length) {
      // Named rather than ignored: a column the reader meant as a status and this did not
      // recognise is a field they will believe was imported.
      const warn = contentEl.createDiv('pm-reqblock-notice pm-reqblock-notice--warn')
      setIcon(warn.createSpan({ cls: 'pm-glyph-icon' }), 'triangle-alert')
      warn.createSpan({ text: t('req.importUnknown', { list: this.table.unknown.join(', ') }) })
    }

    const counts = countPlan(this.plan)
    contentEl.createDiv({
      cls: 'pm-req-import-counts',
      text: t('req.importCounts', {
        create: counts.create,
        update: counts.update,
        unchanged: counts.unchanged,
        invalid: counts.invalid
      })
    })

    const list = contentEl.createDiv('pm-req-import-rows')
    for (const row of this.plan) this.renderRow(list, row)

    const actions = contentEl.createDiv('pm-te-actions')
    const cancel = actions.createEl('button', { text: t('common.cancel') })
    cancel.addEventListener('click', () => this.close())
    const apply = actions.createEl('button', {
      cls: 'mod-cta',
      text: t('req.importApply', { count: counts.create + counts.update })
    })
    apply.disabled = counts.create + counts.update === 0
    apply.addEventListener(
      'click',
      safeAsync(() => this.apply(apply))
    )
  }

  private renderRow(list: HTMLElement, row: CsvPlanRow): void {
    const el = list.createDiv(`pm-req-import-row pm-req-import-row--${row.action}`)
    const badge = el.createSpan({ cls: `pm-req-state pm-req-state--${actionClass(row.action)}` })
    setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), actionIcon(row.action))
    badge.createSpan({ text: actionLabel(row.action) })
    el.createSpan({ cls: 'pm-req-id', text: row.id || t('req.importNewId') })
    const first = Object.values(row.values.text)[0] ?? ''
    el.createSpan({ cls: 'pm-req-wording', text: row.title || first })
    if (row.reason) el.createSpan({ cls: 'pm-req-rev', text: reasonLabel(row.reason) })
  }

  private async apply(button: HTMLButtonElement): Promise<void> {
    button.disabled = true
    button.setText(t('req.importing'))
    const outcome = await this.plugin.porter.applyCsvPlan(this.plan, this.plugin.settings.globalTeamMembers[0] ?? '')
    this.close()
    new Notice(
      t('req.importDone', {
        created: outcome.created.length,
        updated: outcome.updated.length,
        failed: outcome.failed.length
      })
    )
    this.plugin.index.build()
    this.onDone()
  }
}

function actionLabel(action: CsvAction): string {
  switch (action) {
    case 'create':
      return t('req.change.added')
    case 'update':
      return t('req.change.changed')
    case 'unchanged':
      return t('req.change.unchanged')
    default:
      return t('req.importRefused')
  }
}

function actionIcon(action: CsvAction): string {
  switch (action) {
    case 'create':
      return 'plus'
    case 'update':
      return 'pencil'
    case 'unchanged':
      return 'equal'
    default:
      return 'circle-slash'
  }
}

function actionClass(action: CsvAction): string {
  switch (action) {
    case 'create':
      return 'added'
    case 'update':
      return 'changed'
    case 'unchanged':
      return 'ok'
    default:
      return 'removed'
  }
}

function reasonLabel(reason: NonNullable<CsvPlanRow['reason']>): string {
  return reason === 'no-wording' ? t('req.importNoWording') : t('req.importDuplicate')
}

export function openReqImport(plugin: PMPlugin, fileName: string, text: string, onDone: () => void): void {
  const table = readCsvTable(text)
  if (!table.rows.length) {
    new Notice(t('req.importEmpty'))
    return
  }
  new ReqImportModal(plugin.app, plugin, fileName, table, onDone).open()
}
