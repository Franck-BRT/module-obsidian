import { App, Notice, PluginSettingTab, Setting, debounce } from 'obsidian'
import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian'
import type PMPlugin from './main'
import { type PMSettings, DEFAULT_SETTINGS, priorityIconSetLabels, makeId } from './types'
import { flattenTasks } from './store/TaskTreeOps'
import { saveShortcutLabel } from './utils'
import {
  countTaskNotesPaletteChanges,
  getTaskNotesApi,
  importTaskNotesPalettes,
  isTaskNotesInstalled
} from './integrations/tasknotes'
import { renderPaletteFields, renderStatusDoneToggle } from './ui/PaletteListEditor'
import { renderCustomFieldFields, renderCustomFieldOptions } from './ui/CustomFieldListEditor'
import { renderPersonPicker } from './ui/PersonPicker'
import { LOCALES, searchAliases, t } from './i18n'
import { invalidHolidays, renderHolidays, renderWorkingWeekdays } from './ui/WorkCalendarEditor'

export type { PMSettings }
export { DEFAULT_SETTINGS }

export class PMSettingTab extends PluginSettingTab {
  plugin: PMPlugin
  /** A folder name is typed one character at a time; each sweep costs the whole vault. */
  private readonly rebuildIndex: () => void

  constructor(app: App, plugin: PMPlugin) {
    super(app, plugin)
    this.plugin = plugin
    this.icon = 'chart-gantt'
    this.rebuildIndex = debounce(() => this.plugin.index.build(), 500)
  }

  /** Names the entries the calendar will ignore, so a typo doesn't fail silently. */
  private holidayDesc(): string {
    const bad = invalidHolidays(this.plugin.settings.holidays)
    const base = t('settings.holidays.desc')
    return bad.length === 0 ? base : `${base} ${t('settings.holidays.ignored', { list: bad.join(', ') })}`
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: t('settings.group.general'),
        items: [
          {
            name: t('settings.language.name'),
            desc: t('settings.language.desc'),
            aliases: searchAliases('settings.aliases.language'),
            control: {
              type: 'dropdown',
              key: 'language',
              options: {
                auto: t('settings.language.auto'),
                ...Object.fromEntries(LOCALES.map((l) => [l, t(`settings.language.${l}`)]))
              }
            }
          },
          {
            name: t('settings.projectsFolder.name'),
            desc: t('settings.projectsFolder.desc'),
            aliases: searchAliases('settings.aliases.projectsFolder'),
            control: {
              type: 'folder',
              key: 'projectsFolder',
              defaultValue: 'Projects',
              placeholder: t('settings.projectsFolder.placeholder')
            }
          },
          this.excludedFoldersPage(),
          {
            name: t('settings.projectSurface.name'),
            desc: t('settings.projectSurface.desc'),
            aliases: searchAliases('settings.aliases.projectSurface'),
            control: {
              type: 'dropdown',
              key: 'projectSurface',
              options: { overview: t('settings.projectSurface.overview'), tasks: t('settings.projectSurface.tasks') }
            }
          },
          {
            name: t('settings.defaultView.name'),
            desc: t('settings.defaultView.desc'),
            aliases: searchAliases('settings.aliases.defaultView'),
            control: {
              type: 'dropdown',
              key: 'defaultView',
              options: { table: t('common.table'), gantt: t('common.gantt'), kanban: t('common.board') }
            }
          },
          {
            name: t('settings.taskSurface.name'),
            desc: t('settings.taskSurface.desc'),
            control: {
              type: 'dropdown',
              key: 'taskEditorSurface',
              options: { modal: t('settings.taskSurface.modal'), tab: t('settings.taskSurface.tab') }
            }
          },
          {
            name: t('settings.saveOnClose.name'),
            desc: t('settings.saveOnClose.desc'),
            control: { type: 'toggle', key: 'saveTaskOnClose' }
          },
          {
            name: t('settings.saveShortcut.name'),
            desc: t('settings.saveShortcut.desc'),
            aliases: searchAliases('settings.aliases.saveShortcut'),
            control: {
              type: 'dropdown',
              key: 'editorSaveModifier',
              options: { Shift: saveShortcutLabel('Shift'), Mod: saveShortcutLabel('Mod') }
            }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.group.style'),
        items: [
          {
            name: t('settings.tagColors.name'),
            desc: t('settings.tagColors.desc'),
            aliases: searchAliases('settings.aliases.tagColors'),
            control: { type: 'toggle', key: 'showTagColors' }
          },
          {
            name: t('settings.priorityIcons.name'),
            desc: t('settings.priorityIcons.desc'),
            aliases: searchAliases('settings.aliases.priorityIcons'),
            control: {
              type: 'dropdown',
              key: 'priorityIcons',
              options: priorityIconSetLabels()
            }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.group.table'),
        items: [
          {
            name: t('settings.subtreeConnections.name'),
            desc: t('settings.subtreeConnections.desc'),
            aliases: searchAliases('settings.aliases.subtreeConnections'),
            control: { type: 'toggle', key: 'showSubtreeConnections' }
          },
          {
            name: t('settings.lineBorders.name'),
            desc: t('settings.lineBorders.desc'),
            aliases: searchAliases('settings.aliases.lineBorders'),
            control: {
              type: 'dropdown',
              key: 'lineBorders',
              options: {
                none: t('common.none'),
                horizontal: t('common.horizontal'),
                vertical: t('common.vertical'),
                both: t('common.both')
              }
            }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.group.gantt'),
        items: [
          {
            name: t('settings.granularity.name'),
            desc: t('settings.granularity.desc'),
            aliases: searchAliases('settings.aliases.granularity'),
            control: {
              type: 'dropdown',
              key: 'ganttGranularity',
              options: {
                day: t('settings.granularity.day'),
                week: t('settings.granularity.week'),
                month: t('settings.granularity.month'),
                quarter: t('settings.granularity.quarter'),
                year: t('settings.granularity.year')
              }
            }
          },
          {
            name: t('settings.weekLabel.name'),
            desc: t('settings.weekLabel.desc'),
            aliases: searchAliases('settings.aliases.weekLabel'),
            control: {
              type: 'dropdown',
              key: 'ganttWeekLabel',
              options: {
                weekNumber: t('settings.weekLabel.weekNumber'),
                dateRange: t('settings.weekLabel.dateRange'),
                both: t('settings.weekLabel.both')
              }
            }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.group.board'),
        items: [
          {
            name: t('settings.kanbanSubtasks.name'),
            desc: t('settings.kanbanSubtasks.desc'),
            aliases: searchAliases('settings.aliases.kanbanSubtasks'),
            control: { type: 'toggle', key: 'kanbanShowSubtasks' }
          },
          {
            name: t('settings.kanbanPreview.name'),
            desc: t('settings.kanbanPreview.desc'),
            aliases: searchAliases('settings.aliases.kanbanPreview'),
            control: { type: 'toggle', key: 'kanbanShowDescriptionPreview' }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.group.scheduling'),
        items: [
          {
            name: t('settings.autoSchedule.name'),
            desc: t('settings.autoSchedule.desc'),
            aliases: searchAliases('settings.aliases.autoSchedule'),
            control: { type: 'toggle', key: 'autoSchedule' }
          },
          {
            name: t('settings.pullForward.name'),
            desc: t('settings.pullForward.desc'),
            aliases: searchAliases('settings.aliases.pullForward'),
            control: {
              type: 'toggle',
              key: 'pullForwardOnEarlyFinish',
              disabled: () => !this.plugin.settings.autoSchedule
            }
          },
          {
            name: t('settings.workingDays.name'),
            desc: t('settings.workingDays.desc'),
            aliases: searchAliases('settings.aliases.workingDays'),
            control: {
              type: 'toggle',
              key: 'respectWorkingDays',
              disabled: () => !this.plugin.settings.autoSchedule
            }
          },
          {
            name: t('settings.workingWeek.name'),
            desc: t('settings.workingWeek.desc'),
            aliases: searchAliases('settings.aliases.workingWeek'),
            render: (setting: Setting) => {
              renderWorkingWeekdays(setting.controlEl, this.plugin.settings, () => this.persist())
            }
          },
          {
            name: t('settings.holidays.name'),
            desc: this.holidayDesc(),
            aliases: searchAliases('settings.aliases.holidays'),
            render: (setting: Setting) => {
              renderHolidays(setting.controlEl, this.plugin.settings, () => {
                this.persist()
                this.update()
              })
            }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.group.archive'),
        items: [
          {
            name: t('settings.autoArchive.name'),
            desc: t('settings.autoArchive.desc'),
            aliases: searchAliases('settings.aliases.autoArchive'),
            control: {
              type: 'slider',
              key: 'autoArchiveDays',
              min: 0,
              max: 90,
              step: 1
            }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.group.notifications'),
        items: [
          {
            name: t('settings.notifications.name'),
            desc: t('settings.notifications.desc'),
            aliases: searchAliases('settings.aliases.notifications'),
            control: { type: 'toggle', key: 'notificationsEnabled' }
          },
          {
            name: t('settings.leadDays.name'),
            desc: t('settings.leadDays.desc'),
            aliases: searchAliases('settings.aliases.leadDays'),
            control: {
              type: 'slider',
              key: 'notificationLeadDays',
              min: 1,
              max: 14,
              step: 1,
              disabled: () => !this.plugin.settings.notificationsEnabled
            }
          }
        ]
      },
      {
        type: 'group',
        heading: t('settings.group.taskFields'),
        items: [this.statusesPage(), this.prioritiesPage(), this.customFieldsPage(), this.teamMembersPage()]
      },
      {
        type: 'group',
        heading: t('settings.group.integrations'),
        visible: () => isTaskNotesInstalled(this.app),
        items: [this.taskNotesPage()]
      }
    ]
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    await super.setControlValue(key, value)
    // Today's pass ran against the old window, so it has to run again to reflect the new one.
    if (key === 'autoArchiveDays') {
      this.plugin.settings.lastAutoArchiveDate = ''
      await this.plugin.autoArchiver.check()
    }
    this.plugin.refreshViews()
    this.refreshDomState()
  }

  private statusesPage(): SettingDefinitionPage {
    const statuses = this.plugin.settings.statuses
    return {
      type: 'page',
      name: t('settings.statuses.name'),
      desc: t('settings.statuses.desc'),
      displayValue: () => t('count.statuses', { count: this.plugin.settings.statuses.length }),
      items: [
        {
          type: 'list',
          heading: t('settings.statuses.name'),
          emptyState: t('settings.statuses.empty'),
          items: statuses.map((status) => ({
            name: status.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, status, () => this.persist())
              renderStatusDoneToggle(setting.controlEl, status, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(statuses, from, to),
          onDelete: (index) => this.deleteEntry('status', index),
          addItem: {
            name: t('settings.statuses.add'),
            action: () => {
              statuses.push({
                id: 'status-' + makeId().slice(0, 6),
                label: t('settings.statuses.new'),
                color: '#8a94a0',
                icon: '',
                complete: false
              })
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private customFieldsPage(): SettingDefinitionPage {
    const fields = this.plugin.settings.customFields
    return {
      type: 'page',
      name: t('settings.customFields.name'),
      desc: t('settings.customFields.desc'),
      displayValue: () => t('count.fields', { count: this.plugin.settings.customFields.length }),
      items: [
        {
          type: 'list',
          heading: t('settings.customFields.name'),
          emptyState: t('settings.customFields.empty'),
          items: fields.map((field) => ({
            name: field.name,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              setting.setClass('pm-cf-settings-row')
              renderCustomFieldFields(
                setting.controlEl,
                field,
                () => this.persist(),
                () => this.update()
              )
              renderCustomFieldOptions(setting.controlEl, field, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(fields, from, to),
          onDelete: (index) => {
            fields.splice(index, 1)
            this.persist()
            this.update()
          },
          addItem: {
            name: t('settings.customFields.add'),
            action: () => {
              fields.push({ id: makeId(), name: t('settings.customFields.new'), type: 'text' })
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private prioritiesPage(): SettingDefinitionPage {
    const priorities = this.plugin.settings.priorities
    return {
      type: 'page',
      name: t('settings.priorities.name'),
      desc: t('settings.priorities.desc'),
      displayValue: () => t('count.priorities', { count: this.plugin.settings.priorities.length }),
      items: [
        {
          type: 'list',
          heading: t('settings.priorities.name'),
          emptyState: t('settings.priorities.empty'),
          items: priorities.map((priority) => ({
            name: priority.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, priority, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(priorities, from, to),
          onDelete: (index) => this.deleteEntry('priority', index),
          addItem: {
            name: t('settings.priorities.add'),
            action: () => {
              priorities.push({
                id: 'priority-' + makeId().slice(0, 6),
                label: t('settings.priorities.new'),
                color: '#8a94a0',
                icon: ''
              })
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private taskNotesPage(): SettingDefinitionPage {
    const connected = (): boolean => getTaskNotesApi(this.app) !== null
    return {
      type: 'page',
      name: t('settings.tasknotes.name'),
      desc: t('settings.tasknotes.desc'),
      displayValue: () => this.taskNotesStatus(),
      status: () => (connected() ? null : 'warning'),
      items: [
        {
          type: 'list',
          extraButtons: [
            (button) =>
              button
                .setIcon('refresh-cw')
                .setTooltip(t('settings.tasknotes.import'))
                .setDisabled(!connected())
                .onClick(() => this.importFromTaskNotes())
          ],
          items: [
            {
              name: t('settings.tasknotes.palettes'),
              desc: t('settings.tasknotes.palettesDesc'),
              render: (setting: Setting) => {
                setting.controlEl.createDiv({ cls: 'setting-item-value', text: this.taskNotesStatus() })
              }
            }
          ]
        }
      ]
    }
  }

  /** Whether an import would change anything right now. */
  private taskNotesStatus(): string {
    const api = getTaskNotesApi(this.app)
    if (!api) return t('settings.tasknotes.updateRequired')
    const { added, updated } = countTaskNotesPaletteChanges(api, this.plugin.settings)
    const total = added + updated
    return total === 0 ? t('settings.tasknotes.upToDate') : t('count.changes', { count: total })
  }

  private excludedFoldersPage(): SettingDefinitionPage {
    const folders = this.plugin.settings.excludedFolders
    return {
      type: 'page',
      name: t('settings.excludedFolders.name'),
      desc: t('settings.excludedFolders.desc'),
      displayValue: () => t('count.folders', { count: this.plugin.settings.excludedFolders.length }),
      items: [
        {
          type: 'list',
          heading: t('settings.excludedFolders.name'),
          emptyState: t('settings.excludedFolders.empty'),
          items: folders.map((folder, index) => ({
            name: folder || t('settings.excludedFolders.unnamed'),
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              setting.addText((text) =>
                text
                  .setPlaceholder(t('settings.excludedFolders.placeholder'))
                  .setValue(folder)
                  .onChange((value) => {
                    this.plugin.settings.excludedFolders[index] = value
                    this.persist()
                    this.rebuildIndex()
                  })
              )
            }
          })),
          onDelete: (index) => {
            folders.splice(index, 1)
            this.persist()
            this.plugin.index.build()
            this.update()
          },
          addItem: {
            name: t('settings.excludedFolders.add'),
            action: () => {
              folders.push('')
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private teamMembersPage(): SettingDefinitionPage {
    const members = this.plugin.settings.globalTeamMembers
    return {
      type: 'page',
      name: t('settings.team.name'),
      desc: t('settings.team.desc'),
      displayValue: () => t('count.people', { count: this.plugin.settings.globalTeamMembers.length }),
      items: [
        {
          name: t('settings.peopleFolder.name'),
          desc: t('settings.peopleFolder.desc'),
          aliases: searchAliases('settings.aliases.peopleFolder'),
          control: {
            type: 'folder',
            key: 'peopleFolder',
            defaultValue: 'People',
            placeholder: t('settings.peopleFolder.placeholder')
          }
        },
        {
          name: t('settings.team.name'),
          desc: t('settings.team.membersDesc'),
          render: (setting: Setting) => {
            renderPersonPicker({
              container: setting.controlEl,
              plugin: this.plugin,
              sourcePath: '',
              addLabel: t('settings.team.add'),
              selected: () => this.plugin.settings.globalTeamMembers,
              add: (value) => {
                members.push(value)
                this.persist()
              },
              remove: (value) => {
                const index = members.indexOf(value)
                if (index >= 0) members.splice(index, 1)
                this.persist()
              }
            })
          }
        }
      ]
    }
  }

  private persist(): void {
    void this.plugin.saveSettings()
    this.plugin.refreshViews()
  }

  private reorder<T>(items: T[], from: number, to: number): void {
    const [moved] = items.splice(from, 1)
    items.splice(to, 0, moved)
    this.persist()
    this.update()
  }

  private deleteEntry(field: 'status' | 'priority', index: number): void {
    const entries = field === 'status' ? this.plugin.settings.statuses : this.plugin.settings.priorities
    if (entries.length <= 1) {
      new Notice(t('settings.atLeastOne', { field }))
      return
    }
    const [removed] = entries.splice(index, 1)
    this.persist()
    this.update()
    void this.remapOrphanTasks(field, removed.id, removed.label)
  }

  private importFromTaskNotes(): void {
    const api = getTaskNotesApi(this.app)
    if (!api) {
      new Notice(t('settings.tasknotes.tooOld'))
      return
    }
    const { added, updated } = importTaskNotesPalettes(api, this.plugin.settings)
    this.persist()
    this.update()
    new Notice(
      added || updated ? t('settings.tasknotes.imported', { added, updated }) : t('settings.tasknotes.alreadyMatch')
    )
  }

  private async remapOrphanTasks(field: 'status' | 'priority', deletedId: string, deletedLabel: string): Promise<void> {
    const configs = field === 'status' ? this.plugin.settings.statuses : this.plugin.settings.priorities
    if (configs.length === 0) return
    const fallback = configs[0]
    // Only projects the index says still use the deleted value are worth loading.
    const affected = this.plugin.index
      .projectRefs()
      .filter((ref) => this.plugin.index.taskRefs(ref.path).some((task) => task[field] === deletedId))
      .map((ref) => ref.path)
    const projects = await this.plugin.store.loadProjects(affected)
    let remapped = 0
    for (const project of projects) {
      // A project defining this status or priority itself is unaffected by a global delete.
      const own = field === 'status' ? project.config?.statuses : project.config?.priorities
      if (own?.some((entry) => entry.id === deletedId)) continue
      const ids = flattenTasks(project.tasks)
        .filter(({ task }) => task[field] === deletedId)
        .map(({ task }) => task.id)
      if (ids.length) {
        await this.plugin.store.updateTasks(project, ids, { [field]: fallback.id })
        remapped += ids.length
      }
    }
    if (remapped > 0) {
      new Notice(
        t('settings.remapped', {
          tasks: t('count.tasks', { count: remapped }),
          from: deletedLabel,
          to: fallback.label
        })
      )
    }
  }
}
