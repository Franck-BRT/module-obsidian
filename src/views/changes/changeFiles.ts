import { normalizePath, Notice, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { changeOf } from '../../store/change'
import { changeSheetDocument, type SheetTask } from '../../store/changeSheet'
import { findTaskById } from '../../store/TaskIndex'
import { buildDocx } from '../../store/docx'
import { buildPdf } from '../../store/pdf'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { sanitizeFileName } from '../../utils'
import { t } from '../../i18n'
import { sheetWords } from './changeLabels'

/** The project's change board folder — or a folder within it —, made when missing. */
export async function clmFolder(plugin: PMPlugin, project: Project, sub = ''): Promise<string> {
  const root = folderOf(project.filePath)
  const parts = [root, t('change.board.folder'), sub].filter(Boolean)
  const folder = normalizePath(parts.join('/'))
  await ensureFolder(plugin.app, folder)
  return folder
}

/** A name free in a folder for every one of the extensions given: « name », else « name (2) »… */
export function freeName(plugin: PMPlugin, folder: string, base: string, extensions: string[]): string {
  const taken = (name: string): boolean =>
    extensions.some((ext) => !!plugin.app.vault.getAbstractFileByPath(normalizePath(`${folder}/${name}.${ext}`)))
  let name = base
  for (let n = 2; taken(name); n++) name = `${base} (${n})`
  return name
}

/** The projects a change belongs to, loaded — those already at hand first, the same objects. */
export async function projectsOfChange(plugin: PMPlugin, task: Task, known: Project[] = []): Promise<Project[]> {
  const paths = (task.filePath ? plugin.changes.at(task.filePath)?.doc.projects : undefined) ?? []
  const out: Project[] = []
  for (const path of paths) {
    const project = known.find((one) => one.filePath === path) ?? (await plugin.store.loadProjectByPath(path))
    if (project) out.push(project)
  }
  return out
}

/** A ticket carrying a change out, with the project it is in. */
export interface ImplementationTask {
  task: Task
  project: Project
}

/** The tickets carrying a change out, as its sheet lists them: those still in one of its projects. */
export function implementationTasks(projects: Project[], task: Pick<Task, 'change'>): ImplementationTask[] {
  const out: ImplementationTask[] = []
  for (const id of changeOf(task).tasks) {
    for (const project of projects) {
      const found = findTaskById(project, id)
      if (found) {
        out.push({ task: found, project })
        break
      }
    }
  }
  return out
}

/**
 * A change's sheet written in Word and in PDF into the library's files, beside its note —
 * the one printed before replaced —, the PDF made the file the library shows for it, and
 * opened.
 */
export async function writeChangeSheet(plugin: PMPlugin, task: Task, projects: Project[]): Promise<void> {
  try {
    const tasks: SheetTask[] = implementationTasks(projects, task).map(({ task: one, project }) => ({
      title: one.title,
      status: plugin.store.configFor(project).statuses.find((status) => status.id === one.status)?.label ?? one.status,
      due: one.due
    }))
    const title = projects.map((project) => project.title).join(' · ')
    const document = changeSheetDocument(task, sheetWords(), { project: title, tasks })
    const record = task.filePath ? plugin.changes.at(task.filePath) : undefined
    const folder = plugin.library.filesOf(record?.doc.folder ?? '')
    await ensureFolder(plugin.app, folder)
    const change = changeOf(task)
    const base = sanitizeFileName([t('change.sheet.fileName'), change.number, task.title].filter(Boolean).join(' '))
    // The sheet says what the change is now: printed again, it replaces the one before.
    const write = async (ext: string, bytes: Uint8Array): Promise<TFile> => {
      const path = normalizePath(`${folder}/${base}.${ext}`)
      const there = plugin.app.vault.getAbstractFileByPath(path)
      if (there instanceof TFile) {
        await plugin.app.vault.modifyBinary(there, bytes.slice().buffer)
        return there
      }
      return plugin.app.vault.createBinary(path, bytes.slice().buffer)
    }
    await write('docx', buildDocx(document))
    const pdf = await write('pdf', buildPdf(document))
    await plugin.changes.setFile(task, pdf.path)
    new Notice(t('change.sheet.written', { path: pdf.path }))
    await plugin.app.workspace.getLeaf('tab').openFile(pdf)
  } catch (error) {
    console.error(error)
    new Notice(t('change.sheet.failed'))
  }
}

/**
 * A change kept as a ticket of the project, as changes were before they went into the
 * library: written there, belonging to its project, its ticket then taken out. The tickets
 * carrying it out stay where they are, and it keeps them.
 */
export async function moveChangeToLibrary(plugin: PMPlugin, project: Project, task: Task): Promise<Task> {
  const change = changeOf(task)
  const moved = await plugin.changes.create({
    title: task.title,
    change: { ...change, number: change.number || plugin.changes.nextNumber() },
    projects: [project.filePath],
    assignees: task.assignees,
    due: task.due,
    today: (task.createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
  })
  if (findTaskById(project, task.id)) await plugin.store.deleteTask(project, task.id)
  return moved
}
