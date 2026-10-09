// Renders one of the plugin's screens from the demonstration's data, as the page's
// query asks: ?screen=reserves&lang=fr. The screenshot script photographs the result.
import type { App } from 'obsidian'
import { Scope } from 'obsidian'
import { makeFakeApp } from '../../test/fakeVault'
import { setLocale } from '../../src/i18n'
import { DEFAULT_SETTINGS, makeDefaultFilter, makeTask, type PMSettings, type Task } from '../../src/types'
import { ProjectStore } from '../../src/store/ProjectStore'
import { ProjectScope } from '../../src/store/ProjectScope'
import { VaultIndex } from '../../src/store/VaultIndex'
import { DocLibrary } from '../../src/store/library/DocLibrary'
import { RequirementStore } from '../../src/store/requirements/RequirementStore'
import { flattenTasks } from '../../src/store/TaskTreeOps'
import { createDemo } from '../../src/views/demo/demo'
import { ReservesView } from '../../src/views/reserves/ReservesView'
import { BudgetView } from '../../src/views/budget/BudgetView'
import { GanttView } from '../../src/views/gantt/GanttView'
import { renderReservePanel } from '../../src/modals/ReservePanel'
import { ChangesView } from '../../src/views/changes/ChangesView'
import { BoardModal } from '../../src/views/changes/BoardModal'
import { emptyChange } from '../../src/store/change'
import { IcsExportModal } from '../../src/views/calendar/icsExport'
import { PlanningImportModal } from '../../src/views/planning/PlanningImportModal'
import { readMsProject } from '../../src/store/planning/msProject'
import { weeklyFacts } from '../../src/store/weekly/weeklyFacts'
import { weeklyNote } from '../../src/views/weekly/weeklyText'
import { projectMetrics } from '../../src/store/Metrics'
import { SAMPLE_MSPDI } from './sample'
import { CollectionsModal, DocPickModal } from '../../src/views/documents/collections'
import { chooseProjects } from '../../src/views/documents/ProjectChooser'
import { renderHome } from '../../src/views/home/homePage'
import { renderFlag } from '../../src/ui/flags'
import { PromptsView } from '../../src/views/prompts/PromptsView'
import { PromptModal } from '../../src/views/prompts/PromptModal'
import { PersonasView } from '../../src/views/personas/PersonasView'
import { createPersona } from '../../src/views/personas/personaVault'
import { starterPersonas } from '../../src/views/personas/starterPersonas'
import { DeliveryModal } from '../../src/views/library/DeliveryModal'
import { PersonPicker } from '../../src/views/contacts/PersonPicker'
import { DocumentSheet } from '../../src/views/documents/DocumentSheet'
import { renderFolderTree, renderFolderStrip } from '../../src/views/folderUi'
import { ContactBook, readContacts } from '../../src/store/contacts'
import { projectPeople } from '../../src/store/projectPeople'
import { isDocument } from '../../src/store/Document'
import { promptNoteContent } from '../../src/store/chat/promptLibrary'
import { ImplementationModal } from '../../src/views/changes/ImplementationModal'
import { ChangeModal } from '../../src/views/changes/ChangeModal'
import { ChangeLibrary } from '../../src/store/changeLibrary'
import { ReviseDocsModal, revisableDocs } from '../../src/views/changes/ReviseDocsModal'
import { ProjectDashboard } from '../../src/views/dashboard/ProjectDashboard'
import { refLink } from '../../src/store/refs'
import { rebuildTaskIndex } from '../../src/store/TaskIndex'

const query = new URLSearchParams(location.search)
const screen = query.get('screen') ?? 'reserves'

/** A few changes at every stage, for the change screens: written in the library, belonging to the project. */
async function sampleChanges(plugin: any, project: any, tune: (number: string, change: any) => void = () => {}): Promise<Task[]> {
  const other = plugin.settings.demo?.projects[1]
  const rows: [string, any, string[], string[]][] = [
    ['Remplacer le connecteur J12 par un modèle étanche', { number: 'DM-001', group: 1, origin: 'Thales', class: 'major', reason: 'Infiltrations constatées en essais climatiques', submittedOn: '2026-09-02', rounds: [{ round: 0, decision: 'accepted', date: '2026-09-10', comment: 'Lancer la PM' }, { round: 1, decision: 'accepted', date: '2026-09-24', comment: '' }] }, ['Anne Leroy'], other ? [other] : []],
    ['Ajouter un capteur de température sur la carte alimentation', { number: 'DM-002', group: 2, origin: 'CNES', class: 'minor', reason: 'Besoin de télémesure', submittedOn: '2026-09-15', rounds: [{ round: 0, decision: 'accepted', date: '2026-08-26', comment: 'PM attendue pour la prochaine CLM' }] }, ['Paul Martin'], []],
    ['Modifier la séquence de mise sous tension', { number: 'DM-003', group: 1, origin: 'Airbus DS', class: 'major', reason: 'Appel de courant trop élevé', submittedOn: '2026-10-01' }, [], []],
    ['Changer la référence du joint torique', { number: 'DM-004', group: 3, origin: 'Sous-traitant mécanique', reason: 'Obsolescence fournisseur' }, [], []],
    ['Mettre à jour le plan d’interface mécanique', { number: 'DM-005', group: 2, origin: 'CNES', submittedOn: '2026-08-01', rounds: [{ round: 0, decision: 'accepted', date: '2026-08-05', comment: '' }, { round: 1, decision: 'accepted', date: '2026-08-20', comment: '' }, { round: 2, decision: 'accepted', date: '2026-10-06', comment: 'Clôturée' }] }, [], []],
    ['Passer le harnais en câble blindé', { number: 'DM-006', group: 1, origin: 'Thales', class: 'major', submittedOn: '2026-08-12', rounds: [{ round: 0, decision: 'rejected', date: '2026-08-20', comment: 'Hors périmètre' }] }, [], []]
  ]
  const made: Task[] = []
  for (const [title, change, assignees, more] of rows) {
    tune(change.number, change)
    made.push(await plugin.changes.create({ title, change: emptyChange(change), projects: [project.filePath, ...more], assignees, today: '2026-10-09' }))
  }
  return made
}
setLocale((query.get('lang') as 'fr' | 'en') ?? 'fr')

async function main(): Promise<void> {
  const fake = makeFakeApp({ liveMetadataCache: true })
  const app = fake.app as unknown as App
  const opened: string[] = []
  Object.assign(app as object, {
    workspace: {
      getLeaf: () => ({ openFile: async (file: { path: string }) => opened.push(file.path) }),
      getActiveViewOfType: () => null,
      on: () => ({})
    }
  })
  Object.assign((app as any).vault, { getResourcePath: () => 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="%2399a"/></svg>' })
  const settings: PMSettings = structuredClone(DEFAULT_SETTINGS)
  settings.ganttCritical = true
  const index = new VaultIndex(app, () => settings)
  const store = new ProjectStore(app, () => settings, index)
  const library = new DocLibrary(app, () => 'Bibliothèque', () => ({ filesFolder: 'Fichiers', notesHeading: 'Notes' }), (p) => p)
  const requirements = new RequirementStore(app, () => settings.requirements, async () => {}, index)
  const plugin: any = {
    app,
    settings,
    store,
    index,
    library,
    changes: new ChangeLibrary(app, library, () => 'Modifications', () => 'DM / PM'),
    askLibraryProjects: async () => null,
    requirements,
    saveSettings: async () => {},
    refreshViews: () => {},
    persistCollapsedState: async () => {},
    router: { openScope: async () => {} }
  }
  await createDemo(plugin)
  index.build()
  document.querySelector('.notice-container')?.remove()
  const path = settings.demo?.projects[0] ?? ''
  const project = await store.loadProjectByPath(path)
  if (!project) throw new Error('no project')
  const scope = new ProjectScope({ kind: 'project', path }, [project], store)
  const body = document.body.createDiv('workspace-leaf-content pm-harness')
  const refresh = async (): Promise<void> => {}
  const tasks = flattenTasks(project.tasks).map((f) => f.task)
  switch (screen) {
    case 'reserves':
      new ReservesView(body, scope, plugin, refresh, makeDefaultFilter()).render()
      break
    case 'budget':
      new BudgetView(body, scope, plugin, refresh, makeDefaultFilter()).render()
      break
    case 'budget-open': {
      const view = new BudgetView(body, scope, plugin, refresh, makeDefaultFilter())
      view.render()
      ;(body.querySelectorAll('.pm-budget-lot')[1] as HTMLElement)?.click()
      break
    }
    case 'gantt':
      new GanttView(body, scope, plugin, refresh, makeDefaultFilter(), new Scope() as never).render()
      break
    case 'changes':
      await sampleChanges(plugin, project)
      new ChangesView(body, scope, plugin, refresh, makeDefaultFilter()).render()
      break
    case 'change-panel': {
      const task = (await sampleChanges(plugin, project))[0]
      new ChangeModal(plugin, task, () => {}, [project]).open()
      break
    }
    case 'change-closed':
    case 'revise-modal': {
      const docTicket = tasks.find((one: Task) => isDocument(one) && one.filePath)
      const libraryDoc = library.docs()[0]
      const done = makeTask({ title: 'Mettre à jour le plan PL-002 à l’indice C', status: 'done', due: '2026-09-01' })
      const doing = makeTask({ title: 'Diffuser le plan aux sous-traitants', due: '2026-09-05' })
      project.tasks.push(done, doing)
      rebuildTaskIndex(project)
      const dm = (
        await sampleChanges(plugin, project, (number, change) => {
          if (number !== 'DM-005') return
          change.affected = [
            ...(libraryDoc ? [refLink(app, libraryDoc.record, libraryDoc.title, '')] : []),
            ...(docTicket?.filePath ? [refLink(app, docTicket.filePath, docTicket.title, '')] : []),
            'Harnais principal'
          ]
          change.tasks = [done.id, doing.id]
        })
      )[4]
      if (screen === 'revise-modal') {
        new ReviseDocsModal(plugin, dm, revisableDocs(plugin, [project], dm)).open()
        break
      }
      new ChangeModal(plugin, dm, () => {}, [project]).open()
      break
    }
    case 'impl-modal': {
      const dm = (await sampleChanges(plugin, project))[0]
      dm.change!.proposal = 'Connecteur étanche IP67 de même empreinte :\n- Commander les connecteurs IP67\n- Modifier le plan de câblage\n- Requalifier en essais climatiques'
      const second = plugin.settings.demo?.projects[1] ? await store.loadProjectByPath(plugin.settings.demo.projects[1]) : null
      new ImplementationModal(plugin, second ? [project, second] : [project], dm, async () => {}).open()
      break
    }
    case 'dashboard-changes': {
      await sampleChanges(plugin, project)
      new ProjectDashboard(body, scope, plugin, refresh, makeDefaultFilter(), () => {}).render()
      break
    }
    case 'clm':
      new BoardModal(plugin, scope, await sampleChanges(plugin, project), async () => {}).open()
      break
    case 'reserve-panel': {
      const task = tasks.find((t: Task) => t.type === 'reserve') as Task
      const modal = body.createDiv('modal pm-harness-modal')
      modal.createDiv({ cls: 'modal-title', text: task.title })
      const content = modal.createDiv('modal-content')
      const draw = (): void => {
        content.empty()
        renderReservePanel(content, { task, project, plugin, rerender: draw })
      }
      draw()
      break
    }
    case 'ics':
      new IcsExportModal(plugin, [project], project.title).open()
      break
    case 'planning': {
      const modal: any = new PlanningImportModal(plugin, project)
      modal.open()
      modal.fileName = 'Planning B12.xml'
      modal.plan = readMsProject(SAMPLE_MSPDI)
      modal.render()
      break
    }
    case 'collections': {
      const docs = library.docs()
      if (docs[0]) await library.setCollections(docs[0], ['CCTP Lot 02', 'Normes'])
      if (docs[1]) await library.setCollections(docs[1], ['Normes'])
      new CollectionsModal(plugin, library.docs().slice(0, 2), () => {}).open()
      break
    }
    case 'docpick': {
      const docs = library.docs()
      if (docs[0]) await library.setCollections(docs[0], ['Normes'])
      new DocPickModal(plugin, docs.slice(0, 1).map((doc) => doc.file), (p: string) => p, () => {}).open()
      break
    }
    case 'pour': {
      void chooseProjects(app, {
        heading: 'Ajouter 2 documents à la bibliothèque',
        names: ['CCTP Lot 02.pdf', 'NF C 15-100.pdf'],
        projects: [{ path: project.filePath, title: project.title, detail: 'Projects' }],
        chosen: [],
        classify: { categories: ['CCTP', 'Plan'], lots: ['Lot 02'], issuers: ['MOE'], tags: [] },
        collections: { known: ['Normes', 'CCTP Lot 02'], chosen: ['Normes'] },
        confirm: 'Ajouter'
      })
      break
    }
    case 'home': {
      body.addClass('pm-root', 'pm-home-root')
      const go = () => {}
      renderHome(
        body,
        { projects: index.rootRefs().length, contacts: 14, documents: 552, documentsRead: 470, notes: 38, requirements: index.requirementRefs().length, prompts: 12, personas: 5 },
        { projects: go, chat: go, contacts: go, documents: go, notes: go, requirements: go, prompts: go, personas: go, settings: go, newProject: go, newNote: go }
      )
      break
    }
    case 'prompts': {
      const write = async (name: string, scope: any, scopeWord: string, category: string, favorite: boolean, question: string, description = ''): Promise<void> => {
        await app.vault.create(`Chats/Prompts/${name}.md`, promptNoteContent({ scope, scopeWord, category, description, favorite, question }))
      }
      await write('Compte rendu de réunion', 'note', 'note', 'Réunions', true, 'Rédige le compte rendu de la réunion du {Date:date} : décisions, actions avec leur responsable et leur échéance, points en suspens.')
      await write('Ordre du jour', 'project', 'projet', 'Réunions', false, 'Propose l’ordre du jour du prochain comité de pilotage à partir des tickets en retard et des décisions attendues.')
      await write('Relecture des exigences', 'requirements', 'exigences', 'Qualité', true, 'Relis ces exigences : ambiguïtés, exigences non vérifiables, doublons, et propose une reformulation.', 'Relecture qualité avant revue')
      await write('Résumé pour la direction', 'any', '', '', false, 'Résume en cinq lignes, pour la direction, ce qui vient d’être dit.')
      await new Promise((resolve) => setTimeout(resolve, 50))
      body.addClass('pm-root', 'pm-prompts')
      const view: any = new PromptsView({} as never, plugin)
      view.app = app
      view.containerEl = document.body.createDiv()
      view.contentEl = body
      view.registerEvent = () => {}
      await view.onOpen()
      break
    }
    case 'personas':
    case 'personas-empty': {
      if (screen === 'personas') {
        for (const starter of starterPersonas()) await createPersona(app, 'Chats/Personas', starter.name, starter.draft)
        settings.chat.persona = 'Chats/Personas/Juriste marchés publics.md'
      }
      plugin.activePersona = () => settings.chat.persona || null
      plugin.usePersona = async () => {}
      await new Promise((resolve) => setTimeout(resolve, 50))
      body.addClass('pm-root', 'pm-prompts', 'pm-personas')
      const view: any = new PersonasView({} as never, plugin)
      view.app = app
      view.containerEl = document.body.createDiv()
      view.contentEl = body
      view.registerEvent = () => {}
      await view.onOpen()
      break
    }
    case 'prompt-modal': {
      new PromptModal(app, ['Réunions', 'Qualité'], async () => {}, {
        name: 'Compte rendu de réunion',
        question: 'Rédige le compte rendu de la réunion du {Date:date} : décisions, actions avec leur responsable et leur échéance, points en suspens.',
        scope: 'note',
        category: 'Réunions',
        description: '',
        favorite: true
      }, true).open()
      break
    }
    case 'delivery': {
      const docs = tasks.filter(isDocument)
      new DeliveryModal(plugin, project, docs, new Set(docs.slice(0, 3).map((task) => task.id))).open()
      break
    }
    case 'person-picker': {
      const book = new ContactBook(readContacts(app, plugin.settings.peopleFolder))
      new PersonPicker(app, book, projectPeople(book, project), () => {}).open()
      break
    }
    case 'doc-sheet':
    case 'doc-sheet-combo': {
      plugin.libraryText = {
        entry: () => ({ state: 'ok', text: 'Le présent cahier des clauses techniques particulières définit les travaux de gros œuvre '.repeat(40), mtime: 0 }),
        unreadReason: () => null,
        onChange: () => () => {},
        reread: async () => {}
      }
      plugin.scans = { stateOf: () => null }
      plugin.libraryChoices = () => ({
        categories: ['Plan', 'CCTP', 'Note de calcul', 'Compte rendu', 'Planning', 'Rapport', 'Courrier'],
        lots: ['Gros œuvre', 'Charpente', 'Électricité'],
        issuers: ['BET Structure'],
        tags: [],
        lotsFor: () => ['Documents', 'Réserves', 'Gros œuvre']
      })
      plugin.rememberCategory = async () => {}
      plugin.referenceFolder = () => 'Référence'
      const docs = library.docs()
      const [doc, other, third] = docs
      await library.setHandFields(doc, { reference: 'B12-CCTP-02', edition: '2', revision: '15' })
      await library.setClassification(doc, { category: 'CCTP', lot: 'Gros œuvre', issuer: 'BET Structure', tags: ['marché', 'lot02'] })
      if (other) await library.setPrevious(library.docs().find((one) => one.record === doc.record)!, other)
      if (third) await library.addSource(library.docs().find((one) => one.record === doc.record)!, third)
      const fresh = library.docs().find((one) => one.record === doc.record)!
      const host = {
        plugin,
        projectTitle: (p: string) => p.replace(/^.*\//, '').replace(/\.md$/, ''),
        languageOf: () => 'fr',
        openDoc: async () => {}, openRecord: async () => {}, editProjects: async () => {}, editCollections: () => {},
        pickSource: () => {}, pickPrevious: () => {}, chooseLanguage: () => {}, pickOtherLanguage: () => {},
        fileInRegister: async () => {}, showMenu: () => {}, remove: () => {},
        renderRegister: (parent: HTMLElement) => { parent.createSpan({ cls: 'pm-docs-reg', text: 'Démo — Bâtiment B12 · B12-CCTP-02 · indice B · Reçu' }) },
        renderRagChip: (parent: HTMLElement) => { parent.createSpan({ cls: 'pm-docs-chip pm-docs-rag is-indexed', text: 'Indexé pour le chat' }) },
        ghostFolders: () => ['Marchés'],
        redraw: () => {}
      }
      new DocumentSheet(host as any, fresh).open()
      if (screen === 'doc-sheet-combo') {
        const input = [...document.querySelectorAll<HTMLInputElement>('.pm-sheet-input')].find((one) => one.value === 'CCTP')
        input?.focus()
      }
      break
    }
    case 'folder-tree': {
      const root = body.createDiv('pm-root pm-docs')
      root.setAttr('style', 'height:100%')
      const split = root.createDiv('pm-docs-split')
      const tree = split.createDiv('pm-docs-tree')
      const list = split.createDiv('pm-content pm-docs-body')
      const folders = ['Marchés', 'Marchés/Lot 01 Terrassement', 'Marchés/Lot 02 Gros œuvre', 'Marchés/Lot 02 Gros œuvre/Plans', 'Normes', 'Référence', 'Réunions', 'Réunions/2026']
      const counts = new Map([['', 4], ['Marchés', 2], ['Marchés/Lot 01 Terrassement', 6], ['Marchés/Lot 02 Gros œuvre', 9], ['Marchés/Lot 02 Gros œuvre/Plans', 23], ['Normes', 12], ['Référence', 5], ['Réunions', 3], ['Réunions/2026', 8]])
      const current = 'Marchés/Lot 02 Gros œuvre'
      const noop = () => {}
      renderFolderTree(tree, { folders, current, counts, total: 72, expanded: new Set(['Marchés', 'Marchés/Lot 02 Gros œuvre']), reference: 'Référence', rootLabel: 'Racine de la bibliothèque', open: noop, toggle: noop, create: noop, drop: noop, rename: noop, remove: noop })
      renderFolderStrip(list, { pathOnly: true, folders, current, open: noop, drop: noop, rename: noop, remove: noop })
      for (const title of ['CCTP Lot 02 — Gros œuvre', 'Note de calcul des fondations', 'Plan de coffrage du radier']) {
        const row = list.createDiv('pm-docs-row')
        row.createDiv({ cls: 'pm-docs-main', text: title })
      }
      break
    }
    case 'flags': {
      body.addClass('pm-root')
      const box = body.createDiv({ attr: { style: 'padding:24px;display:grid;grid-template-columns:repeat(4,160px);gap:12px;font-size:14px' } })
      for (const code of ['fr', 'en', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'sv', 'ja', 'zh', 'ar']) {
        const line = box.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px' } })
        renderFlag(line, code).addClass('pm-docs-flag')
        line.createSpan({ text: code })
      }
      break
    }
    case 'weekly': {
      const config = store.configFor(project)
      const m = projectMetrics({ tasks, statuses: config.statuses, priorities: config.priorities, today: new Date().toISOString().slice(0, 10) })
      const facts = weeklyFacts({ tasks: project.tasks, statuses: config.statuses, today: new Date().toISOString().slice(0, 10), progress: m.progress })
      body.createEl('pre', { cls: 'pm-harness-pre', text: weeklyNote({ project: { title: project.title, link: '[[B12]]' }, facts, synthesis: '', missing: 'Pas de synthèse rédigée : aucun modèle de chat n’est configuré.', pdf: 'Rapports/r.pdf', to: ['direction@exemple.fr'] }) })
      break
    }
  }
  const missing = (globalThis as any).MISSING_ICONS as Set<string> | undefined
  if (missing?.size) console.log('MISSING ICONS: ' + [...missing].join(', '))
  document.body.setAttribute('data-ready', '1')
}

main().catch((error) => {
  console.log('PAGEERROR ' + (error?.stack ?? error))
  document.body.setAttribute('data-ready', '1')
})
