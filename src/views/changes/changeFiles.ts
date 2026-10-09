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

/** The tickets carrying a change out, as its sheet lists them: those still in the project. */
export function implementationTasks(project: Project, task: Pick<Task, 'change'>): Task[] {
  return changeOf(task)
    .tasks.map((id) => findTaskById(project, id))
    .filter((one): one is Task => !!one)
}

/**
 * A change's sheet written in Word and in PDF into the project's change board folder,
 * under « Fiches DM », and the PDF opened.
 */
export async function writeChangeSheet(plugin: PMPlugin, project: Project, task: Task): Promise<void> {
  try {
    const statuses = plugin.store.configFor(project).statuses
    const tasks: SheetTask[] = implementationTasks(project, task).map((one) => ({
      title: one.title,
      status: statuses.find((status) => status.id === one.status)?.label ?? one.status,
      due: one.due
    }))
    const document = changeSheetDocument(task, sheetWords(), { project: project.title, tasks })
    const folder = await clmFolder(plugin, project, t('change.sheet.folder'))
    const change = changeOf(task)
    const base = sanitizeFileName([change.number, task.title].filter(Boolean).join(' '))
    const name = freeName(plugin, folder, base, ['docx', 'pdf'])
    await plugin.app.vault.createBinary(normalizePath(`${folder}/${name}.docx`), buildDocx(document).slice().buffer)
    const pdf = await plugin.app.vault.createBinary(
      normalizePath(`${folder}/${name}.pdf`),
      buildPdf(document).slice().buffer
    )
    new Notice(t('change.sheet.written', { path: pdf.path }))
    if (pdf instanceof TFile) await plugin.app.workspace.getLeaf('tab').openFile(pdf)
  } catch (error) {
    console.error(error)
    new Notice(t('change.sheet.failed'))
  }
}
