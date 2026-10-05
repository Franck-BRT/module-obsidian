import { normalizePath, Notice, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { buildDocx } from '../../store/docx'
import { buildPdf } from '../../store/pdf'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { today } from '../../dates'
import { sanitizeFileName } from '../../utils'
import { t } from '../../i18n'
import { receptionDocument } from './receptionDocument'

/** A name for a new file in a folder, numbered past the ones already there. */
function freePath(plugin: PMPlugin, folder: string, base: string, ext: string): string {
  let path = normalizePath(`${folder}/${base}.${ext}`)
  for (let n = 2; plugin.app.vault.getAbstractFileByPath(path); n++) {
    path = normalizePath(`${folder}/${base} (${n}).${ext}`)
  }
  return path
}

/**
 * The handover report written into the project's « Réserves » folder, in Word to amend
 * and in PDF to send, the PDF opened. The paths of both come back.
 */
export async function writeReceptionReport(plugin: PMPlugin, project: Project, tasks: Task[]): Promise<string[]> {
  const date = today().toString()
  const document = receptionDocument(tasks, { project: project.title, date })
  const root = folderOf(project.filePath)
  const folder = normalizePath(root ? `${root}/${t('reception.folder')}` : t('reception.folder'))
  await ensureFolder(plugin.app, folder)
  const base = sanitizeFileName(`${t('reception.title')} ${project.title} ${date}`)
  const docx = freePath(plugin, folder, base, 'docx')
  await plugin.app.vault.createBinary(docx, buildDocx(document).slice().buffer)
  const pdf = freePath(plugin, folder, base, 'pdf')
  await plugin.app.vault.createBinary(pdf, buildPdf(document).slice().buffer)
  return [docx, pdf]
}

/** The report written and its PDF opened — or, that failing, said so. */
export async function openReceptionReport(plugin: PMPlugin, project: Project, tasks: Task[]): Promise<void> {
  try {
    const [, pdf] = await writeReceptionReport(plugin, project, tasks)
    new Notice(t('reception.written', { path: pdf }))
    const file = plugin.app.vault.getAbstractFileByPath(pdf)
    if (file instanceof TFile) await plugin.app.workspace.getLeaf('tab').openFile(file)
  } catch (error) {
    console.error(error)
    new Notice(t('reception.failed'))
  }
}
