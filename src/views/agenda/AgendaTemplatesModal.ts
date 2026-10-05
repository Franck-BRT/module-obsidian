import { Modal, Notice, setIcon, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import { AGENDA_BLOCKS, blockName, type AgendaBlock, type AgendaTemplate } from '../../store/agenda/agendaTemplate'
import { confirmDialog, promptText } from '../../ui/ModalFactory'
import { safeAsync } from '../../utils'
import { currentLocale, t } from '../../i18n'
import {
  agendaFolder,
  deleteTemplate,
  duplicateTemplate,
  listTemplates,
  newTemplate,
  restoreTemplates
} from './agendaLibrary'
import { explain } from '../../ui/explain'

/** The templates managed: opened to be edited, copied, thrown away, made, the shipped ones restored. */
export function openAgendaTemplates(plugin: PMPlugin, onChange: () => void = () => {}): void {
  new AgendaTemplatesModal(plugin, onChange).open()
}

/** What each block puts in the agenda, for whoever writes a template. */
export function blockDescription(block: AgendaBlock): string {
  switch (block) {
    case 'project':
      return t('agenda.block.project')
    case 'meeting':
      return t('agenda.block.meeting')
    case 'date':
      return t('agenda.block.date')
    case 'time':
      return t('agenda.block.time')
    case 'horizon':
      return t('agenda.block.horizon')
    case 'attendees':
      return t('agenda.block.attendees')
    case 'contacts':
      return t('agenda.block.contacts')
    case 'progress':
      return t('agenda.block.progress')
    case 'milestones':
      return t('agenda.block.milestones')
    case 'phases':
      return t('agenda.block.phases')
    case 'late':
      return t('agenda.block.late')
    case 'upcoming':
      return t('agenda.block.upcoming')
    case 'slips':
      return t('agenda.block.slips')
    case 'workload':
      return t('agenda.block.workload')
    case 'risks':
      return t('agenda.block.risks')
    case 'critical-risks':
      return t('agenda.block.criticalRisks')
    case 'risks-to-review':
      return t('agenda.block.risksToReview')
    case 'risk-matrix':
      return t('agenda.block.riskMatrix')
    case 'pending-decisions':
      return t('agenda.block.pendingDecisions')
    case 'recent-decisions':
      return t('agenda.block.recentDecisions')
    case 'pending-visas':
      return t('agenda.block.pendingVisas')
    case 'reserves':
      return t('agenda.block.reserves')
    case 'late-documents':
      return t('agenda.block.lateDocuments')
    case 'expected-documents':
      return t('agenda.block.expectedDocuments')
    case 'documents-in-review':
      return t('agenda.block.documentsInReview')
    case 'previous-meeting':
      return t('agenda.block.previousMeeting')
    case 'previous-actions':
      return t('agenda.block.previousActions')
  }
}

class AgendaTemplatesModal extends Modal {
  private templates: AgendaTemplate[] = []
  private showBlocks = false

  constructor(
    private plugin: PMPlugin,
    private onChange: () => void
  ) {
    super(plugin.app)
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass('pm-agenda-modal')
    this.setTitle(t('agenda.templates'))
    await this.reload()
  }

  onClose(): void {
    this.contentEl.empty()
    this.onChange()
  }

  private async reload(): Promise<void> {
    this.templates = await listTemplates(this.plugin)
    this.render()
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    root.createDiv({ cls: 'pm-agenda-for', text: t('agenda.templatesDesc', { folder: agendaFolder(this.plugin) }) })

    const list = root.createDiv('pm-agenda-templates')
    if (!this.templates.length) list.createDiv({ cls: 'pm-agenda-empty', text: t('agenda.noTemplates') })
    for (const template of this.templates) {
      const row = list.createDiv('pm-agenda-template')
      setIcon(row.createSpan({ cls: 'pm-agenda-template-icon' }), 'file-text')
      const text = row.createDiv('pm-agenda-template-text')
      text.createDiv({ cls: 'pm-agenda-template-name', text: template.name })
      if (template.description) text.createDiv({ cls: 'pm-agenda-template-desc', text: template.description })
      const actions = row.createDiv('pm-agenda-template-actions')
      const action = (icon: string, label: string, run: () => Promise<void>, help: string): void => {
        const button = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } })
        setIcon(button, icon)
        explain(button, label, help)
        button.addEventListener('click', safeAsync(run))
      }
      action(
        'pencil',
        t('agenda.edit'),
        async () => {
          await this.openNote(template.path)
        },
        t('tip.agenda.edit')
      )
      action(
        'copy',
        t('agenda.duplicate'),
        async () => {
          const path = await duplicateTemplate(this.plugin, template)
          if (path) await this.openNote(path)
        },
        t('tip.agenda.duplicate')
      )
      action(
        'trash-2',
        t('agenda.delete'),
        async () => {
          const ok = await confirmDialog(
            this.app,
            t('agenda.deleteConfirm', { name: template.name }),
            t('common.delete')
          )
          if (!ok) return
          await deleteTemplate(this.plugin, template)
          await this.reload()
        },
        t('tip.agenda.delete')
      )
    }

    const foot = root.createDiv('pm-agenda-foot')
    const button = (label: string, run: () => Promise<void>, cta = false): void => {
      const one = foot.createEl('button', { text: label, cls: cta ? 'mod-cta' : '' })
      explain(one, label, label === t('agenda.restore') ? t('tip.agenda.restore') : t('tip.agenda.new'))
      one.addEventListener('click', safeAsync(run))
    }
    button(t('agenda.restore'), async () => {
      const count = await restoreTemplates(this.plugin)
      new Notice(count ? t('agenda.restored', { count }) : t('agenda.nothingToRestore'))
      await this.reload()
    })
    button(
      t('agenda.new'),
      async () => {
        const name = await promptText(this.app, t('agenda.newPrompt'), t('agenda.newName'))
        if (!name?.trim()) return
        await this.openNote(await newTemplate(this.plugin, name.trim()))
      },
      true
    )

    const help = root.createEl('details', { cls: 'pm-agenda-help' })
    help.open = this.showBlocks
    help.addEventListener('toggle', () => {
      this.showBlocks = help.open
    })
    help.createEl('summary', { text: t('agenda.blocksTitle') })
    help.createDiv({ cls: 'pm-agenda-for', text: t('agenda.blocksDesc') })
    const french = currentLocale() === 'fr'
    const table = help.createEl('table', { cls: 'pm-agenda-blocks-table' })
    for (const [, en] of AGENDA_BLOCKS) {
      const row = table.createEl('tr')
      const code = row.createEl('td').createEl('code', { text: `{{${blockName(en, french)}}}` })
      code.setAttr('title', t('agenda.copyBlock'))
      code.addEventListener(
        'click',
        safeAsync(async () => {
          await navigator.clipboard.writeText(code.textContent ?? '')
          new Notice(t('agenda.blockCopied'))
        })
      )
      row.createEl('td', { text: blockDescription(en) })
    }
  }

  private async openNote(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return
    this.close()
    await this.app.workspace.getLeaf('tab').openFile(file)
  }
}
