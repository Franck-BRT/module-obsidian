import { App, Menu, Notice, PluginSettingTab, Setting, debounce } from 'obsidian'
import type { SettingDefinitionItem, SettingDefinitionPage } from 'obsidian'
import type PMPlugin from './main'
import {
  type PMSettings,
  type TypeBadgeMode,
  DEFAULT_SETTINGS,
  priorityIconSetLabels,
  makeId,
  TYPE_BADGE_MODES
} from './types'
import { flattenTasks } from './store/TaskTreeOps'
import { safeAsync, saveShortcutLabel } from './utils'
import { LlmClient } from './store/llm'
import { parsePrompts } from './store/chat/chatPrompts'
import { builtinPrompts, promptLine } from './views/chat/chatPresets'
import { PROMPT_DEFS, type PromptDef } from './views/requirements/promptDefs'
import { DEFAULT_REQ_BLOCK_FIELDS, REQ_BLOCK_BREAK, REQ_BLOCK_FIELDS } from './store/requirements/reqBlockFields'
import { reqBlockFieldLabel } from './views/requirements/reqPalette'
import {
  countTaskNotesPaletteChanges,
  getTaskNotesApi,
  importTaskNotesPalettes,
  isTaskNotesInstalled
} from './integrations/tasknotes'
import { renderPaletteFields, renderStatusDoneToggle } from './ui/PaletteListEditor'
import { isSettingsPath, readSettingsPath, writeSettingsPath } from './store/settingsPath'
import { viewModeOptions } from './views/viewModes'
import { renderCustomFieldFields, renderCustomFieldOptions } from './ui/CustomFieldListEditor'
import { renderPersonPicker } from './ui/PersonPicker'
import { openAgendaTemplates } from './views/agenda/AgendaTemplatesModal'
import { LOCALES, searchAliases, t } from './i18n'
import { invalidHolidays, renderHolidays, renderWorkingWeekdays } from './ui/WorkCalendarEditor'
import { OCR_STEPS, stepDesc, stepName } from './views/documents/scanOptions'

/** Exhaustive, so a new mode cannot reach the interface without a name. */
function typeBadgeModeLabel(mode: TypeBadgeMode): string {
  switch (mode) {
    case 'none':
      return t('settings.typeBadges.none')
    case 'distinct':
      return t('settings.typeBadges.distinct')
    case 'all':
      return t('settings.typeBadges.all')
  }
}

export type { PMSettings }
export { DEFAULT_SETTINGS }

export class PMSettingTab extends PluginSettingTab {
  plugin: PMPlugin
  /** A folder name is typed one character at a time; each sweep costs the whole vault. */
  private readonly rebuildIndex: () => void
  /** What the gateway said it offers, once somebody has asked it. */
  private llmModels: string[] = []

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
            name: t('settings.tooltips.name'),
            desc: t('settings.tooltips.desc'),
            control: { type: 'toggle', key: 'tooltips' }
          },
          {
            name: t('settings.tooltipDelay.name'),
            desc: t('settings.tooltipDelay.desc'),
            control: {
              type: 'dropdown',
              key: 'tooltipDelay',
              options: {
                '500': t('settings.tooltipDelay.half'),
                '1000': t('settings.tooltipDelay.one'),
                '2000': t('settings.tooltipDelay.two')
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
          {
            name: t('settings.libraryFolder.name'),
            desc: t('settings.libraryFolder.desc'),
            control: {
              type: 'folder',
              key: 'libraryFolder',
              defaultValue: 'Library',
              placeholder: 'Library'
            }
          },
          {
            name: t('settings.notesFolder.name'),
            desc: t('settings.notesFolder.desc'),
            control: {
              type: 'folder',
              key: 'notesFolder',
              defaultValue: 'Notes',
              placeholder: 'Notes'
            }
          },
          {
            name: t('settings.libraryCategories.name'),
            desc: t('settings.libraryCategories.desc'),
            render: (setting: Setting) => {
              setting.setClass('pm-settings-prompt')
              setting.addTextArea((area) => {
                area.inputEl.rows = 10
                // The shipped list shown when the reader has none of their own, to start from.
                area
                  .setPlaceholder(t('library.defaultCategories'))
                  .setValue(this.plugin.settings.libraryCategories)
                  .onChange((value) => {
                    this.plugin.settings.libraryCategories = value
                    this.persist()
                  })
              })
              setting.addButton((button) =>
                button.setButtonText(t('settings.libraryCategories.copy')).onClick(() => {
                  if (this.plugin.settings.libraryCategories.trim()) return
                  this.plugin.settings.libraryCategories = t('library.defaultCategories')
                  this.persist()
                  this.update()
                })
              )
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
              options: Object.fromEntries(viewModeOptions().map((option) => [option.id, option.label]))
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
        items: [
          this.statusesPage(),
          this.prioritiesPage(),
          this.typesPage(),
          this.docStatesPage(),
          this.meetingKindsPage(),
          this.zonesPage(),
          this.customFieldsPage(),
          this.teamMembersPage()
        ]
      },
      {
        type: 'group',
        heading: t('settings.group.requirements'),
        items: [this.requirementsPage()]
      },
      {
        type: 'group',
        heading: t('settings.group.llm'),
        items: [this.llmPage()]
      },
      {
        type: 'group',
        heading: t('settings.group.integrations'),
        visible: () => isTaskNotesInstalled(this.app),
        items: [this.taskNotesPage()]
      }
    ]
  }

  /**
   * A setting that lives inside a group, such as `requirements.folder`.
   *
   * Obsidian's resolver reads a flat key off the settings object, which is right for
   * every setting that predates the groups. A path is resolved here instead, and only
   * when it leads to something that already exists — so a mistyped key falls through to
   * the flat reader rather than quietly creating a setting nobody will ever find again.
   */
  getControlValue(key: string): unknown {
    if (!isSettingsPath(key)) return super.getControlValue(key)
    const read = readSettingsPath(this.plugin.settings as unknown as Record<string, unknown>, key)
    return read.found ? read.value : super.getControlValue(key)
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (
      isSettingsPath(key) &&
      writeSettingsPath(this.plugin.settings as unknown as Record<string, unknown>, key, value)
    ) {
      await this.plugin.saveSettings()
      this.plugin.refreshViews()
      this.refreshDomState()
      return
    }
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
                color: '#8b8c92',
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

  /**
   * What each kind of ticket looks like. The five kinds are the ones the editor can make,
   * so unlike a status the list is fixed: they are recoloured, re-iconed and renamed, and
   * never added to or deleted — which is why this page has no add button and no handles.
   */
  private typesPage(): SettingDefinitionPage {
    const types = this.plugin.settings.types
    return {
      type: 'page',
      name: t('settings.types.name'),
      desc: t('settings.types.desc'),
      displayValue: () => typeBadgeModeLabel(this.plugin.settings.typeBadges),
      items: [
        {
          name: t('settings.typeBadges.name'),
          desc: t('settings.typeBadges.desc'),
          control: {
            type: 'dropdown',
            key: 'typeBadges',
            options: Object.fromEntries(TYPE_BADGE_MODES.map((mode) => [mode, typeBadgeModeLabel(mode)]))
          }
        },
        {
          type: 'list',
          heading: t('settings.types.name'),
          emptyState: t('settings.types.empty'),
          items: types.map((type) => ({
            name: type.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, type, () => this.persist())
            }
          }))
        }
      ]
    }
  }

  /** The same, for the states a document goes through while a project waits on it. */
  private docStatesPage(): SettingDefinitionPage {
    const states = this.plugin.settings.docStates
    return {
      type: 'page',
      name: t('settings.docStates.name'),
      desc: t('settings.docStates.desc'),
      displayValue: () => t('count.statuses', { count: states.length }),
      items: [
        {
          type: 'list',
          heading: t('settings.docStates.name'),
          emptyState: t('settings.docStates.empty'),
          items: states.map((state) => ({
            name: state.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, state, () => this.persist())
            }
          }))
        }
      ]
    }
  }

  /**
   * What a meeting can be about — technical, financial, whatever this organisation runs.
   *
   * Unlike the kinds of ticket, which are the tool's own vocabulary and can only be
   * restyled, this list is the reader's: they add to it and take from it. Deleting one
   * leaves the meetings that used it alone rather than reassigning them — a technical
   * meeting quietly becoming a financial one would be a lie about what happened.
   */
  private meetingKindsPage(): SettingDefinitionPage {
    const kinds = this.plugin.settings.meetingKinds
    return {
      type: 'page',
      name: t('settings.meetingKinds.name'),
      desc: t('settings.meetingKinds.desc'),
      displayValue: () => t('count.statuses', { count: kinds.length }),
      items: [
        {
          type: 'list',
          heading: t('settings.meetingKinds.name'),
          emptyState: t('settings.meetingKinds.empty'),
          items: kinds.map((kind) => ({
            name: kind.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, kind, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(kinds, from, to),
          onDelete: (index) => {
            kinds.splice(index, 1)
            this.persist()
            this.update()
          },
          addItem: {
            name: t('settings.meetingKinds.add'),
            action: () => {
              kinds.push({
                id: 'meeting-' + makeId().slice(0, 6),
                label: t('settings.meetingKinds.new'),
                color: '#8b8c92',
                icon: 'users'
              })
              this.persist()
              this.update()
            }
          }
        },
        {
          name: t('settings.agendaFolder.name'),
          desc: t('settings.agendaFolder.desc'),
          control: {
            type: 'folder',
            key: 'agendaFolder',
            defaultValue: '',
            placeholder: t('agenda.defaultFolder')
          }
        },
        {
          name: t('agenda.templates'),
          desc: t('settings.agendaTemplates.desc'),
          render: (setting: Setting) => {
            setting.addButton((button) =>
              button.setButtonText(t('agenda.manage')).onClick(() => openAgendaTemplates(this.plugin))
            )
          }
        }
      ]
    }
  }

  /**
   * The places work happens.
   *
   * Empty until the reader fills it, because a zone is a road, a berth, a floor, a line —
   * their own geography, which the tool has no business guessing at. Until one exists the
   * impact view has nothing to say, and says so.
   */
  /**
   * A language model the plugin may ask things of.
   *
   * Off until it is turned on, and with no address until one is given: nothing about a
   * requirement leaves this vault by accident. One model per use rather than one for
   * everything, because the model that reasons in steps is what should judge whether two
   * requirements contradict each other and the last thing that should translate a
   * sentence.
   */
  /**
   * The requirements library.
   *
   * The two settings here that cannot be undone later are the folder and the identifier
   * scheme, so both say what they govern rather than merely naming themselves: a
   * requirement's id is quoted in documents that leave the building, and changing the
   * prefix afterwards does not go back and change those.
   */
  private requirementsPage(): SettingDefinitionPage {
    const reqs = this.plugin.settings.requirements
    return {
      type: 'page',
      name: t('settings.req.name'),
      desc: t('settings.req.desc'),
      displayValue: () => reqs.folder || t('settings.req.folderPlaceholder'),
      items: [
        {
          name: t('settings.req.folder'),
          desc: t('settings.req.folderDesc'),
          control: {
            type: 'folder',
            key: 'requirements.folder',
            defaultValue: 'Requirements',
            placeholder: t('settings.req.folderPlaceholder')
          }
        },
        {
          name: t('settings.req.languages'),
          desc: t('settings.req.languagesDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text
                .setPlaceholder(t('settings.req.languagesPlaceholder'))
                .setValue(reqs.languages.join(', '))
                .onChange((value) => {
                  const langs = value
                    .split(',')
                    .map((lang) => lang.trim().toLowerCase())
                    .filter((lang) => lang !== '')
                  // Never emptied: a library with no language has nowhere to put a wording,
                  // and half-typing "fr, en" passes through the empty string on the way.
                  reqs.languages = langs.length ? [...new Set(langs)] : reqs.languages
                  this.persist()
                })
            )
          }
        },
        {
          name: t('settings.req.idPrefix'),
          desc: t('settings.req.idPrefixDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text
                .setPlaceholder('REQ')
                .setValue(reqs.idPrefix)
                .onChange((value) => {
                  reqs.idPrefix = value
                  this.persist()
                })
            )
          }
        },
        {
          name: t('settings.req.idWidth'),
          desc: t('settings.req.idWidthDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text.setValue(String(reqs.idWidth)).onChange((value) => {
                const parsed = Number.parseInt(value, 10)
                if (Number.isFinite(parsed) && parsed > 0 && parsed <= 9) {
                  reqs.idWidth = parsed
                  this.persist()
                }
              })
            )
          }
        },
        {
          name: t('settings.req.target'),
          desc: t('settings.req.targetDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text.setValue(String(reqs.reviewTarget)).onChange((value) => {
                const parsed = Number.parseInt(value, 10)
                // Bounded rather than refused: a target of 0 or 120 is a typo, and the
                // field should not sit there holding one.
                if (Number.isFinite(parsed) && parsed >= 10 && parsed <= 100) {
                  reqs.reviewTarget = parsed
                  this.persist()
                }
              })
            )
          }
        },
        {
          name: t('settings.req.proposals'),
          desc: t('settings.req.proposalsDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text.setValue(String(reqs.reviewProposals)).onChange((value) => {
                const parsed = Number.parseInt(value, 10)
                if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 6) {
                  reqs.reviewProposals = parsed
                  this.persist()
                }
              })
            )
          }
        },
        this.reqBlockFieldsPage(),
        ...PROMPT_DEFS.map((def) => this.promptPage(def)),
        this.reqPalettePage('types'),
        this.reqPalettePage('statuses')
      ]
    }
  }

  /**
   * The columns a quoted requirement shows, as a list rather than a text field.
   *
   * Order is part of the answer — a block reads `REQ-SYS-0001  Titre  Approuvée  ★★★★☆`
   * in the order written — so the affordance has to be one that can be dragged, and a
   * comma-separated string in a text box is not one.
   *
   * Emptying it is allowed, and falls back to the list this plugin ships with rather
   * than drawing nothing: a block reduced to a blank rectangle would look like a bug in
   * the document, in a document nobody would think to blame the settings for.
   */
  private reqBlockFieldsPage(): SettingDefinitionPage {
    const reqs = this.plugin.settings.requirements
    const chosen = reqs.blockFields
    return {
      type: 'page',
      name: t('settings.req.blockFields'),
      desc: t('settings.req.blockFieldsDesc'),
      displayValue: () =>
        chosen.length ? chosen.map((field) => reqBlockFieldLabel(field)).join(', ') : t('settings.req.promptDefault'),
      items: [
        {
          type: 'list',
          heading: t('settings.req.blockFields'),
          emptyState: t('settings.req.blockFieldsEmpty'),
          items: chosen.map((field, index) => ({
            name: reqBlockFieldLabel(field),
            // Buttons as well as the drag handle, and not only for the mouseless: the
            // order is the whole point of this list, and an affordance that is the only
            // way to reach it must not be the one that is hardest to be sure of.
            render: (setting: Setting) => {
              setting.addExtraButton((button) =>
                button
                  .setIcon('arrow-up')
                  .setTooltip(t('settings.req.blockFieldsUp'))
                  .setDisabled(index === 0)
                  // Checked again here: a disabled extra button is a styled div, and a
                  // click on it still arrives.
                  .onClick(() => {
                    if (index > 0) this.reorder(chosen, index, index - 1)
                  })
              )
              setting.addExtraButton((button) =>
                button
                  .setIcon('arrow-down')
                  .setTooltip(t('settings.req.blockFieldsDown'))
                  .setDisabled(index === chosen.length - 1)
                  .onClick(() => {
                    if (index < chosen.length - 1) this.reorder(chosen, index, index + 1)
                  })
              )
            }
          })),
          onReorder: (from, to) => this.reorder(chosen, from, to),
          onDelete: (index) => {
            chosen.splice(index, 1)
            this.persist()
            this.update()
          },
          addItem: {
            name: t('settings.req.blockFieldsAdd'),
            action: (el: HTMLElement) => {
              // A line break may be added again and again — three lines need two of them —
              // where a column already in the list would only be drawn twice.
              const rest = REQ_BLOCK_FIELDS.filter((field) => field === REQ_BLOCK_BREAK || !chosen.includes(field))
              const menu = new Menu()
              // Said rather than left as an empty menu that opens onto nothing.
              if (rest.length === 0) {
                menu.addItem((item) => item.setTitle(t('settings.req.blockFieldsAll')).setDisabled(true))
              }
              for (const field of rest) {
                menu.addItem((item) =>
                  item.setTitle(reqBlockFieldLabel(field)).onClick(() => {
                    chosen.push(field)
                    this.persist()
                    this.update()
                  })
                )
              }
              const rect = el.getBoundingClientRect()
              menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 })
            }
          }
        },
        {
          name: t('settings.req.blockFieldsReset'),
          desc: t('settings.req.blockFieldsResetDesc'),
          render: (setting: Setting) => {
            setting.addButton((button) =>
              button.setButtonText(t('settings.req.blockFieldsRestore')).onClick(() => {
                // Rewritten in place rather than replaced: the list above holds this very
                // array, and handing the settings a different one would leave it editing
                // the old one.
                chosen.splice(0, chosen.length, ...DEFAULT_REQ_BLOCK_FIELDS)
                this.persist()
                this.update()
              })
            )
          }
        },
        {
          name: t('settings.req.blockFieldsOrder'),
          desc: t('settings.req.blockFieldsOrderDesc'),
          render: () => undefined
        }
      ]
    }
  }

  /**
   * The chat's ready questions: the shipped ones, which can be turned off, and the
   * reader's own, as a plain list. A shipped question can be copied into the list to be
   * adjusted, which is how a house makes one its own without the plugin keeping two
   * versions of it.
   */
  private chatPromptsPage(): SettingDefinitionPage {
    const chat = this.plugin.settings.chat
    return {
      type: 'page',
      name: t('settings.chat.prompts'),
      desc: t('settings.chat.promptsDesc'),
      displayValue: () => t('settings.chat.promptsCount', { count: parsePrompts(chat.prompts).length }),
      items: [
        {
          name: t('settings.chat.builtin'),
          desc: t('settings.chat.builtinDesc'),
          control: { type: 'toggle', key: 'chat.builtinPrompts' }
        },
        {
          name: t('settings.chat.own'),
          desc: t('settings.chat.ownDesc'),
          render: (setting: Setting) => {
            setting.setClass('pm-settings-prompt')
            setting.addTextArea((area) => {
              area.inputEl.rows = 12
              area.setValue(chat.prompts).onChange((value) => {
                chat.prompts = value
                this.persist()
              })
            })
          }
        },
        {
          name: t('settings.chat.copyBuiltin'),
          desc: t('settings.chat.copyBuiltinDesc'),
          render: (setting: Setting) => {
            setting.addButton((button) =>
              button.setButtonText(t('settings.chat.copyBuiltinButton')).onClick(() => {
                const lines = builtinPrompts().map(promptLine)
                chat.prompts = [chat.prompts.trimEnd(), ...lines].filter(Boolean).join('\n')
                this.persist()
                this.update()
              })
            )
          }
        }
      ]
    }
  }

  /**
   * An instruction the model is given, as something the reader owns.
   *
   * Editable because every line of one is a judgement about how this organisation works,
   * and those judgements are not this plugin's to make: a house writing to ECSS
   * conventions wants different advice from one writing a purchase specification.
   *
   * What is not editable, and the page says so rather than leaving it to be discovered,
   * is the output contract. The fields the interface reads back and the defect names its
   * badges match on are a machine interface, and an instruction reworded there by
   * accident is a feature that arrives and shows nothing.
   *
   * One shape for all three, because three pages that drifted apart would be three
   * different answers to the same question.
   */
  private promptPage(def: PromptDef): SettingDefinitionPage {
    const reqs = this.plugin.settings.requirements
    const { key, fallback } = def
    return {
      type: 'page',
      name: def.label(),
      desc: def.desc(),
      displayValue: () => (reqs[key].trim() ? t('settings.req.promptCustom') : t('settings.req.promptDefault')),
      items: [
        {
          name: t('settings.req.promptKeys'),
          desc: def.keys.map((placeholder) => `{${placeholder}}`).join('  ·  '),
          render: () => undefined
        },
        {
          name: def.label(),
          desc: t('settings.req.promptHint'),
          render: (setting: Setting) => {
            setting.setClass('pm-settings-prompt')
            setting.addTextArea((area) => {
              area.inputEl.rows = 14
              area
                .setPlaceholder(fallback)
                .setValue(reqs[key])
                .onChange((value) => {
                  reqs[key] = value
                  this.persist()
                })
            })
          }
        },
        {
          name: t('settings.req.promptReset'),
          desc: t('settings.req.promptResetDesc'),
          render: (setting: Setting) => {
            setting.addButton((button) =>
              button.setButtonText(t('settings.req.promptLoad')).onClick(() => {
                // Loaded rather than emptied: somebody meaning to adjust two lines should
                // not have to go and find the original to adjust them from.
                reqs[key] = fallback
                this.persist()
                this.update()
              })
            )
            setting.addButton((button) =>
              button.setButtonText(t('settings.req.promptClear')).onClick(() => {
                // Cleared rather than overwritten with a copy, so a later improvement to
                // the shipped instruction still reaches anybody who has not overridden it.
                reqs[key] = ''
                this.persist()
                this.update()
              })
            )
          }
        }
      ]
    }
  }

  /**
   * What a requirement can be, and where it can stand.
   *
   * Both are the reader's lists rather than the tool's vocabulary, so both can be added
   * to and taken from. Deleting an entry leaves the requirements that used it alone:
   * a requirement whose status vanished still has that status, and reassigning it
   * silently would be the tool lying about what the note says.
   */
  private reqPalettePage(which: 'types' | 'statuses'): SettingDefinitionPage {
    const entries = this.plugin.settings.requirements[which]
    const name = which === 'types' ? t('settings.req.types') : t('settings.req.statuses')
    const add = which === 'types' ? t('settings.req.addType') : t('settings.req.addStatus')
    const fresh = which === 'types' ? t('settings.req.newType') : t('settings.req.newStatus')
    return {
      type: 'page',
      name,
      displayValue: () => t('count.statuses', { count: entries.length }),
      items: [
        {
          type: 'list',
          heading: name,
          emptyState: t('settings.req.paletteEmpty'),
          items: entries.map((entry) => ({
            name: entry.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, entry, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(entries, from, to),
          onDelete: (index) => {
            entries.splice(index, 1)
            this.persist()
            this.update()
          },
          addItem: {
            name: add,
            action: () => {
              entries.push({
                id: 'req-' + makeId().slice(0, 6),
                label: fresh,
                color: '#8b8c92',
                icon: which === 'types' ? 'shapes' : 'circle-dashed'
              })
              this.persist()
              this.update()
            }
          }
        }
      ]
    }
  }

  private llmPage(): SettingDefinitionPage {
    const llm = this.plugin.settings.llm
    const set = <K extends keyof PMSettings['llm']>(key: K, value: PMSettings['llm'][K]): void => {
      llm[key] = value
      this.persist()
    }
    return {
      type: 'page',
      name: t('settings.llm.name'),
      desc: t('settings.llm.desc'),
      displayValue: () => (llm.enabled ? t('settings.llm.on') : t('settings.llm.off')),
      items: [
        {
          name: t('settings.llm.enabled'),
          desc: t('settings.llm.enabledDesc'),
          render: (setting: Setting) => {
            setting.addToggle((toggle) =>
              toggle.setValue(llm.enabled).onChange((value) => {
                set('enabled', value)
                this.update()
              })
            )
          }
        },
        {
          name: t('settings.llm.baseUrl'),
          desc: t('settings.llm.baseUrlDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text
                // oxlint-disable-next-line obsidianmd/ui/sentence-case -- an address, not a sentence
                .setPlaceholder(t('settings.llm.baseUrlHint'))
                .setValue(llm.baseUrl)
                .onChange((value) => set('baseUrl', value.trim()))
            )
          }
        },
        {
          name: t('settings.llm.apiKey'),
          desc: t('settings.llm.apiKeyDesc'),
          render: (setting: Setting) => {
            setting.addText((text) => {
              text.setPlaceholder(t('settings.llm.apiKeyNone')).setValue(llm.apiKey)
              // A key is a secret even when this gateway wants none of it.
              text.inputEl.type = 'password'
              text.onChange((value) => set('apiKey', value.trim()))
            })
          }
        },
        {
          name: t('settings.llm.test'),
          desc: t('settings.llm.testDesc'),
          render: (setting: Setting) => this.renderLlmTest(setting)
        },
        ...this.llmModelRows(),
        {
          name: t('settings.llm.temperature'),
          desc: t('settings.llm.temperatureDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text.setValue(String(llm.temperature)).onChange((value) => {
                const parsed = Number.parseFloat(value)
                if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2) set('temperature', parsed)
              })
            )
          }
        },
        {
          name: t('settings.chat.folder'),
          desc: t('settings.chat.folderDesc'),
          control: {
            type: 'folder',
            key: 'chat.folder',
            defaultValue: 'Chats',
            placeholder: 'Chats'
          }
        },
        {
          name: t('settings.chat.notesFolder'),
          desc: t('settings.chat.notesFolderDesc'),
          control: {
            type: 'folder',
            key: 'chat.notesFolder',
            defaultValue: '',
            placeholder: t('settings.chat.notesFolderPlaceholder')
          }
        },
        {
          name: t('settings.chat.skillsFolder'),
          desc: t('settings.chat.skillsFolderDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text
                .setPlaceholder(DEFAULT_SETTINGS.chat.skillsFolder)
                .setValue(this.plugin.settings.chat.skillsFolder)
                .onChange((value) => {
                  this.plugin.settings.chat.skillsFolder = value
                  this.persist()
                })
            )
            setting.addButton((button) =>
              button.setButtonText(t('settings.chat.skillsExamples')).onClick(() => {
                void this.plugin.createExampleSkills()
              })
            )
          }
        },
        {
          name: t('settings.chat.stream'),
          desc: t('settings.chat.streamDesc'),
          control: { type: 'toggle', key: 'chat.stream' }
        },
        this.chatPromptsPage(),
        this.ragPage(),
        this.ocrPage(),
        {
          name: t('settings.chat.maxTokens'),
          desc: t('settings.chat.maxTokensDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text.setValue(String(this.plugin.settings.chat.maxTokens)).onChange((value) => {
                const parsed = Number.parseInt(value, 10)
                if (Number.isFinite(parsed) && parsed >= 0) {
                  this.plugin.settings.chat.maxTokens = parsed
                  this.persist()
                }
              })
            )
          }
        },
        {
          name: t('settings.chat.noteChars'),
          desc: t('settings.chat.noteCharsDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text.setValue(String(this.plugin.settings.chat.noteChars)).onChange((value) => {
                const parsed = Number.parseInt(value, 10)
                if (Number.isFinite(parsed) && parsed >= 0) {
                  this.plugin.settings.chat.noteChars = parsed
                  this.persist()
                }
              })
            )
          }
        },
        {
          name: t('settings.chat.fileChars'),
          desc: t('settings.chat.fileCharsDesc'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text.setValue(String(this.plugin.settings.chat.fileChars)).onChange((value) => {
                const parsed = Number.parseInt(value, 10)
                if (Number.isFinite(parsed) && parsed >= 0) {
                  this.plugin.settings.chat.fileChars = parsed
                  this.persist()
                }
              })
            )
          }
        },
        {
          name: t('settings.llm.timeout'),
          render: (setting: Setting) => {
            setting.addText((text) =>
              text.setValue(String(llm.timeoutSeconds)).onChange((value) => {
                const parsed = Number.parseInt(value, 10)
                if (Number.isFinite(parsed) && parsed > 0) set('timeoutSeconds', parsed)
              })
            )
          }
        }
      ]
    }
  }

  /**
   * The search of the whole vault: on or off, what it leaves out, and the index as it
   * stands — how much it holds, what it is doing, why it stopped —, with the way to bring
   * it up to date, to make it again, and to check the gateway's two models answer.
   */
  /** How documents are read by the model that sees: the steps, as the launch window offers them. */
  private ocrPage(): SettingDefinitionPage {
    return {
      type: 'page',
      name: t('settings.ocr.name'),
      desc: t('settings.ocr.desc'),
      items: OCR_STEPS.map((step) => ({
        name: stepName(step),
        desc: stepDesc(step),
        render: (setting: Setting) => {
          setting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.ocr[step]).onChange((value) => {
              this.plugin.settings.ocr[step] = value
              this.persist()
            })
          )
        }
      }))
    }
  }

  private ragPage(): SettingDefinitionPage {
    const rag = this.plugin.settings.rag
    const indexer = this.plugin.ragIndexer
    return {
      type: 'page',
      name: t('settings.rag.name'),
      desc: t('settings.rag.desc'),
      displayValue: () => (rag.enabled ? t('settings.llm.on') : t('settings.llm.off')),
      items: [
        {
          name: t('settings.rag.enabled'),
          desc: t('settings.rag.enabledDesc'),
          render: (setting: Setting) => {
            setting.addToggle((toggle) =>
              toggle.setValue(rag.enabled).onChange((value) => {
                rag.enabled = value
                this.persist()
                if (value) indexer.schedule(500)
                else indexer.stop()
                this.update()
              })
            )
          }
        },
        {
          name: t('settings.rag.status'),
          render: (setting: Setting) => this.renderRagStatus(setting)
        },
        {
          name: t('settings.rag.check'),
          desc: t('settings.rag.checkDesc'),
          render: (setting: Setting) => this.renderRagCheck(setting)
        },
        {
          name: t('settings.rag.files'),
          desc: t('settings.rag.filesDesc'),
          render: (setting: Setting) => {
            setting.addToggle((toggle) =>
              toggle.setValue(rag.files).onChange((value) => {
                rag.files = value
                this.persist()
                indexer.schedule(2000)
              })
            )
          }
        },
        {
          name: t('settings.rag.rewrite'),
          desc: t('settings.rag.rewriteDesc'),
          control: { type: 'toggle', key: 'rag.rewrite' }
        },
        {
          name: t('settings.rag.exclude'),
          desc: t('settings.rag.excludeDesc'),
          render: (setting: Setting) => {
            setting.addTextArea((area) => {
              area.inputEl.rows = 4
              area
                .setPlaceholder(t('settings.rag.excludePlaceholder'))
                .setValue(rag.exclude)
                .onChange((value) => {
                  rag.exclude = value
                  this.persist()
                  indexer.schedule(8000)
                })
            })
          }
        }
      ]
    }
  }

  /** What the index holds and is doing, kept up to date while it is on screen. */
  private renderRagStatus(setting: Setting): void {
    const indexer = this.plugin.ragIndexer
    const index = this.plugin.ragIndex
    const line = setting.descEl.createDiv({ cls: 'pm-prop-hint' })
    const show = (): void => {
      const state = indexer.state
      line.removeClass('pm-prop-hint--warn')
      if (!indexer.ready) line.setText(t('settings.rag.notReady'))
      else if (state.running) {
        line.setText(
          state.progress?.total
            ? t('settings.rag.running', { done: state.progress.done, total: state.progress.total })
            : t('rag.statusStarting')
        )
      } else if (state.error) {
        line.addClass('pm-prop-hint--warn')
        line.setText(t('settings.rag.failed', { reason: state.error }))
      } else {
        line.setText(
          t('settings.rag.holds', {
            sources: index.sourceCount,
            passages: index.passageCount,
            model: index.modelName || this.plugin.settings.llm.modelEmbed
          })
        )
        if (state.pending) line.appendText(` ${t('settings.rag.pending', { count: state.pending })}`)
      }
    }
    // Followed while the page is open; forgotten once it is not.
    const off = indexer.onChange(() => {
      if (!line.isConnected) off()
      else show()
    })
    if (indexer.ready) {
      safeAsync(async () => {
        await index.load(this.plugin.settings.llm.modelEmbed.trim())
        await indexer.refreshPending()
        show()
      })()
    }
    show()
    setting
      .addButton((button) =>
        button
          .setButtonText(t('settings.rag.update'))
          .setDisabled(!indexer.ready)
          .onClick(safeAsync(() => indexer.run()))
      )
      .addButton((button) => button.setButtonText(t('settings.rag.stop')).onClick(() => indexer.stop()))
      .addButton((button) =>
        button
          .setButtonText(t('settings.rag.rebuild'))
          .setDestructive()
          .setDisabled(!indexer.ready)
          .onClick(safeAsync(() => indexer.rebuild()))
      )
  }

  /** One embedding and one ranking asked of the gateway, and what came back said. */
  private renderRagCheck(setting: Setting): void {
    const line = setting.descEl.createDiv({ cls: 'pm-prop-hint' })
    setting.addButton((button) =>
      button.setButtonText(t('settings.rag.checkButton')).onClick(
        safeAsync(async () => {
          const llm = this.plugin.settings.llm
          const client = new LlmClient({ settings: llm })
          line.removeClass('pm-prop-hint--warn')
          line.setText(t('settings.llm.testing'))
          const parts: string[] = []
          let failed = false
          try {
            const [vector] = await client.embed([t('settings.rag.checkText')], llm.modelEmbed)
            parts.push(t('settings.rag.embedOk', { model: llm.modelEmbed, dims: vector.length }))
          } catch (error) {
            failed = true
            parts.push(
              t('settings.rag.embedFailed', { reason: error instanceof Error ? error.message : String(error) })
            )
          }
          if (llm.modelRerank.trim()) {
            try {
              const scores = await client.rerank(t('settings.rag.checkQuery'), [
                t('settings.rag.checkText'),
                t('settings.rag.checkOther')
              ])
              parts.push(
                scores[0] > scores[1]
                  ? t('settings.rag.rerankOk', { model: llm.modelRerank })
                  : t('settings.rag.rerankOdd', { model: llm.modelRerank })
              )
            } catch (error) {
              failed = true
              parts.push(
                t('settings.rag.rerankFailed', { reason: error instanceof Error ? error.message : String(error) })
              )
            }
          } else parts.push(t('settings.rag.rerankNone'))
          line.toggleClass('pm-prop-hint--warn', failed)
          line.setText(parts.join(' '))
        })
      )
    )
  }

  /**
   * One row per use, each offering whatever the gateway said it has.
   *
   * The names are fetched rather than typed: a model name copied by hand from a wiki page
   * is a 404 three weeks later, and the gateway already publishes the list.
   */
  private llmModelRows(): SettingDefinitionItem[] {
    const llm = this.plugin.settings.llm
    const uses = [
      { key: 'modelText' as const, name: t('settings.llm.modelText'), desc: t('settings.llm.modelTextDesc') },
      {
        key: 'modelTranslate' as const,
        name: t('settings.llm.modelTranslate'),
        desc: t('settings.llm.modelTranslateDesc')
      },
      { key: 'modelEmbed' as const, name: t('settings.llm.modelEmbed'), desc: t('settings.llm.modelEmbedDesc') },
      { key: 'modelRerank' as const, name: t('settings.llm.modelRerank'), desc: t('settings.llm.modelRerankDesc') },
      { key: 'modelOcr' as const, name: t('settings.llm.modelOcr'), desc: t('settings.llm.modelOcrDesc') }
    ]
    return uses.map((use) => ({
      name: use.name,
      desc: use.desc,
      render: (setting: Setting) => {
        setting.addText((text) =>
          text
            .setPlaceholder(this.llmModels[0] ?? '')
            .setValue(llm[use.key])
            .onChange((value) => {
              llm[use.key] = value.trim()
              this.persist()
            })
        )
        // Only once the list has been fetched: a menu of nothing teaches nothing.
        if (!this.llmModels.length) return
        setting.addExtraButton((button) => {
          button.setIcon('list').setTooltip(t('settings.llm.pick'))
          // The component's own onClick is handed no event, and a menu has to hang off
          // something, so the button's element is listened to directly.
          button.extraSettingsEl.addEventListener('click', (event: MouseEvent) => {
            const menu = new Menu()
            for (const model of this.llmModels) {
              menu.addItem((item) =>
                item
                  .setTitle(model)
                  .setChecked(model === llm[use.key])
                  .onClick(() => {
                    llm[use.key] = model
                    this.persist()
                    this.update()
                  })
              )
            }
            menu.showAtMouseEvent(event)
          })
        })
      }
    }))
  }

  /**
   * The only honest connection test: ask for the model list.
   *
   * It is the one call that needs nothing configured beyond the address, and it answers
   * the two questions at once — can this machine reach the gateway, and what does it
   * offer. The answer fills the model pickers above.
   */
  private renderLlmTest(setting: Setting): void {
    const status = setting.descEl.createDiv({ cls: 'pm-prop-hint' })
    if (this.llmModels.length) {
      status.setText(t('settings.llm.found', { count: this.llmModels.length }))
    }
    setting.addButton((button) =>
      button.setButtonText(t('settings.llm.test')).onClick(
        safeAsync(async () => {
          status.removeClass('pm-prop-hint--warn')
          status.setText(t('settings.llm.testing'))
          try {
            const models = await new LlmClient({ settings: this.plugin.settings.llm }).models()
            this.llmModels = models
            status.setText(t('settings.llm.found', { count: models.length }))
            this.update()
          } catch (error) {
            this.llmModels = []
            status.addClass('pm-prop-hint--warn')
            status.setText(error instanceof Error ? error.message : String(error))
          }
        })
      )
    )
  }

  private zonesPage(): SettingDefinitionPage {
    const zones = this.plugin.settings.zones
    return {
      type: 'page',
      name: t('settings.zones.name'),
      desc: t('settings.zones.desc'),
      displayValue: () => t('count.zones', { count: zones.length }),
      items: [
        {
          type: 'list',
          heading: t('settings.zones.name'),
          emptyState: t('settings.zones.empty'),
          items: zones.map((zone) => ({
            name: zone.label,
            render: (setting: Setting) => {
              setting.setClass('pm-palette-row')
              renderPaletteFields(setting.controlEl, zone, () => this.persist())
            }
          })),
          onReorder: (from, to) => this.reorder(zones, from, to),
          onDelete: (index) => {
            zones.splice(index, 1)
            this.persist()
            this.update()
          },
          addItem: {
            name: t('settings.zones.add'),
            action: () => {
              zones.push({
                id: 'zone-' + makeId().slice(0, 6),
                label: t('settings.zones.new'),
                color: '#8b8c92',
                icon: 'map-pin'
              })
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
                color: '#8b8c92',
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
