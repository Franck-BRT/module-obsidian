import { ZoneRadar } from './store/ZoneRadar'
import { MarkdownView, Menu, normalizePath, Plugin, Notice, TFile, TFolder } from 'obsidian'
import type { Editor, TAbstractFile } from 'obsidian'
import {
  DEFAULT_SETTINGS,
  makeDefaultFilter,
  PALETTE_RESTEPS,
  seedDocStates,
  seedPriorities,
  seedStatuses,
  seedMeetingKinds,
  seedReqStatuses,
  seedReqTypes,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_LLM_SETTINGS,
  DEFAULT_RAG_SETTINGS,
  DEFAULT_REQUIREMENT_SETTINGS,
  seedTypes,
  withMissingTypes,
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
import { dedupePeople, displayName, safeAsync, sanitizeFileName } from './utils'
import { today } from './dates'
import { setLocale, t } from './i18n'
import { setImpactLookup, setTicketAppearance } from './store/TicketPalette'
import { pickMessageForTicket, registerMessageFileMenu } from './views/messageToTicket'
import { MessageView, PM_MESSAGE_VIEW_TYPE } from './views/MessageView'
import { RequirementsView, PM_REQUIREMENTS_VIEW_TYPE } from './views/requirements/RequirementsView'
import { ChatView, PM_CHAT_VIEW_TYPE } from './views/chat/ChatView'
import { ChatNotes } from './store/chat/ChatNotes'
import { isChatNote } from './store/chat/chatNote'
import { RequirementStore } from './store/requirements/RequirementStore'
import { RequirementTranslator } from './store/requirements/RequirementTranslator'
import { ReqUsageIndex } from './store/requirements/ReqUsage'
import { BaselineStore } from './store/requirements/BaselineStore'
import { ReqPorter } from './store/requirements/ReqPorter'
import { ReqEmbeddingIndex } from './store/requirements/ReqEmbeddings'
import { cleanBlockFields } from './store/requirements/reqBlockFields'
import { registerReqBlock } from './views/requirements/reqBlockRenderer'
import { registerChangeBlock } from './views/chat/changeCard'
import { registerBranchBlock } from './views/chat/branchGraph'
import { registerNoteBlock } from './views/chat/noteCard'
import { DocumentsView, PM_DOCUMENTS_VIEW_TYPE } from './views/documents/DocumentsView'
import { NotesView, PM_NOTES_VIEW_TYPE } from './views/notes/NotesView'
import { NoteLibrary } from './store/notes/NoteLibrary'
import {
  chooseProjects,
  type ChooserAnswer,
  type ChooserRequest,
  type ProjectOption
} from './views/documents/ProjectChooser'
import { DocLibrary, type PourItem } from './store/library/DocLibrary'
import { DocTextIndex, folderShelf } from './store/library/DocTextIndex'
import type { LibraryDoc } from './store/library/libraryDoc'
import { guessCategory, knownValues, parseCategories, type Category } from './store/library/libraryClass'
import { askClassification, GUESS_CATEGORY, type ClassifyChoices } from './views/documents/classifyFields'
import { proposeRegisterMatches } from './views/documents/matchRegister'
import { followMoves } from './store/library/fileInRegister'
import { adapterStorage, RagIndex } from './store/rag/RagIndex'
import { RagIndexer } from './store/rag/RagIndexer'
import { excludedFolders, vaultSources } from './store/rag/ragSources'
import { pourRegisterFiles } from './views/documents/pourRegisters'
import { skillNote } from './store/chat/skills'
import { freePath } from './store/DocumentStore'
import { ensureFolder } from './store/vaultFs'
import { keptTranscript, scanPages, transcribeScan } from './views/chat/scanReader'
import { LlmClient } from './store/llm/client'
import { chatModel } from './store/chat/chatModels'
import { noteExportLabel, registerReqEditorMenu } from './views/requirements/reqEditorMenu'
import { exportNoteDocx } from './views/requirements/exportDocx'
import { reqBlockRanges } from './store/requirements/reqFence'
import { pickRequirement } from './views/requirements/RequirementPicker'
import { insertRequirement } from './views/requirements/insertReq'

export default class PMPlugin extends Plugin {
  settings: PMSettings = { ...DEFAULT_SETTINGS }
  store!: TaskSource
  collections!: CollectionStore
  /** The requirements library: written once, cited everywhere. */
  requirements!: RequirementStore
  /** Drafts translations with the gateway, when one is configured. */
  translator!: RequirementTranslator
  /** Which documents quote which requirements, read from the notes and remembered. */
  reqUsage!: ReqUsageIndex
  /** The library as it stood on the days somebody signed for it. */
  baselines!: BaselineStore
  /** Hands the library out, and takes it back. */
  porter!: ReqPorter
  /** Vectors for the library, asked for once and kept. */
  reqVectors!: ReqEmbeddingIndex
  documents!: DocumentStore
  /** Every document poured into the library, whatever project it belongs to. */
  library!: DocLibrary
  /** What the library's documents say, read once and kept, for searching. */
  libraryText!: DocTextIndex
  /** The notes of no project yet, and the inbox new notes land in. */
  notes!: NoteLibrary
  /** The vault's passages and their embeddings, for the chat's search of the whole vault. */
  ragIndex!: RagIndex
  /** Keeps the vault index following the vault. */
  ragIndexer!: RagIndexer
  index!: VaultIndex
  notifier!: Notifier
  autoArchiver!: AutoArchiver
  idRepair!: IdRepair
  router!: PMViewRouter
  /** The vault's zone crossings, recomputed when the index changes. */
  radar!: ZoneRadar
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
    this.radar = new ZoneRadar(this)
    setImpactLookup(this.radar)
    // Every note the index re-reads can have moved a date, a zone or a status, any of
    // which changes which projects cross. `register` below only reports the first resolve,
    // so the standing subscription is what keeps the crossings from going stale.
    this.register(this.index.onChange(() => this.radar.invalidate()))
    // The first sweep can run against a half-filled metadata cache, so it runs again once
    // the index has caught up. Everything in it is safe to repeat.
    this.index.register(this, () => {
      this.radar.invalidate()
      void this.startupSweep()
    })
    this.store = new ProjectStore(this.app, () => this.settings, this.index)
    this.collections = new CollectionStore(this.app, this.index)
    this.documents = new DocumentStore(this.app)
    this.library = new DocLibrary(
      this.app,
      () => this.settings.libraryFolder.trim() || 'Library',
      () => ({ filesFolder: '_files', notesHeading: t('library.notesHeading') }),
      (path) => this.index.projectRef(path)?.title ?? path.replace(/^.*\//, '').replace(/\.md$/, '')
    )
    this.notes = new NoteLibrary(
      this.app,
      () => this.settings.notesFolder.trim() || 'Notes',
      (path) => this.index.projectRef(path)?.title ?? path.replace(/^.*\//, '').replace(/\.md$/, '')
    )
    this.libraryText = new DocTextIndex(
      this.app,
      folderShelf(this.app, () => `${this.library.root}/.text`),
      {
        words: () => ({
          from: t('email.from'),
          to: t('email.to'),
          date: t('email.date'),
          attachments: t('library.mailAttachments')
        }),
        kept: (file) => keptTranscript(this.app, file)
      }
    )
    this.ragIndex = new RagIndex(adapterStorage(this.app, '.pm-rag'))
    this.ragIndexer = new RagIndexer(this.ragIndex, {
      sources: () =>
        vaultSources({
          app: this.app,
          library: this.library,
          texts: this.libraryText,
          excluded: excludedFolders(this.settings.rag.exclude),
          words: {
            category: t('rag.category'),
            lot: t('rag.lot'),
            issuer: t('rag.issuer'),
            tags: t('rag.tags')
          },
          ...(this.settings.rag.files
            ? {
                files: {
                  mail: {
                    from: t('email.from'),
                    to: t('email.to'),
                    date: t('email.date'),
                    attachments: t('library.mailAttachments')
                  }
                }
              }
            : {})
        }),
      embed: (texts) => new LlmClient({ settings: this.settings.llm }).embed(texts, this.settings.llm.modelEmbed),
      model: () =>
        this.settings.llm.enabled && this.settings.llm.baseUrl.trim() ? this.settings.llm.modelEmbed.trim() : '',
      enabled: () => this.settings.rag.enabled,
      prepare: async () => {
        // What the documents say, as far as it has been read; what never was is read
        // meanwhile, and indexed once it is — asked only then, since a reading done says
        // so, and that would start the indexing again for nothing.
        const docs = this.library.docs()
        await this.libraryText.load(docs)
        if (docs.some((doc) => doc.file && doc.hash && !this.libraryText.entry(doc))) {
          void this.libraryText.refresh(docs)
        }
      }
    })
    this.requirements = new RequirementStore(
      this.app,
      () => this.settings.requirements,
      () => this.saveSettings(),
      this.index
    )
    this.translator = new RequirementTranslator(() => this.settings, this.requirements)
    this.reqUsage = new ReqUsageIndex(this.app, () => this.index.requirementRefs())
    this.baselines = new BaselineStore(this.app, () => this.settings.requirements.folder)
    this.porter = new ReqPorter(this.app, this.requirements, this.index, () => this.settings.requirements.folder)
    this.reqVectors = new ReqEmbeddingIndex(this.app, () => this.settings)
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
    this.registerView(PM_MESSAGE_VIEW_TYPE, (leaf) => new MessageView(leaf, this))
    this.registerView(PM_REQUIREMENTS_VIEW_TYPE, (leaf) => new RequirementsView(leaf, this))
    this.registerView(PM_CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this))
    this.registerView(PM_DOCUMENTS_VIEW_TYPE, (leaf) => new DocumentsView(leaf, this))
    this.registerView(PM_NOTES_VIEW_TYPE, (leaf) => new NotesView(leaf, this))
    // Claiming the extension is what stops a click handing the message back to Outlook.
    this.registerExtensions(['msg', 'eml'], PM_MESSAGE_VIEW_TYPE)
    this.registerTaskNoteSwap()
    registerReqBlock(this)
    registerChangeBlock(this)
    registerBranchBlock(this)
    registerNoteBlock(this)
    registerReqEditorMenu(this)
    if (__STYLEGUIDE__) registerStyleguide(this)

    this.app.workspace.onLayoutReady(
      safeAsync(async () => {
        this.index.build()
        await this.startupSweep()
        this.watchVaultIndex()
      })
    )

    this.addRibbonIcon('chart-gantt', t('ribbon.title'), async () => {
      await this.router.openDashboard()
    })

    this.addCommand({
      id: 'chat-branches',
      name: t('command.chatBranches'),
      callback: safeAsync(async () => {
        await this.openChat()
        const view = this.app.workspace.getLeavesOfType(PM_CHAT_VIEW_TYPE)[0]?.view
        if (!(view instanceof ChatView) || !(await view.showBranches())) new Notice(t('chat.branchesNone'))
      })
    })

    // A conversation branched before its note could draw them gets the block when opened.
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (!file || !isChatNote(this.app.metadataCache.getFileCache(file)?.frontmatter)) return
        new ChatNotes(this.app, () => this.settings.chat.folder).ensureBranchBlock(file).catch(() => undefined)
      })
    )

    this.addCommand({
      id: 'open-chat',
      name: t('command.openChat'),
      callback: () => {
        void this.openChat()
      }
    })

    this.addCommand({
      id: 'open-projects',
      name: t('command.openProjects'),
      callback: () => {
        void this.router.openDashboard()
      }
    })

    this.addCommand({
      id: 'message-to-ticket',
      name: t('email.toTicket'),
      callback: safeAsync(() => pickMessageForTicket(this))
    })

    this.addCommand({
      id: 'open-requirements',
      name: t('req.libraryTitle'),
      callback: () => {
        void this.openRequirements()
      }
    })

    this.addCommand({
      id: 'insert-requirement',
      name: t('req.insert'),
      editorCallback: (editor: Editor) => {
        void this.insertRequirementAt(editor)
      }
    })

    for (const format of ['docx', 'pdf', 'md', 'html'] as const) {
      this.addCommand({
        id: `export-note-${format}`,
        name: noteExportLabel(format),
        callback: safeAsync(async () => {
          const file = this.app.workspace.getActiveFile()
          if (!file) return
          const content = await this.app.vault.cachedRead(file)
          // Said rather than written: a document holding the note's prose and none of its
          // requirements is not what the command was asked for.
          if (!reqBlockRanges(content.split('\n')).length) {
            new Notice(t('req.exportNoteNone'))
            return
          }
          await exportNoteDocx(this, file, format)
        })
      })
    }

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

    // In every mode: the editor's selection while editing, the page's while reading.
    this.addCommand({
      id: 'ask-chat-selection',
      name: t('command.askChat'),
      checkCallback: (checking: boolean) => {
        const picked = this.selectionInView()
        if (!picked) return false
        if (checking) return true
        void this.chatAboutSelection(picked.text, picked.path)
        return true
      }
    })

    this.addCommand({
      id: 'open-documents',
      name: t('command.openDocuments'),
      callback: () => {
        void this.openDocuments()
      }
    })

    this.addCommand({
      id: 'open-notes',
      name: t('command.openNotes'),
      callback: () => {
        void this.openNotes()
      }
    })
    this.addCommand({
      id: 'new-inbox-note',
      name: t('command.newInboxNote'),
      callback: () => {
        void this.newInboxNote()
      }
    })

    this.addCommand({
      id: 'new-skill',
      name: t('command.newSkill'),
      callback: () => {
        void this.newSkill()
      }
    })
    this.addCommand({
      id: 'example-skills',
      name: t('command.exampleSkills'),
      callback: () => {
        void this.createExampleSkills()
      }
    })

    this.addCommand({
      id: 'pour-registers',
      name: t('command.pourRegisters'),
      callback: () => {
        void pourRegisterFiles(this)
      }
    })

    // A file or a folder in the vault, poured in from its menu: a folder with every file
    // it holds, however deep.
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && !this.library.pourable(file)) return
        menu.addItem((item) =>
          item
            .setTitle(t('library.pourMenu'))
            .setIcon('library-big')
            .onClick(safeAsync(() => this.pourVaultFiles([file])))
        )
      })
    )
    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        menu.addItem((item) =>
          item
            .setTitle(t('library.pourMenu'))
            .setIcon('library-big')
            .onClick(safeAsync(() => this.pourVaultFiles(files)))
        )
      })
    )

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, context) => {
        const selection = editor.getSelection()
        if (!selection.trim()) return
        this.addSelectionItems(menu, selection, context.file?.path ?? '')
      })
    )

    // Reading view has no menu of its own to add to: a right-click on a passage selected
    // there gets one, with the same entries and a way to copy it.
    this.registerDomEvent(activeDocument, 'contextmenu', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.closest('.markdown-reading-view')) return
      const picked = this.selectionInView()
      if (!picked) return
      event.preventDefault()
      const menu = new Menu()
      menu.addItem((item) =>
        item
          .setTitle(t('chat.copySelection'))
          .setIcon('copy')
          .onClick(safeAsync(() => navigator.clipboard.writeText(picked.text)))
      )
      this.addSelectionItems(menu, picked.text, picked.path)
      menu.showAtMouseEvent(event)
    })

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

  /**
   * The vault index kept up with the vault: brought up to date a moment after start-up,
   * then after each change settles; how far it has got said in the status bar while it
   * works, and why it stopped when it could not go on.
   */
  private watchVaultIndex(): void {
    const later = (): void => this.ragIndexer.schedule(8000)
    this.registerEvent(this.app.vault.on('modify', later))
    this.registerEvent(this.app.vault.on('create', later))
    this.registerEvent(this.app.vault.on('delete', later))
    this.registerEvent(this.app.vault.on('rename', later))
    this.register(this.libraryText.onChange(later))
    const status = this.addStatusBarItem()
    status.addClass('pm-rag-status')
    const show = (): void => {
      const state = this.ragIndexer.state
      status.empty()
      status.toggleClass('is-hidden', !state.running && !state.error)
      if (state.running) {
        status.setText(
          state.progress && state.progress.total
            ? t('rag.statusRunning', { done: state.progress.done, total: state.progress.total })
            : t('rag.statusStarting')
        )
        status.setAttr('aria-label', t('rag.statusRunningDesc'))
      } else if (state.error) {
        status.setText(t('rag.statusError'))
        status.setAttr('aria-label', state.error)
      }
    }
    this.register(this.ragIndexer.onChange(show))
    show()
    this.ragIndexer.schedule(15000)
  }

  onunload(): void {
    this.ragIndexer?.dispose()
    setImpactLookup(null)
    this.notifier.stop()
  }

  /** Opens a task note in Obsidian's own editor, where the swap leaves it alone. */
  async openAsMarkdown(path: string): Promise<void> {
    this.markdownEscapes.add(path)
    await this.app.workspace.openLinkText(path, '', true)
  }

  private registerTaskNoteSwap(): void {
    const swap = (): void => this.swapTaskNotes()
    registerMessageFileMenu(this)
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
    // A vault that predates the counter has had only what its old flag says it had.
    if (saved && saved.paletteRestep === undefined) {
      const flagged = (saved as { paletteRestepped?: boolean }).paletteRestepped
      this.settings.paletteRestep = flagged ? 1 : 0
    }
    // Before anything reads a string: the palettes seeded just below are localized.
    setLocale(this.settings.language)
    if (!saved?.statuses?.length) this.settings.statuses = seedStatuses()
    if (!saved?.priorities?.length) this.settings.priorities = seedPriorities()
    // A palette saved before a kind of ticket existed keeps everything the reader chose
    // and gains an entry for what it is missing, so every kind stays recolourable.
    this.settings.types = saved?.types?.length ? withMissingTypes(this.settings.types, seedTypes()) : seedTypes()
    if (!saved?.docStates?.length) this.settings.docStates = seedDocStates()
    if (!saved?.meetingKinds?.length) this.settings.meetingKinds = seedMeetingKinds()
    // Merged field by field rather than taken whole: the assign above is shallow, so a
    // settings file written before a field of this group existed would otherwise arrive
    // without it and with no default behind it.
    this.settings.requirements = { ...DEFAULT_REQUIREMENT_SETTINGS, ...saved?.requirements }
    this.settings.chat = { ...DEFAULT_CHAT_SETTINGS, ...saved?.chat }
    this.settings.llm = { ...DEFAULT_LLM_SETTINGS, ...saved?.llm }
    this.settings.rag = { ...DEFAULT_RAG_SETTINGS, ...saved?.rag }
    if (!saved?.requirements?.types?.length) this.settings.requirements.types = seedReqTypes()
    if (!saved?.requirements?.statuses?.length) this.settings.requirements.statuses = seedReqStatuses()
    if (!this.settings.requirements.counters) this.settings.requirements.counters = {}
    // A vault that predates the target has no opinion about it, and zero is not one.
    if (!this.settings.requirements.reviewTarget) this.settings.requirements.reviewTarget = 80
    if (!this.settings.requirements.reviewProposals) this.settings.requirements.reviewProposals = 3
    for (const key of ['reviewPrompt', 'checkPrompt', 'translatePrompt'] as const) {
      if (typeof this.settings.requirements[key] !== 'string') this.settings.requirements[key] = ''
    }
    // Normalized once, on the way in: a hand-edited data.json or a list written by an
    // older build can name a column this one has never heard of, and the settings page
    // would then be editing something it cannot draw.
    this.settings.requirements.blockFields = cleanBlockFields(this.settings.requirements.blockFields)
    if (!this.settings.projectFilters) this.settings.projectFilters = {}
    if (!this.settings.scopeViews) this.settings.scopeViews = {}
    if (!this.settings.collapsedTasks) this.settings.collapsedTasks = {}
    if (!this.settings.collapsedProjects) this.settings.collapsedProjects = []
    if (!this.settings.collapsedRequirements) this.settings.collapsedRequirements = []
    if (!this.settings.excludedFolders) this.settings.excludedFolders = []
    this.applyTicketAppearance()

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

    // Palette corrections the vault has not had yet, in order and once each.
    if (this.settings.paletteRestep < PALETTE_RESTEPS.length) {
      for (const restep of PALETTE_RESTEPS.slice(this.settings.paletteRestep)) {
        restepPalette(this.settings.statuses, restep)
        restepPalette(this.settings.priorities, restep)
      }
      // Written back even when nothing moved, so the passes are spent either way.
      this.settings.paletteRestep = PALETTE_RESTEPS.length
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
  /**
   * The requirements library, in a tab of its own.
   *
   * Reused rather than reopened: the library is a place, not a document, and a reader
   * who opens it from three different buttons should end up looking at the one they
   * already had open.
   */
  /**
   * Quotes a requirement where the author is writing.
   *
   * Into the block the cursor is already in when there is one, because quoting happens in
   * runs: a paragraph of prose, then three requirements, then more prose. Starting a
   * second block beside the first would be technically the same document and visibly a
   * mess.
   */
  async insertRequirementAt(editor: Editor): Promise<void> {
    const library = this.index.requirementRefs()
    if (!library.length) {
      new Notice(t('req.empty'))
      return
    }
    const chosen = await pickRequirement(this.app, library)
    if (!chosen) return
    const cursor = editor.getCursor()
    const insertion = insertRequirement(editor.getValue().split('\n'), cursor.line, chosen.id)
    if (!insertion) {
      new Notice(t('req.alreadyQuoted', { id: chosen.id }))
      return
    }
    editor.replaceRange(insertion.insert, insertion.at)
  }

  async openRequirements(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PM_REQUIREMENTS_VIEW_TYPE)[0]
    const leaf = existing ?? this.app.workspace.getLeaf('tab')
    if (!existing) await leaf.setViewState({ type: PM_REQUIREMENTS_VIEW_TYPE, state: {} })
    await this.app.workspace.revealLeaf(leaf)
  }

  /**
   * The chat, in the right-hand sidebar: a conversation is had beside the note or the
   * project it is about, not instead of it. One panel, found again if it is already open.
   */
  async openChat(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PM_CHAT_VIEW_TYPE)[0]
    const leaf = existing ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf('tab')
    if (!existing) await leaf.setViewState({ type: PM_CHAT_VIEW_TYPE, active: true })
    await this.app.workspace.revealLeaf(leaf)
  }

  /**
   * The document library, in a tab of its own: found again if it is open, and narrowed to
   * one project when opened from it.
   */
  async openDocuments(project = ''): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PM_DOCUMENTS_VIEW_TYPE)[0]
    const leaf = existing ?? this.app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: PM_DOCUMENTS_VIEW_TYPE, state: { project }, active: true })
    await this.app.workspace.revealLeaf(leaf)
  }

  /** The notes library, in a tab of its own, narrowed to one project when opened from it. */
  async openNotes(project = ''): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PM_NOTES_VIEW_TYPE)[0]
    const leaf = existing ?? this.app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: PM_NOTES_VIEW_TYPE, state: { project }, active: true })
    await this.app.workspace.revealLeaf(leaf)
  }

  /** A new note in the inbox — the notes library's folder, or one of its folders —, opened to be written. */
  async newInboxNote(subfolder = ''): Promise<void> {
    const file = await this.notes.create(t('notes.untitled'), '', subfolder)
    await this.app.workspace.getLeaf('tab').openFile(file)
  }

  /** The projects a document can belong to: programmes too, templates not. By title. */
  libraryProjects(): ProjectOption[] {
    return this.index
      .projectRefs()
      .filter((ref) => !ref.template)
      .map((ref) => ({ path: ref.path, title: ref.title, detail: ref.path.slice(0, ref.path.lastIndexOf('/')) }))
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))
  }

  /** The library's categories: the reader's list, or the one shipped when it is empty. */
  libraryCategories(): Category[] {
    return parseCategories(this.settings.libraryCategories.trim() || t('library.defaultCategories'))
  }

  /** What the fields a document is filed by offer: the categories, and what the library already holds. */
  libraryChoices(): ClassifyChoices {
    const docs = this.library.docs()
    const categories = this.libraryCategories().map((category) => category.name)
    for (const used of knownValues(docs, 'category')) if (!categories.includes(used)) categories.push(used)
    return {
      categories,
      lots: knownValues(docs, 'lot'),
      issuers: knownValues(docs, 'issuer'),
      tags: knownValues(docs, 'tags')
    }
  }

  /**
   * Files documents: one as its fields are to be edited, several at once where an empty
   * field leaves each one's own alone and tags are added.
   */
  async classifyDocuments(docs: LibraryDoc[]): Promise<void> {
    if (!docs.length) return
    const one = docs.length === 1 ? docs[0] : null
    const given = await askClassification(
      this.app,
      one ? t('library.classifyOne', { title: one.title }) : t('library.classifySeveral', { count: docs.length }),
      this.libraryChoices(),
      one
        ? { category: one.category, lot: one.lot, issuer: one.issuer, tags: one.tags }
        : { category: '', lot: '', issuer: '', tags: [] },
      !one
    )
    if (!given) return
    if (one) {
      await this.library.setClassification(one, given)
      return
    }
    // Asked to guess: each one without a category gets the one its name suggests.
    const categories = this.libraryCategories()
    for (const doc of docs) {
      const category =
        given.category === GUESS_CATEGORY
          ? doc.category || guessCategory(`${doc.title} ${doc.file.slice(doc.file.lastIndexOf('/') + 1)}`, categories)
          : given.category
      await this.library.classify(doc, { ...given, category })
    }
  }

  askLibraryProjects(request: Omit<ChooserRequest, 'projects'>): Promise<ChooserAnswer | null> {
    return chooseProjects(this.app, { ...request, projects: this.libraryProjects() })
  }

  /**
   * Pours documents into the library once the reader has said which projects they belong
   * to, telling how far it has got on a long pour and what came of it at the end.
   */
  async pourIntoLibrary(items: PourItem[], preset: string[] = [], folder = ''): Promise<void> {
    if (!items.length) return
    const inVault = items.some((item) => item.kind === 'vault' && this.library.movable(item.file))
    const answer = await this.askLibraryProjects({
      heading: folder
        ? t('library.pourTitleIn', { count: items.length, folder })
        : t('library.pourTitle', { count: items.length }),
      names: items.map((item) => (item.kind === 'vault' ? item.file.path : item.name)),
      chosen: preset,
      offerMove: inVault,
      classify: this.libraryChoices(),
      confirm: t('library.pourConfirm')
    })
    if (!answer) return
    const progress = items.length > 3 ? new Notice(t('library.pouring', { done: 0, total: items.length }), 0) : null
    const report = await this.library.pour(
      items,
      {
        projects: answer.projects,
        move: answer.move,
        today: today().toString(),
        classification: answer.classification,
        categories: this.libraryCategories(),
        folder
      },
      (done, total) => progress?.setMessage(t('library.pouring', { done, total }))
    )
    progress?.hide()
    const parts = [t('library.poured', { count: report.added.length })]
    if (report.known.length) parts.push(t('library.alreadyThere', { count: report.known.length }))
    if (report.failed.length) {
      parts.push(
        t('library.pourFailed', {
          list: report.failed.map((failure) => `${failure.name} (${failure.reason})`).join(', ')
        })
      )
    }
    new Notice(parts.join('\n'), report.failed.length ? 0 : 6000)
    await this.openDocuments(answer.projects.length === 1 ? answer.projects[0] : '')
    // Read what they say, for searching; the library shows how far it has got.
    void this.libraryText.refresh(this.library.docs())
    // Those that look like documents a register is waiting for, offered to be filed as them.
    if (report.docs.length) await proposeRegisterMatches(this, report.docs, false)
  }

  /**
   * The projects' registers told where the library moved the files they follow; returns
   * how many tickets were told.
   */
  async followLibraryMoves(moves: Map<string, string>): Promise<number> {
    if (!moves.size) return 0
    const paths = this.index
      .projectRefs()
      .filter((ref) => !ref.template && !ref.program)
      .map((ref) => ref.path)
    return followMoves(this.store, await this.store.loadProjects(paths), moves)
  }

  /**
   * Scans read by the model that sees, one after another, so the library's search finds
   * what they say; false when no model is set up to read them.
   */
  async readLibraryScans(docs: LibraryDoc[]): Promise<boolean> {
    const llm = this.settings.llm
    const model = llm.modelOcr.trim() || chatModel(this.settings.chat.model, llm.modelText)
    if (!llm.enabled || !llm.baseUrl.trim() || !model) {
      new Notice(t('library.scanNoModel'), 10000)
      return false
    }
    const client = new LlmClient({ settings: llm })
    for (const doc of docs) {
      try {
        await this.libraryText.readScan(doc, async (file, bytes) => {
          const source = await scanPages(file, bytes)
          try {
            return (await transcribeScan(this.app, client, model, file, source)).text
          } finally {
            source.close()
          }
        })
      } catch (error) {
        new Notice(
          t('library.scanFailed', { title: doc.title, reason: error instanceof Error ? error.message : String(error) }),
          10000
        )
      }
    }
    return true
  }

  /** Files and folders of the vault, poured in: a folder brings every file it holds. */
  async pourVaultFiles(entries: TAbstractFile[]): Promise<void> {
    const files: TFile[] = []
    const collect = (entry: TAbstractFile): void => {
      if (entry instanceof TFolder) {
        for (const child of entry.children) collect(child)
      } else if (entry instanceof TFile && this.library.pourable(entry)) {
        files.push(entry)
      }
    }
    for (const entry of entries) collect(entry)
    const unique = [...new Map(files.map((file) => [file.path, file])).values()]
    if (!unique.length) {
      new Notice(t('library.nothingToPour'))
      return
    }
    await this.pourIntoLibrary(unique.map((file) => ({ kind: 'vault', file })))
  }

  /** Where new skills are written. */
  private skillsFolder(): string {
    return normalizePath(this.settings.chat.skillsFolder.trim() || `${this.settings.chat.folder}/Skills`)
  }

  /** A skill to write: a note with its properties and a model of instructions, opened. */
  async newSkill(): Promise<void> {
    const folder = this.skillsFolder()
    await ensureFolder(this.app, folder)
    const path = await freePath(this.app, folder, t('skill.newName'), 'md')
    const file = await this.app.vault.create(
      path,
      skillNote({
        name: t('skill.newName'),
        description: t('skill.newDescription'),
        triggers: [],
        folder: '',
        body: t('skill.newBody')
      })
    )
    await this.app.workspace.getLeaf('tab').openFile(file)
  }

  /** The skills the plugin ships as examples, written where they are not yet; says how many. */
  async createExampleSkills(): Promise<void> {
    const folder = this.skillsFolder()
    await ensureFolder(this.app, folder)
    let written = 0
    for (const key of ['minutes', 'summary', 'decision', 'log'] as const) {
      const name = t(`skill.example.${key}.name`)
      const path = normalizePath(`${folder}/${sanitizeFileName(name)}.md`)
      if (this.app.vault.getAbstractFileByPath(path)) continue
      await this.app.vault.create(
        path,
        skillNote({
          name,
          description: t(`skill.example.${key}.description`),
          triggers: t(`skill.example.${key}.triggers`)
            .split(',')
            .map((word) => word.trim())
            .filter(Boolean),
          folder: '',
          body: t(`skill.example.${key}.body`)
        })
      )
      written++
    }
    new Notice(written ? t('skill.examplesWritten', { count: written, folder }) : t('skill.examplesThere', { folder }))
  }

  /** The chat, opened on requirements chosen in the library. */
  async chatAbout(ids: string[]): Promise<void> {
    await this.openChat()
    const view = this.app.workspace.getLeavesOfType(PM_CHAT_VIEW_TYPE)[0]?.view
    if (view instanceof ChatView) view.attachRequirements(ids)
  }

  /** The chat, opened on a project: its tickets go with every question until taken off. */
  async chatAboutProject(path: string): Promise<void> {
    await this.openChat()
    const view = this.app.workspace.getLeavesOfType(PM_CHAT_VIEW_TYPE)[0]?.view
    if (view instanceof ChatView) view.attachProject(path)
  }

  /** The chat, opened on documents chosen in the library: they go with the next questions. */
  async chatAboutDocuments(paths: string[]): Promise<void> {
    if (!paths.length) return
    await this.openChat()
    const view = this.app.workspace.getLeavesOfType(PM_CHAT_VIEW_TYPE)[0]?.view
    if (view instanceof ChatView) view.attachFiles(paths)
  }

  /** The chat, opened on a branch of a saved conversation, picked in its note. */
  async chatOnBranch(path: string, index: number): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return
    await this.openChat()
    const view = this.app.workspace.getLeavesOfType(PM_CHAT_VIEW_TYPE)[0]?.view
    if (view instanceof ChatView) await view.goToBranch(file, index)
  }

  /** What a passage selected in a note can be taken to: the chat, or a new task. */
  private addSelectionItems(menu: Menu, selection: string, path: string): void {
    menu.addItem((item) =>
      item
        .setTitle(t('chat.askMenu'))
        .setIcon('messages-square')
        .onClick(safeAsync(() => this.chatAboutSelection(selection, path)))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('command.taskFromSelection'))
        .setIcon('list-plus')
        .onClick(() => this.createTaskFromText(selection.trim()))
    )
  }

  /**
   * The passage selected in the note in front of the reader: the editor's while it is
   * being edited, the page's while it is read — and only when the selection is inside
   * that note, not in a panel beside it.
   */
  private selectionInView(): { text: string; path: string } | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView)
    const file = view?.file
    if (!view || !file) return null
    if (view.getMode() === 'source') {
      const text = view.editor.getSelection()
      return text.trim() ? { text, path: file.path } : null
    }
    const selection = activeWindow.getSelection()
    const text = selection?.toString() ?? ''
    const anchor = selection?.anchorNode
    if (!text.trim() || !anchor || !view.containerEl.contains(anchor)) return null
    return { text, path: file.path }
  }

  /** The chat, opened on a passage chosen in a note, for the next question. */
  async chatAboutSelection(text: string, path: string): Promise<void> {
    await this.openChat()
    const view = this.app.workspace.getLeavesOfType(PM_CHAT_VIEW_TYPE)[0]?.view
    if (view instanceof ChatView) view.attachSelection(text, path)
  }

  /** The chat, opened on a collection: its tickets go with every question until taken off. */
  async chatAboutCollection(path: string): Promise<void> {
    await this.openChat()
    const view = this.app.workspace.getLeavesOfType(PM_CHAT_VIEW_TYPE)[0]?.view
    if (view instanceof ChatView) view.attachCollection(path)
  }

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
   * project can be open in one collection and shut in another.
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
    this.applyTicketAppearance()
    // A zone renamed, added or deleted changes which crossings exist and what they read as.
    this.radar.invalidate()
    await this.saveData(this.settings)
  }

  /** Hands the row-and-card composites the marks they draw tickets with. */
  applyTicketAppearance(): void {
    setTicketAppearance({
      types: this.settings.types,
      docStates: this.settings.docStates,
      meetingKinds: this.settings.meetingKinds,
      badges: this.settings.typeBadges
    })
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
