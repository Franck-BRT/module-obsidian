// Renders one of the plugin's screens from the demonstration's data, as the page's
// query asks: ?screen=reserves&lang=fr. The screenshot script photographs the result.
import type { App } from 'obsidian'
import { Scope } from 'obsidian'
import { makeFakeApp } from '../../test/fakeVault'
import { setLocale } from '../../src/i18n'
import { DEFAULT_SETTINGS, makeDefaultFilter, type PMSettings, type Task } from '../../src/types'
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
import { IcsExportModal } from '../../src/views/calendar/icsExport'
import { PlanningImportModal } from '../../src/views/planning/PlanningImportModal'
import { readMsProject } from '../../src/store/planning/msProject'
import { weeklyFacts } from '../../src/store/weekly/weeklyFacts'
import { weeklyNote } from '../../src/views/weekly/weeklyText'
import { projectMetrics } from '../../src/store/Metrics'
import { SAMPLE_MSPDI } from './sample'
import { CollectionsModal, DocPickModal } from '../../src/views/documents/collections'

const query = new URLSearchParams(location.search)
const screen = query.get('screen') ?? 'reserves'
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
