import { Modal, Notice, setIcon, Setting, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { blocksIn, blockName, templateFor, type AgendaTemplate } from '../../store/agenda/agendaTemplate'
import { today } from '../../dates'
import { currentLocale, t } from '../../i18n'
import { safeAsync } from '../../utils'
import { listTemplates } from './agendaLibrary'
import { openAgendaTemplates } from './AgendaTemplatesModal'
import { writeAgenda } from './writeAgenda'

/** The day a meeting is held: its due date, else its start; today when it has none. */
function meetingDate(meeting: Task | undefined): string {
  return meeting?.due || meeting?.start || today().toString()
}

/** Asks which template, for which day, then writes the agenda and opens it. */
export function openAgenda(plugin: PMPlugin, project: Project, meeting?: Task): void {
  new AgendaModal(plugin, project, meeting).open()
}

class AgendaModal extends Modal {
  private templates: AgendaTemplate[] = []
  private chosen: AgendaTemplate | null = null
  private date: string

  constructor(
    private plugin: PMPlugin,
    private project: Project,
    private meeting?: Task
  ) {
    super(plugin.app)
    this.date = meetingDate(meeting)
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass('pm-agenda-modal')
    this.setTitle(t('agenda.title'))
    await this.reload()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private async reload(): Promise<void> {
    this.templates = await listTemplates(this.plugin)
    const kept = this.chosen ? this.templates.find((one) => one.path === this.chosen?.path) : null
    this.chosen = kept ?? templateFor(this.templates, this.meeting?.meetingKind)
    this.render()
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    root.createDiv({
      cls: 'pm-agenda-for',
      text: this.meeting
        ? t('agenda.forMeeting', { meeting: this.meeting.title, project: this.project.title })
        : t('agenda.forProject', { project: this.project.title })
    })
    if (!this.templates.length) {
      root.createDiv({ cls: 'pm-agenda-empty', text: t('agenda.noTemplates') })
    } else {
      const list = root.createDiv('pm-agenda-templates')
      for (const template of this.templates) {
        const chosen = template.path === this.chosen?.path
        const row = list.createDiv(`pm-agenda-template${chosen ? ' is-chosen' : ''}`)
        row.setAttr('role', 'radio')
        row.setAttr('aria-checked', String(chosen))
        row.setAttr('tabindex', '0')
        setIcon(row.createSpan({ cls: 'pm-agenda-template-icon' }), chosen ? 'circle-dot' : 'circle')
        const text = row.createDiv('pm-agenda-template-text')
        text.createDiv({ cls: 'pm-agenda-template-name', text: template.name })
        if (template.description) text.createDiv({ cls: 'pm-agenda-template-desc', text: template.description })
        const pick = (): void => {
          this.chosen = template
          this.render()
        }
        row.addEventListener('click', pick)
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            pick()
          }
        })
      }
    }
    const chosen = this.chosen
    if (chosen) {
      const french = currentLocale() === 'fr'
      const blocks = blocksIn(chosen.body)
      root.createDiv({
        cls: 'pm-agenda-blocks',
        text: t('agenda.fills', {
          blocks: blocks.map((block) => blockName(block, french)).join(', ') || '—',
          days: chosen.horizon
        })
      })
    }
    new Setting(root).setName(t('agenda.date')).addText((text) => {
      text.inputEl.type = 'date'
      text.setValue(this.date).onChange((value) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) this.date = value
      })
    })
    new Setting(root)
      .addButton((button) =>
        button.setButtonText(t('agenda.manage')).onClick(() =>
          openAgendaTemplates(this.plugin, () => {
            void this.reload()
          })
        )
      )
      .addButton((button) =>
        button
          .setButtonText(t('agenda.create'))
          .setCta()
          .setDisabled(!chosen)
          .onClick(
            safeAsync(async () => {
              if (!chosen) return
              const path = await writeAgenda(this.plugin, this.project, chosen, this.date, this.meeting)
              this.close()
              new Notice(t('agenda.written', { path }))
              const file = this.app.vault.getAbstractFileByPath(path)
              if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file)
            })
          )
      )
  }
}
