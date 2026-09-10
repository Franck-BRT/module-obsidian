import { normalizePath } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { bordereauRows } from '../../store/Document'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { sanitizeFileName } from '../../utils'
import { formatDate } from '../../dates'
import { t } from '../../i18n'

/**
 * Writes the transmittal for a set of documents as a note in the project's folder.
 *
 * A note rather than a file the plugin holds: it is a piece of correspondence, it will
 * be read, sent and kept long after this build of the plugin, and a Markdown table is
 * something Obsidian and everything else can still open.
 */
export async function writeBordereau(plugin: PMPlugin, project: Project, tasks: Task[]): Promise<string> {
  const rows = bordereauRows(tasks)
  const stamp = new Date().toISOString().slice(0, 10)
  const folder = folderOf(project.filePath)
  if (folder) await ensureFolder(plugin.app, folder)

  const lines = [
    '---',
    `title: "${t('view.bordereau')} ${stamp}"`,
    `project: "${project.title}"`,
    `date: ${stamp}`,
    '---',
    '',
    `# ${t('view.bordereau')} — ${project.title}`,
    '',
    formatDate(stamp),
    '',
    `| ${t('doc.reference')} | ${t('common.task')} | ${t('doc.issue')} | ${t('doc.versions')} | ${t('common.due')} | ${t('doc.recipient')} |`,
    '| --- | --- | --- | --- | --- | --- |'
  ]
  for (const row of rows) {
    lines.push(
      `| ${row.reference || '—'} | ${row.title} | ${row.issue || '—'} | ${row.version || '—'} | ${row.date || '—'} | ${row.recipient || '—'} |`
    )
  }
  lines.push('')

  const base = sanitizeFileName(`${t('view.bordereau')} ${project.title} ${stamp}`)
  let path = normalizePath(folder ? `${folder}/${base}.md` : `${base}.md`)
  for (let n = 2; plugin.app.vault.getAbstractFileByPath(path); n++) {
    path = normalizePath(folder ? `${folder}/${base} (${n}).md` : `${base} (${n}).md`)
  }
  await plugin.app.vault.create(path, lines.join('\n'))
  return path
}
