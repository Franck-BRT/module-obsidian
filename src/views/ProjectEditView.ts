import { ButtonComponent, ItemView, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../main'
import {
  type CustomFieldDef,
  type PriorityConfig,
  type PriorityIconSet,
  type Project,
  type ProjectConfig,
  type ProjectPatch,
  type StatusConfig,
  makeId,
  priorityIconSetLabels
} from '../types'
import { collectAllAssignees, flattenTasks, mergeById } from '../store'
import { safeAsync, truncateTitle } from '../utils'
import { confirmDialog } from '../ui/ModalFactory'
import { renderPersonPicker } from '../ui/PersonPicker'
import { renderAddButton } from '../ui/composites/addButton'
import { renderPropRow } from '../ui/FormField'
import { renderGlyph, renderIconControl, renderInputControl, renderSelectControl } from '../ui/composites/properties'
import { renderPriorityListEditor, renderStatusListEditor } from '../ui/PaletteListEditor'
import { CUSTOM_FIELD_TYPE_LABELS, renderCustomFieldListEditor } from '../ui/CustomFieldListEditor'
import { EmptyState } from '../ui/primitives/EmptyState'
import { IconButton } from '../ui/primitives/IconButton'
import { t } from '../i18n'

export const PM_PROJECT_EDIT_VIEW_TYPE = 'pm-project-edit'

export interface ProjectEditState {
  filePath?: string
  [key: string]: unknown
}

export class ProjectEditView extends ItemView {
  plugin: PMPlugin
  private state: ProjectEditState = {}
  private project: Project | null = null
  private container!: HTMLElement

  constructor(leaf: WorkspaceLeaf, plugin: PMPlugin) {
    super(leaf)
    this.plugin = plugin
    this.navigation = false
  }

  getViewType(): string {
    return PM_PROJECT_EDIT_VIEW_TYPE
  }
  getDisplayText(): string {
    return truncateTitle(this.project?.title ?? t('scope.project'), 10)
  }
  getIcon(): string {
    return 'settings'
  }

  async setState(state: ProjectEditState, result: unknown): Promise<void> {
    const changed = state.filePath !== this.state.filePath
    this.state = state
    if (changed || !this.project) await this.loadProject()
    await super.setState(state, result as import('obsidian').ViewStateResult)
  }

  getState(): ProjectEditState {
    return this.state
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    this.contentEl.empty()
    this.contentEl.addClass('pm-root')
    this.container = this.contentEl.createDiv('pm-edit')
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.contentEl.empty()
    return Promise.resolve()
  }

  private async loadProject(): Promise<void> {
    const path = this.state.filePath
    this.project = path ? await this.plugin.store.loadProjectByPath(path) : null
    if (!this.project) {
      this.container.empty()
      new EmptyState(this.container)
        .setIcon('📋')
        .setTitle(t('project.noProjectHere'))
        .setBody(t('view.mayHaveBeenDeleted'))
      return
    }
    await this.plugin.store.loadProjectBody(this.project)
    ;(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.()
    this.render()
  }

  private readonly save = safeAsync(async (patch: ProjectPatch) => {
    if (this.project) await this.plugin.store.updateProject(this.project, patch)
  })

  /** Sets or clears one override; the config goes away entirely when its last field clears. */
  private patchConfig<K extends keyof ProjectConfig>(key: K, value: ProjectConfig[K] | undefined): void {
    const entries = Object.entries({ ...this.project?.config, [key]: value }).filter(([, v]) => v !== undefined)
    this.save({ config: entries.length ? Object.fromEntries(entries) : undefined })
    // Today's pass ran against the old window, so it has to run again.
    if (key === 'autoArchiveDays') this.plugin.settings.lastAutoArchiveDate = ''
  }

  private section(title: string, hint = ''): HTMLElement {
    const section = this.container.createDiv('pm-edit-section')
    section.createDiv({ cls: 'pm-section-label', text: title })
    if (hint) section.createDiv({ cls: 'pm-modal-hint', text: hint })
    return section
  }

  render(): void {
    const project = this.project
    if (!project) return
    this.container.empty()

    this.renderHeader(project)
    this.renderGeneral(project)
    this.renderMembers(project)
    this.renderStatuses(project)
    this.renderPriorities(project)
    this.renderBehavior(project)
    this.renderCustomFields(project)
    this.renderDangerZone(project)
  }

  private renderHeader(project: Project): void {
    const header = this.container.createDiv('pm-edit-header')
    const tile = header.createDiv({ cls: 'pm-overview-icon' })
    tile.style.setProperty('--pm-overview-tint', project.color)
    renderGlyph(tile, { icon: project.icon, color: project.color })
    const identity = header.createDiv('pm-overview-identity')
    identity.createDiv({ cls: 'pm-overview-title', text: project.title })
    identity.createDiv({ cls: 'pm-overview-subline', text: t('project.settings') })
    new ButtonComponent(header)
      .setButtonText(t('common.done'))
      .setCta()
      .onClick(safeAsync(() => this.plugin.router.openProjectOverview(project.filePath, this.leaf)))
  }

  private renderGeneral(project: Project): void {
    const section = this.section(t('field.general'))
    const props = section.createDiv('pm-edit-props')

    renderPropRow(props, t('field.name'), () => {
      const cell = createDiv('pm-prop-value')
      renderInputControl({
        container: cell,
        value: project.title,
        placeholder: t('project.name'),
        onChange: (value) => {
          const title = value.trim()
          if (!title || title === project.title) return
          this.save({ title })
          this.render()
        }
      })
      return cell
    })

    renderPropRow(props, t('field.icon'), () => {
      const cell = createDiv('pm-prop-value')
      renderIconControl({
        container: cell,
        value: project.icon,
        color: project.color,
        onChange: (icon) => {
          this.save({ icon })
          this.render()
        }
      })
      return cell
    })

    renderPropRow(props, t('field.color'), () => {
      const cell = createDiv('pm-prop-value')
      const picker = cell.createEl('input', { type: 'color', cls: 'pm-color-custom' })
      picker.value = project.color
      picker.title = t('field.projectColor')
      picker.addEventListener('change', () => {
        this.save({ color: picker.value })
        this.render()
      })
      return cell
    })

    renderPropRow(props, t('field.parent'), () => {
      const cell = createDiv('pm-prop-value')
      const excluded = new Set([
        project.filePath,
        ...this.plugin.index.descendantRefs(project.filePath).map((ref) => ref.path)
      ])
      renderSelectControl({
        container: cell,
        value: project.parentPath ?? '',
        placeholder: t('common.noParent'),
        search: true,
        options: [
          { id: '', label: t('common.noParent') },
          ...this.plugin.index
            .projectRefs()
            .filter((ref) => !excluded.has(ref.path))
            .map((ref) => ({ id: ref.path, label: ref.title, color: ref.color }))
        ],
        onChange: (path) => {
          this.save({ parentPath: path || undefined })
          this.render()
        }
      })
      return cell
    })

    const desc = section.createDiv('pm-edit-block')
    desc.createEl('label', { text: t('common.description'), cls: 'pm-label' })
    const area = desc.createEl('textarea', { cls: 'pm-input pm-edit-desc' })
    area.placeholder = t('field.projectAbout')
    area.value = project.description
    area.addEventListener('change', () => {
      this.save({ description: area.value })
    })
  }

  private renderMembers(project: Project): void {
    const section = this.section(t('project.members'), t('field.whoIsOn'))
    renderPersonPicker({
      container: section.createDiv('pm-prop-value'),
      plugin: this.plugin,
      sourcePath: project.filePath,
      extra: () => collectAllAssignees(project.tasks),
      addLabel: t('project.addMember'),
      selected: () => project.teamMembers,
      add: (value) => this.save({ teamMembers: [...project.teamMembers, value] }),
      remove: (value) => this.save({ teamMembers: project.teamMembers.filter((name) => name !== value) })
    })
  }

  private renderStatuses(project: Project): void {
    this.renderPaletteOverride<StatusConfig>({
      heading: t('settings.statuses.name'),
      hint: t('view.workflowForProject'),
      toggleLabel: t('view.customStatuses'),
      addLabel: t('settings.statuses.add'),
      get: () => project.config?.statuses,
      set: (statuses) => this.patchConfig('statuses', statuses),
      copyGlobal: () => this.plugin.settings.statuses.map((status) => ({ ...status })),
      makeEntry: () => ({
        id: 'status-' + makeId().slice(0, 6),
        label: t('settings.statuses.new'),
        color: '#8b8c92',
        icon: '',
        complete: false
      }),
      renderEditor: (container, statuses) =>
        renderStatusListEditor(container, {
          statuses,
          onChanged: () => this.save({ config: project.config })
        })
    })
  }

  private renderPriorities(project: Project): void {
    this.renderPaletteOverride<PriorityConfig>({
      heading: t('settings.priorities.name'),
      hint: t('view.scaleForProject'),
      toggleLabel: t('view.customPriorities'),
      addLabel: t('settings.priorities.add'),
      get: () => project.config?.priorities,
      set: (priorities) => this.patchConfig('priorities', priorities),
      copyGlobal: () => this.plugin.settings.priorities.map((priority) => ({ ...priority })),
      makeEntry: () => ({
        id: 'priority-' + makeId().slice(0, 6),
        label: t('settings.priorities.new'),
        color: '#8b8c92',
        icon: ''
      }),
      renderEditor: (container, priorities) =>
        renderPriorityListEditor(container, {
          priorities,
          onChanged: () => this.save({ config: project.config })
        })
    })
  }

  private renderPaletteOverride<T>(opts: {
    heading: string
    hint: string
    toggleLabel: string
    addLabel: string
    get: () => T[] | undefined
    set: (items: T[] | undefined) => void
    copyGlobal: () => T[]
    makeEntry: () => T
    renderEditor: (container: HTMLElement, items: T[]) => void
  }): void {
    const section = this.section(opts.heading, opts.hint)
    const toggle = section.createEl('label', { cls: 'pm-status-toggle' })
    const checkbox = toggle.createEl('input', { type: 'checkbox' })
    checkbox.checked = !!opts.get()?.length
    toggle.createSpan({ text: opts.toggleLabel })

    const editor = section.createDiv('pm-settings-statuses')
    const footer = section.createDiv()
    const drawEditor = (): void => {
      editor.empty()
      footer.empty()
      const own = opts.get()
      if (!own?.length) return
      opts.renderEditor(editor, own)
      renderAddButton(footer, opts.addLabel, () => {
        own.push(opts.makeEntry())
        opts.set(own)
        drawEditor()
      })
    }
    checkbox.addEventListener('change', () => {
      opts.set(checkbox.checked ? opts.copyGlobal() : undefined)
      drawEditor()
    })
    drawEditor()
  }

  private renderBehavior(project: Project): void {
    const section = this.section(t('view.viewAndScheduling'), t('view.overridesForProject'))
    const props = section.createDiv('pm-edit-props')
    const row = <K extends keyof ProjectConfig>(
      label: string,
      key: K,
      options: { value: NonNullable<ProjectConfig[K]>; label: string }[]
    ): void => {
      renderPropRow(props, label, () => {
        const cell = createDiv('pm-prop-value')
        const current = project.config?.[key]
        renderSelectControl({
          container: cell,
          value: current === undefined ? 'inherit' : String(options.findIndex((o) => o.value === current)),
          options: [
            { id: 'inherit', label: t('projectEdit.useGlobal') },
            ...options.map((option, i) => ({ id: String(i), label: option.label }))
          ],
          onChange: (id) => {
            this.patchConfig(key, id === 'inherit' ? undefined : options[Number(id)].value)
            this.render()
          }
        })
        return cell
      })
    }

    row(t('settings.defaultView.name'), 'defaultView', [
      { value: 'table', label: t('common.table') },
      { value: 'gantt', label: t('common.gantt') },
      { value: 'kanban', label: t('common.board') }
    ])
    row(
      t('settings.priorityIcons.name'),
      'priorityIcons',
      Object.entries(priorityIconSetLabels()).map(([value, label]) => ({ value: value as PriorityIconSet, label }))
    )
    row(t('settings.autoSchedule.name'), 'autoSchedule', [
      { value: true, label: t('common.on') },
      { value: false, label: t('common.off') }
    ])
    row(t('view.pullForwardShort'), 'pullForwardOnEarlyFinish', [
      { value: true, label: t('common.on') },
      { value: false, label: t('common.off') }
    ])
    row(t('settings.autoArchive.name'), 'autoArchiveDays', [
      { value: 0, label: t('projectEdit.never') },
      { value: 7, label: t('projectEdit.after7') },
      { value: 14, label: t('projectEdit.after14') },
      { value: 30, label: t('projectEdit.after30') },
      { value: 90, label: t('projectEdit.after90') }
    ])
    row(t('view.subtreeInTable'), 'showSubtreeConnections', [
      { value: true, label: t('common.show') },
      { value: false, label: t('common.hide') }
    ])
    row(t('view.bordersInTable'), 'lineBorders', [
      { value: 'none', label: t('common.none') },
      { value: 'horizontal', label: t('common.horizontal') },
      { value: 'vertical', label: t('common.vertical') },
      { value: 'both', label: t('common.both') }
    ])
    row(t('view.subtasksOnBoard'), 'kanbanShowSubtasks', [
      { value: true, label: t('common.show') },
      { value: false, label: t('common.hide') }
    ])
    row(t('view.previewOnBoard'), 'kanbanShowDescriptionPreview', [
      { value: true, label: t('common.show') },
      { value: false, label: t('common.hide') }
    ])
  }

  /**
   * The whole chain the project inherits from, nearest ancestor winning. Unfiltered: a
   * hidden field still needs a row to unhide, and an overridden one names its source.
   */
  private inheritedFields(project: Project): { field: CustomFieldDef; source: string }[] {
    const ancestors = this.plugin.index.ancestorRefs(project.filePath)
    return mergeById([
      this.plugin.settings.customFields.map((field) => ({ id: field.id, field, source: t('view.vaultSettings') })),
      ...ancestors.map((ref) => ref.customFields.map((field) => ({ id: field.id, field, source: ref.title })))
    ])
  }

  private renderCustomFields(project: Project): void {
    const section = this.section(t('task.customFields'), t('view.extraProperties'))

    const inherited = this.inheritedFields(project)
    const own = new Set(project.customFields.map((field) => field.id))
    const notOverridden = inherited.filter((entry) => !own.has(entry.field.id))
    if (notOverridden.length > 0) {
      section.createDiv({ cls: 'pm-section-sublabel', text: t('projectEdit.inherited') })
      const inheritedList = section.createDiv('pm-cf-list')
      for (const entry of notOverridden) this.renderInheritedField(inheritedList, project, entry.field, entry.source)
      section.createDiv({ cls: 'pm-section-sublabel', text: t('project.thisProject') })
    }

    const sourceById = new Map(inherited.map((entry) => [entry.field.id, entry.source]))
    renderCustomFieldListEditor(section.createDiv('pm-cf-list'), {
      fields: project.customFields,
      onChanged: () => this.save({ customFields: project.customFields }),
      redraw: () => this.render(),
      renderExtra: (row, field) => {
        const source = sourceById.get(field.id)
        if (source) {
          row.createSpan({ cls: 'pm-cf-source', text: t('projectEdit.overrides', { source }) })
          return
        }
        const twin = notOverridden.find((entry) => entry.field.name === field.name && entry.field.type === field.type)
        if (!twin) return
        new IconButton(row)
          .setIcon('git-merge')
          .setTooltip(t('projectEdit.mergeInto', { field: twin.field.name, source: twin.source }))
          .onClick(() => this.mergeIntoInherited(project, field, twin.field, twin.source))
      }
    })
  }

  /** Folds a field that duplicates an inherited one into it, values and all. */
  private readonly mergeIntoInherited = safeAsync(
    async (project: Project, own: CustomFieldDef, target: CustomFieldDef, source: string) => {
      const ok = await confirmDialog(
        this.app,
        t('view.mergeFieldConfirm', { own: own.name, target: target.name, source }),
        t('view.merge')
      )
      if (!ok) return
      const taskIds = flattenTasks(project.tasks).map((flat) => flat.task.id)
      await this.plugin.store.updateTasks(project, taskIds, (task) => {
        if (!(own.id in task.customFields)) return null
        const { [own.id]: value, ...rest } = task.customFields
        return { customFields: target.id in rest ? rest : { ...rest, [target.id]: value } }
      })
      const index = project.customFields.findIndex((field) => field.id === own.id)
      if (index >= 0) project.customFields.splice(index, 1)
      await this.plugin.store.updateProject(project, { customFields: project.customFields })
      this.render()
    }
  )

  private renderInheritedField(container: HTMLElement, project: Project, field: CustomFieldDef, source: string): void {
    const hidden = project.config?.hiddenCustomFields ?? []
    const isHidden = hidden.includes(field.id)
    const row = container.createDiv('pm-cf-row pm-cf-row--inherited')
    row.toggleClass('pm-cf-row--hidden', isHidden)

    row.createSpan({ cls: 'pm-cf-name', text: field.name })
    row.createSpan({ cls: 'pm-cf-type', text: CUSTOM_FIELD_TYPE_LABELS[field.type] })
    row.createSpan({ cls: 'pm-cf-source', text: t('projectEdit.from', { source }) })

    new IconButton(row)
      .setIcon(isHidden ? 'eye-off' : 'eye')
      .setTooltip(isHidden ? t('view.showOnProject') : t('view.hideOnProject'))
      .onClick(() => {
        const next = isHidden ? hidden.filter((id) => id !== field.id) : [...hidden, field.id]
        this.patchConfig('hiddenCustomFields', next.length ? next : undefined)
        this.render()
      })

    new IconButton(row)
      .setIcon('pencil')
      .setTooltip(t('projectEdit.override'))
      .onClick(() => {
        // Copied, not aliased: the definition belongs to the ancestor's indexed frontmatter.
        const copy: CustomFieldDef = { ...field }
        if (field.options) copy.options = [...field.options]
        project.customFields.push(copy)
        this.save({ customFields: project.customFields })
        this.render()
      })
  }

  private renderDangerZone(project: Project): void {
    const section = this.container.createDiv('pm-edit-danger')
    const text = section.createDiv('pm-edit-danger-text')
    text.createDiv({ cls: 'pm-edit-danger-title', text: t('project.delete') })
    text.createDiv({ cls: 'pm-modal-hint', text: t('project.deleteHint') })
    new ButtonComponent(section)
      .setButtonText(t('project.delete'))
      .setDestructive()
      .onClick(
        safeAsync(async () => {
          const ok = await confirmDialog(this.app, `Delete "${project.title}"?`)
          if (!ok) return
          await this.plugin.store.deleteProject(project)
          this.leaf.detach()
        })
      )
  }
}
