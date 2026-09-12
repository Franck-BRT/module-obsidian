import { MarkdownView, Plugin, Notice } from 'obsidian'
import {
  DEFAULT_SETTINGS,
  makeDefaultFilter,
  seedPriorities,
  seedStatuses,
  type PMSettings,
  type Project,
  type Task
} from './types'
import { flattenTasks, findTask } from './store/TaskTreeOps'
import { restepPalette } from './store/paletteRestep'
import {
  addToCollection,
  collectionMemberIds,
  CollectionStore,
  isAwaited,
  DocumentStore,
  matchPersonNotes,
  personLink,
  ProjectStore,
  readFormerSettings,
  removeFromCollection,
  scopeKey,
  VaultIndex
} from './store'
import type { FormerSettings, ProjectRef, TaskSource } from './store'
import { PMSettingTab } from './settings'
import { ProjectView, PM_PROJECT_VIEW_TYPE } from './views/ProjectView'
import { ProjectOverviewView, PM_PROJECT_OVERVIEW_VIEW_TYPE } from './views/ProjectOverviewView'
import { ProjectEditView, PM_PROJECT_EDIT_VIEW_TYPE } from './views/ProjectEditView'
import { DashboardView, PM_DASHBOARD_VIEW_TYPE } from './views/DashboardView'
import { TaskView, PM_TASK_VIEW_TYPE } from './views/TaskView'
import { registerStyleguide } from './views/styleguide/StyleguideView'
import { PMViewRouter } from './views/PMViewRouter'
import {
  openTaskModal,
  openProjectCreate,
  openPersonLookup,
  openCollectionPicker,
  openProjectPicker,
  openTaskPicker,
  openImportModal,
  confirmDialog,
  promptText
} from './ui/ModalFactory'
import { Notifier } from './components/Notifier'
import { AutoArchiver } from './components/AutoArchiver'
import { IdRepair } from './components/IdRepair'
import { migrateProjects, migrateProjectLayout } from './migration'
import { dedupePeople, displayName, safeAsync } from './utils'
import { today } from './dates'
import { setLocale, t } from './i18n'

export default class PMPlugin extends Plugin {
  settings: PMSettings = { ...DEFAULT_SETTINGS }
  store!: TaskSource
  collections!: CollectionStore
  documents!: DocumentStore
  index!: VaultIndex
  notifier!: Notifier
  autoArchiver!: AutoArchiver
  idRepair!: IdRepair
  router!: PMViewRouter
  /** Paths deliberately sent to the markdown editor, which the swap then leaves alone. */
  private markdownEscapes = new Set<string>()
  private viewRefreshScheduled = false
  undoStack: Array<{ undo: () => Promise<void>; redo: () => Promise<void> }> = []
  redoStack: Array<{ undo: () => Promise<void>; redo: () => Promise<void> }> = []

  pushUndo(entry: { undo: () => Promise<void>; redo: () => Promise<void> }): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > 20) this.undoStack.shift()
    this.redoStack = []
  }

  async undoLastAction(): Promise<void> {
    const entry = this.undoStack.pop()
    if (entry) {
      await entry.undo()
      this.redoStack.push(entry)
    }
  }

  async redoLastAction(): Promise<void> {
    const entry = this.redoStack.pop()
    if (entry) {
      await entry.redo()
      this.undoStack.push(entry)
    }
  }

  async onload(): Promise<void> {
    await this.loadSettings()
    this.index = new VaultIndex(this.app, () => this.settings)
    // The first sweep can run against a half-filled metadata cache, so it runs again once
    // the index has caught up. Everything in it is safe to repeat.
    this.index.register(this, () => {
      void this.startupSweep()
    })
    this.store = new ProjectStore(this.app, () => this.settings, this.index)
    this.collections = new CollectionStore(this.app, this.index)
    this.documents = new DocumentStore(this.app)
    this.store.registerVaultSync(this)
    this.notifier = new Notifier(this)
    this.autoArchiver = new AutoArchiver(this)
    this.idRepair = new IdRepair(this)
    this.router = new PMViewRouter(this)

    this.registerView(PM_PROJECT_VIEW_TYPE, (leaf) => new ProjectView(leaf, this))
    this.registerView(PM_PROJECT_OVERVIEW_VIEW_TYPE, (leaf) => new ProjectOverviewView(leaf, this))
    this.registerView(PM_PROJECT_EDIT_VIEW_TYPE, (leaf) => new ProjectEditView(leaf, this))
    this.registerView(PM_DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this))
    this.registerView(PM_TASK_VIEW_TYPE, (leaf) => new TaskView(leaf, this))
    this.registerTaskNoteSwap()
    if (__STYLEGUIDE__) registerStyleguide(this)

    this.app.workspace.onLayoutReady(
      safeAsync(async () => {
        this.index.build()
        await this.startupSweep()
      })
    )

    this.addRibbonIcon('chart-gantt', t('ribbon.title'), async () => {
      await this.router.openDashboard()
    })

    this.addCommand({
      id: 'open-projects',
      name: t('command.openProjects'),
      callback: () => {
        void this.router.openDashboard()
      }
    })

    this.addCommand({
      id: 'new-collection',
      name: t('collection.new'),
      callback: safeAsync(() => this.createCollection())
    })

    this.addCommand({
      id: 'new-project',
      name: t('command.newProject'),
      callback: () => {
        openProjectCreate(this)
      }
    })

    this.addCommand({
      id: 'new-task',
      name: t('command.newTask'),
      callback: () => {
        this.pickProjectThenCreateTask(null)
      }
    })

    this.addCommand({
      id: 'new-subtask',
      name: t('command.newSubtask'),
      callback: () => {
        this.pickProjectThenCreateTask('pick-parent')
      }
    })

    this.addCommand({
      id: 'duplicate-project',
      name: t('command.duplicateProject'),
      callback: () => {
        this.pickProject(
          safeAsync((project) => this.duplicateProjectFlow(project)),
          false
        )
      }
    })

    this.addCommand({
      id: 'undo-last-action',
      name: t('command.undo'),
      callback: () => {
        void this.undoLastAction()
      }
    })

    this.addCommand({
      id: 'redo-last-action',
      name: t('command.redo'),
      callback: () => {
        void this.redoLastAction()
      }
    })

    this.addCommand({
      id: 'awaited-documents',
      name: t('command.awaitedDocuments'),
      callback: () => {
        this.showAwaitedDocuments()
      }
    })

    this.addCommand({
      id: 'open-all-projects',
      name: t('command.openAllProjects'),
      callback: () => {
        void this.router.openScope({ kind: 'vault' })
      }
    })

    this.addCommand({
      id: 'rebuild-project-index',
      name: t('command.rebuildIndex'),
      callback: () => {
        this.index.build()
        this.showNotice(
          t('flow.foundProjects', { projects: t('count.projects', { count: this.index.projectRefs().length }) })
        )
      }
    })

    this.addCommand({
      id: 'archive-completed-tasks',
      name: t('command.archiveCompleted'),
      callback: () => {
        void this.archiveCompletedTasks()
      }
    })

    this.addCommand({
      id: 'import-notes-as-tasks',
      name: t('command.importNotes'),
      callback: () => {
        this.importNotes()
      }
    })

    this.addCommand({
      id: 'create-task-from-selection',
      name: t('command.taskFromSelection'),
      editorCheckCallback: (checking, editor) => {
        const selection = editor.getSelection().trim()
        if (!selection) return false
        if (checking) return true
        this.createTaskFromText(selection)
        return true
      }
    })

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        const selection = editor.getSelection().trim()
        if (!selection) return
        menu.addItem((item) =>
          item
            .setTitle(t('command.taskFromSelection'))
            .setIcon('list-plus')
            .onClick(() => this.createTaskFromText(selection))
        )
      })
    )

    this.addCommand({
      id: 'open-current-as-project',
      name: t('command.openCurrentAsProject'),
      checkCallback: (checking: boolean) => {
        const md = this.app.workspace.getActiveViewOfType(MarkdownView)
        const file = md?.file
        if (!file) return false
        const cache = this.app.metadataCache.getFileCache(file)
        if (cache?.frontmatter?.['pm-project'] !== true) return false
        if (checking) return true
        void this.router.openProjectLink(file.path, md.leaf)
        return true
      }
    })

    this.addCommand({
      id: 'person-tasks',
      name: t('command.personTasks'),
      callback: () => {
        openPersonLookup(
          this,
          this.index.allAssignees(),
          safeAsync((value) => this.showTasksForPerson(value))
        )
      }
    })

    this.addCommand({
      id: 'person-tasks-this-note',
      name: t('command.personTasksThisNote'),
      checkCallback: (checking: boolean) => {
        const md = this.app.workspace.getActiveViewOfType(MarkdownView)
        const file = md?.file
        if (!file) return false
        const cache = this.app.metadataCache.getFileCache(file)
        if (cache?.frontmatter?.['pm-task'] === true || cache?.frontmatter?.['pm-project'] === true) return false
        if (checking) return true
        void this.showTasksForPerson(personLink(this.app, file, ''))
        return true
      }
    })

    this.addCommand({
      id: 'link-people-to-notes',
      name: t('command.linkPeople'),
      callback: () => {
        void this.linkPeopleToNotes()
      }
    })

    this.addSettingTab(new PMSettingTab(this.app, this))
    this.notifier.start()
    this.autoArchiver.start()
    this.idRepair.start()
  }

  onunload(): void {
    this.notifier.stop()
  }

  /** Opens a task note in Obsidian's own editor, where the swap leaves it alone. */
  async openAsMarkdown(path: string): Promise<void> {
    this.markdownEscapes.add(path)
    await this.app.workspace.openLinkText(path, '', true)
  }

  private registerTaskNoteSwap(): void {
    const swap = (): void => this.swapTaskNotes()
    this.registerEvent(this.app.workspace.on('file-open', swap))
    this.registerEvent(this.app.workspace.on('layout-change', swap))
    this.registerEvent(this.app.workspace.on('active-leaf-change', swap))
  }

  /**
   * Sweeps every markdown leaf rather than the one being opened: a note opened into a
   * background tab reports no file-open at all, and one that replaces the active leaf
   * reports it while Obsidian is still building the view it is about to overwrite.
   */
  private swapTaskNotes(): void {
    if (this.settings.taskEditorSurface !== 'tab') return
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view
      if (!(view instanceof MarkdownView)) continue
      const file = view.file
      if (!file || this.markdownEscapes.has(file.path)) continue
      if (this.app.metadataCache.getFileCache(file)?.frontmatter?.['pm-task'] !== true) continue
      void leaf.setViewState({ type: PM_TASK_VIEW_TYPE, state: { filePath: file.path } })
    }
  }

  async loadSettings(): Promise<void> {
    let saved = (await this.loadData()) as Partial<PMSettings> | null
    // Only when this folder holds nothing of its own: an install that has already run
    // once must never be overwritten by what an older folder still remembers.
    const adopted = saved ? null : await this.adoptFormerSettings()
    if (adopted) saved = adopted.settings
    // Cloned: a shallow merge would hand the live settings the very arrays and objects
    // DEFAULT_SETTINGS holds, and the first edit would write into the defaults.
    this.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), saved ?? {})
    // A vault that predates the flag has not had the pass, whatever the default says.
    if (saved && saved.paletteRestepped === undefined) this.settings.paletteRestepped = false
    // Before anything reads a string: the palettes seeded just below are localized.
    setLocale(this.settings.language)
    if (!saved?.statuses?.length) this.settings.statuses = seedStatuses()
    if (!saved?.priorities?.length) this.settings.priorities = seedPriorities()
    if (!this.settings.projectFilters) this.settings.projectFilters = {}
    if (!this.settings.scopeViews) this.settings.scopeViews = {}
    if (!this.settings.collapsedTasks) this.settings.collapsedTasks = {}
    if (!this.settings.collapsedProjects) this.settings.collapsedProjects = []
    if (!this.settings.excludedFolders) this.settings.excludedFolders = []

    let migrated = false
    // Filters were keyed by project path before a view could cover several projects.
    for (const key of Object.keys(this.settings.projectFilters)) {
      if (key.includes(':')) continue
      this.settings.projectFilters[`project:${key}`] = this.settings.projectFilters[key]
      Reflect.deleteProperty(this.settings.projectFilters, key)
      migrated = true
    }

    for (const s of this.settings.statuses) {
      if (s.complete === undefined) {
        s.complete = s.id === 'done' || s.id === 'cancelled'
        migrated = true
      }
    }

    // The two colours re-stepped in 2.22.0. A vault that predates them is offered them
    // once, and only where the palette still carries the old default.
    if (!this.settings.paletteRestepped) {
      restepPalette(this.settings.statuses)
      restepPalette(this.settings.priorities)
      // Written back even when nothing moved, so the pass is spent either way.
      this.settings.paletteRestepped = true
      migrated = true
    }

    // ganttHideDone was a global toggle, now expressed as a per-project status filter.
    const legacy = (saved ?? {}) as { ganttHideDone?: boolean }
    if (legacy.ganttHideDone === true) {
      const nonTerminal = this.settings.statuses.filter((s) => !s.complete).map((s) => s.id)
      for (const entry of Object.values(this.settings.projectFilters)) {
        if (entry.filter.statuses.length === 0) {
          entry.filter.statuses = nonTerminal
        }
      }
      migrated = true
    }

    if (migrated || adopted) await this.saveSettings()
    if (adopted) new Notice(t('notice.settingsAdopted', { folder: adopted.folder }))
  }

  /**
   * Reads the settings left in the folder this plugin used to be installed under, so a
   * rename does not silently reset everyone to the defaults. Failing is fine — the
   * defaults are a working plugin, and nothing has been written yet.
   */
  private async adoptFormerSettings(): Promise<FormerSettings | null> {
    const read = async (path: string): Promise<string | null> => {
      try {
        return await this.app.vault.adapter.read(path)
      } catch {
        return null
      }
    }
    try {
      return await readFormerSettings(read, this.app.vault.configDir)
    } catch {
      return null
    }
  }

  /**
   * A scope key is `vault`, or a kind and a path. Only the path-bearing ones can go
   * stale, and a key that names no path at all is kept rather than guessed at.
   */
  private scopeKeyResolves(key: string): boolean {
    const separator = key.indexOf(':')
    if (separator === -1) return true
    const path = key.slice(separator + 1)
    return path === '' || this.app.vault.getAbstractFileByPath(path) !== null
  }

  /** Prompts for a name and opens the empty collection, ready to be filled. */
  async createCollection(): Promise<void> {
    const title = await promptText(this.app, t('collection.new'), t('collection.name'), '')
    if (!title) return
    const collection = await this.collections.create(title, this.settings.projectsFolder)
    if (!collection) return
    // The index reads it on the metadata change; opening before that finds nothing.
    this.index.build()
    await this.router.openScope({ kind: 'collection', path: collection.filePath })
  }

  /**
   * Adds a task to a collection the user picks. Membership lives on the collection, not
   * the task, so nothing about the task's own note changes.
   */
  addTaskToCollection(taskId: string): void {
    const collections = this.index.collectionRefs()
    if (!collections.length) {
      this.showNotice(t('collection.noneYet'))
      return
    }
    openCollectionPicker(
      this,
      collections,
      safeAsync(async (ref) => {
        await this.collections.update(ref.path, (collection) => addToCollection(collection, taskId))
        this.index.build()
        this.refreshViews()
        this.showNotice(t('collection.added', { name: ref.title }))
      })
    )
  }

  async removeTaskFromCollection(collectionPath: string, taskId: string): Promise<void> {
    const ref = this.index.collectionRef(collectionPath)
    if (!ref) return
    // Only a rule-matched task needs an exclusion recorded; a hand-picked one just goes.
    const matchedByRule = ref.rule
      ? collectionMemberIds(
          { ...ref, include: [], exclude: [] },
          this.index.allTaskRefs(),
          this.settings.statuses
        ).includes(taskId)
      : false
    await this.collections.update(collectionPath, (collection) =>
      removeFromCollection(collection, taskId, matchedByRule)
    )
    this.index.build()
    this.refreshViews()
    this.showNotice(t('collection.removed', { name: ref.title }))
  }

  /** Prompts for a title, copies the project with fresh task ids, and opens the copy. */
  async duplicateProjectFlow(source: Project): Promise<void> {
    const title = await promptText(
      this.app,
      t('flow.duplicateAs', { title: source.title }),
      t('project.name'),
      `${source.title} copy`
    )
    if (!title) return
    let copy: Project
    try {
      copy = await this.store.duplicateProject(source, title)
    } catch (e) {
      this.showNotice(e instanceof Error ? e.message : String(e))
      return
    }
    await this.router.openProjectOverview(copy.filePath)
  }

  /**
   * What the open project is still waiting for, past its date. Scoped to the view rather
   * than to the vault: chasing a document is something you do inside one project, and
   * reading every task note in the vault to answer it would cost more than it is worth.
   */
  private showAwaitedDocuments(): void {
    const scope = this.app.workspace.getActiveViewOfType(ProjectView)?.projectScope
    const now = today().toString()
    const awaited = (scope?.tasks() ? flattenTasks(scope.tasks()) : [])
      .map((flat) => flat.task)
      .filter((task) => isAwaited(task, now))
      .sort((a, b) => a.due.localeCompare(b.due))
    if (!awaited.length) {
      this.showNotice(t('view.awaitedNone'))
      return
    }
    openTaskPicker(this, awaited, (task) => {
      const owner = scope?.projectOf(task.id)
      if (owner) openTaskModal(this, owner, { task, onSave: async () => {} })
    })
  }

  /** A project with no window of its own archives everything it has finished. */
  private async archiveCompletedTasks(): Promise<void> {
    const scoped = this.app.workspace.getActiveViewOfType(ProjectView)?.projectScope?.projects.map((p) => p.filePath)
    const plans = await this.autoArchiver.plan(scoped?.length ? scoped : this.index.projectPaths(), true)
    const tasks = plans.reduce((sum, plan) => sum + plan.tasks, 0)
    if (!tasks) {
      this.showNotice(t('flow.nothingToArchive'))
      return
    }
    const ok = await confirmDialog(
      this.app,
      t('flow.archiveConfirm', {
        tasks: t('count.tasks', { count: tasks }),
        projects: t('count.projects', { count: plans.length })
      }),
      t('common.archive')
    )
    if (!ok) return
    await this.autoArchiver.apply(plans)
    this.showNotice(t('flow.archivedTasks', { tasks: t('count.tasks', { count: tasks }) }))
  }

  /** The startup work that reads the index: migration, pruning, and the first due and archive sweeps. */
  private async startupSweep(): Promise<void> {
    await migrateProjects(this)
    await migrateProjectLayout(this)
    await this.idRepair.check()
    await this.cleanupStaleProjectFilters()
    this.notifier.check()
    await this.autoArchiver.check()
  }

  async cleanupStaleProjectFilters(): Promise<void> {
    const filters = this.settings.projectFilters
    const cleaned: typeof filters = {}
    let dirty = false
    for (const [key, entry] of Object.entries(filters)) {
      if (this.scopeKeyResolves(key)) {
        cleaned[key] = entry
      } else {
        dirty = true
      }
    }
    const cleanedScopeViews: typeof this.settings.scopeViews = {}
    for (const [key, views] of Object.entries(this.settings.scopeViews)) {
      if (this.scopeKeyResolves(key)) {
        cleanedScopeViews[key] = views
      } else {
        dirty = true
      }
    }
    const cleanedCollapsed: typeof this.settings.collapsedTasks = {}
    for (const [path, ids] of Object.entries(this.settings.collapsedTasks)) {
      if (this.app.vault.getAbstractFileByPath(path)) {
        cleanedCollapsed[path] = ids
      } else {
        dirty = true
      }
    }
    const collapsedProjects = this.settings.collapsedProjects.filter((path) =>
      this.app.vault.getAbstractFileByPath(path)
    )
    if (collapsedProjects.length !== this.settings.collapsedProjects.length) dirty = true
    if (dirty) {
      this.settings.projectFilters = cleaned
      this.settings.scopeViews = cleanedScopeViews
      this.settings.collapsedTasks = cleanedCollapsed
      this.settings.collapsedProjects = collapsedProjects
      await this.saveSettings()
    }
  }

  /** A project with no record yet keeps whatever legacy frontmatter said. */
  applyCollapsedState(project: Project): void {
    const ids = this.settings.collapsedTasks[project.filePath]
    if (!ids) return
    const set = new Set(ids)
    for (const { task } of flattenTasks(project.tasks)) {
      task.collapsed = set.has(task.id)
    }
  }

  /** Call after toggling task.collapsed. */
  async persistCollapsedState(project: Project): Promise<void> {
    this.settings.collapsedTasks[project.filePath] = flattenTasks(project.tasks)
      .filter((f) => f.task.collapsed)
      .map((f) => f.task.id)
    await this.saveSettings()
  }

  isProjectCollapsed(path: string): boolean {
    return this.settings.collapsedProjects.includes(path)
  }

  async toggleProjectCollapsed(path: string): Promise<void> {
    const collapsed = this.settings.collapsedProjects
    const at = collapsed.indexOf(path)
    if (at === -1) collapsed.push(path)
    else collapsed.splice(at, 1)
    await this.saveSettings()
  }

  /**
   * Folds a project heading inside one collection. Keyed by collection so the same
   * project can be open in one recueil and shut in another.
   */
  async toggleCollectionGroupCollapsed(collectionPath: string, projectPath: string): Promise<void> {
    const groups = this.settings.collapsedCollectionGroups
    const was = groups[collectionPath] ?? []
    const folded = was.includes(projectPath) ? was.filter((path) => path !== projectPath) : [...was, projectPath]
    // Rebuilt rather than assigned, so a collection nothing is folded in leaves no entry.
    this.settings.collapsedCollectionGroups = Object.fromEntries(
      Object.entries({ ...groups, [collectionPath]: folded }).filter(([, paths]) => paths.length > 0)
    )
    await this.saveSettings()
  }

  /** Resolves by id against the live tree, so it works when a view renders filtered clones. */
  async toggleTaskCollapsed(project: Project, taskId: string): Promise<void> {
    const task = findTask(project.tasks, taskId)
    if (!task) return
    task.collapsed = !task.collapsed
    await this.persistCollapsedState(project)
  }

  async saveSettings(): Promise<void> {
    // The language setting can change here, and everything already on screen was
    // built with the old one.
    setLocale(this.settings.language)
    await this.saveData(this.settings)
  }

  showNotice(msg: string, duration = 3000): void {
    new Notice(msg, duration)
  }

  /**
   * A settings edit changed a palette or how a view draws itself. Nothing in the vault
   * moved, so the store's own change events say nothing about it. Coalesced, because a
   * list editor persists on every keystroke.
   */
  refreshViews(): void {
    if (this.viewRefreshScheduled) return
    this.viewRefreshScheduled = true
    window.setTimeout(() => {
      this.viewRefreshScheduled = false
      for (const leaf of this.app.workspace.getLeavesOfType(PM_PROJECT_VIEW_TYPE)) {
        if (leaf.view instanceof ProjectView) leaf.view.redraw()
      }
      for (const leaf of this.app.workspace.getLeavesOfType(PM_DASHBOARD_VIEW_TYPE)) {
        if (leaf.view instanceof DashboardView) leaf.view.render()
      }
    }, 0)
  }

  /**
   * Offers every project in the vault, loading only the one chosen. `autoSelectSingle`
   * skips a picker that would have exactly one entry.
   */
  private pickProject(onChoose: (project: Project) => void, autoSelectSingle: boolean): void {
    const refs = this.index.projectRefs()
    if (!refs.length) {
      this.showNotice(this.index.ready ? t('flow.noProjectsYet') : t('flow.stillLooking'))
      return
    }
    const choose = (ref: ProjectRef): void => {
      void (async () => {
        const project = await this.store.loadProjectByPath(ref.path)
        if (!project) {
          this.showNotice(t('flow.couldNotOpen', { title: ref.title }))
          return
        }
        onChoose(project)
      })()
    }
    if (autoSelectSingle && refs.length === 1) choose(refs[0])
    else openProjectPicker(this, refs, choose)
  }

  /**
   * Rewrites plain-text assignees and members as links to the notes of the same name, so
   * existing vaults get the graph edges without retyping every task. Names matching no note,
   * or more than one, are left alone and reported.
   */
  private async linkPeopleToNotes(): Promise<void> {
    const plain: string[] = []
    for (const ref of this.index.allTaskRefs()) plain.push(...ref.assignees)
    for (const ref of this.index.projectRefs()) plain.push(...ref.teamMembers)
    const names = dedupePeople(plain.filter((value) => !value.trim().startsWith('[[')))
    if (names.length === 0) {
      this.showNotice(t('flow.allLinked'))
      return
    }

    const matches = matchPersonNotes(this.app, this.settings.peopleFolder, names)
    const linkable = matches.filter((match) => match.link !== null)
    const ambiguous = matches.filter((match) => match.ambiguous)
    if (linkable.length === 0) {
      this.showNotice(t('flow.noNoteMatches', { names: t('count.names', { count: names.length }) }))
      return
    }

    const linkFor = new Map<string, string>()
    for (const match of linkable) if (match.link) linkFor.set(match.name.trim().toLowerCase(), match.link)
    const mapValue = (value: string): string =>
      value.trim().startsWith('[[') ? value : (linkFor.get(value.trim().toLowerCase()) ?? value)

    const preview = linkable
      .slice(0, 5)
      .map((match) => match.name)
      .join(', ')
    const extra = linkable.length > 5 ? t('flow.linkMore', { count: linkable.length - 5 }) : ''
    const warn = ambiguous.length ? t('flow.linkAmbiguous', { count: ambiguous.length }) : ''
    const ok = await confirmDialog(
      this.app,
      t('flow.linkConfirm', {
        names: t('count.names', { count: linkable.length }),
        preview,
        extra,
        warn
      }),
      t('flow.linkAction')
    )
    if (!ok) return

    let tasksChanged = 0
    let projectsChanged = 0
    const byProject = new Map<string, string[]>()
    for (const ref of this.index.allTaskRefs()) {
      if (!ref.projectPath) continue
      if (!ref.assignees.some((value) => linkFor.has(value.trim().toLowerCase()))) continue
      const bucket = byProject.get(ref.projectPath)
      if (bucket) bucket.push(ref.id)
      else byProject.set(ref.projectPath, [ref.id])
    }

    for (const [path, taskIds] of byProject) {
      const project = await this.store.loadProjectByPath(path)
      if (!project) continue
      await this.store.updateTasks(project, taskIds, (task) => ({ assignees: task.assignees.map(mapValue) }))
      tasksChanged += taskIds.length
    }

    for (const ref of this.index.projectRefs()) {
      if (!ref.teamMembers.some((value) => linkFor.has(value.trim().toLowerCase()))) continue
      const project = await this.store.loadProjectByPath(ref.path)
      if (!project) continue
      await this.store.updateProject(project, { teamMembers: project.teamMembers.map(mapValue) })
      projectsChanged++
    }

    this.refreshViews()
    this.showNotice(
      t('flow.linked', {
        tasks: t('count.tasks', { count: tasksChanged }),
        projects: t('count.projects', { count: projectsChanged })
      })
    )
  }

  /** Opens the whole vault filtered to one person, the way the assignee filter would. */
  private async showTasksForPerson(person: string): Promise<void> {
    const name = displayName(person)
    if (this.index.tasksForPerson(person).length === 0) {
      new Notice(t('notice.noTasksForPerson', { name }))
      return
    }
    this.settings.projectFilters[scopeKey({ kind: 'vault' })] = {
      filter: { ...makeDefaultFilter(), assignees: [person] },
      activeSavedViewId: null
    }
    await this.saveSettings()
    await this.router.openScope({ kind: 'vault' })
  }

  /** Picks a project, then a parent when creating a subtask, before opening the editor. */
  private pickProjectThenCreateTask(mode: null | 'pick-parent'): void {
    this.pickProject((project) => {
      if (mode === 'pick-parent') {
        const flat = flattenTasks(project.tasks)
        if (!flat.length) {
          this.showNotice(t('flow.noTasksInProject'))
          return
        }
        openTaskPicker(
          this,
          flat.map((f) => f.task),
          (parentTask) => {
            this.openTaskModalForProject(project, parentTask.id)
          }
        )
      } else {
        this.openTaskModalForProject(project, null)
      }
    }, false)
  }

  private openTaskModalForProject(project: Project, parentId: string | null, defaults?: Partial<Task>): void {
    openTaskModal(this, project, {
      parentId,
      defaults,
      onSave: async () => {
        await this.store.saveProject(project)
        await this.router.openProjectByPath(project.filePath)
      }
    })
  }

  /** Open the task modal pre-filled from selected text, targeting a chosen project. */
  private createTaskFromText(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return

    const newlineIdx = trimmed.indexOf('\n')
    const defaults: Partial<Task> =
      newlineIdx === -1
        ? { title: trimmed }
        : { title: trimmed.slice(0, newlineIdx).trim(), description: trimmed.slice(newlineIdx + 1).trim() }

    this.pickProject((project) => {
      this.openTaskModalForProject(project, null, defaults)
    }, true)
  }

  private importNotes(): void {
    const activeLeaves = this.app.workspace.getLeavesOfType(PM_PROJECT_VIEW_TYPE)
    let activeProject: Project | null = null

    for (const leaf of activeLeaves) {
      if (!(leaf.view instanceof ProjectView)) continue
      if (leaf.view.project) {
        activeProject = leaf.view.project
        break
      }
    }

    if (activeProject) {
      const project = activeProject
      const onImportComplete = async () => {
        await this.router.openProjectByPath(project.filePath)
      }
      openImportModal(this, activeProject, onImportComplete)
      return
    }

    this.pickProject((project) => {
      const onImportComplete = async () => {
        await this.router.openProjectByPath(project.filePath)
      }
      openImportModal(this, project, onImportComplete)
    }, false)
  }
}
