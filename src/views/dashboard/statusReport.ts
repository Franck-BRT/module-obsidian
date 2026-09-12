import { normalizePath } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project } from '../../types'
import type { ProjectMetrics } from '../../store/Metrics'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { sanitizeFileName } from '../../utils'
import { formatDate, formatDateShort, today } from '../../dates'
import { t } from '../../i18n'

/**
 * Writes the dashboard's figures as a note in the project's folder.
 *
 * A note rather than a picture of the screen: a status report is read, sent and kept,
 * often by someone with no Obsidian at all, and a Markdown table outlives any build of
 * this plugin. It is also the chart's table view — every figure drawn opposite is a
 * number here, which is what makes the drawing safe to look at.
 */
export async function writeStatusReport(plugin: PMPlugin, project: Project, m: ProjectMetrics): Promise<string> {
  const stamp = today().toString()
  const folder = folderOf(project.filePath)
  if (folder) await ensureFolder(plugin.app, folder)

  const span = m.span.start ? `${formatDateShort(m.span.start)} → ${formatDateShort(m.span.due || m.span.start)}` : '—'
  const lines = [
    '---',
    `title: "${t('kpi.reportTitle')} ${stamp}"`,
    `project: "${project.title}"`,
    `date: ${stamp}`,
    `progress: ${m.progress}`,
    `health: ${m.health.level}`,
    '---',
    '',
    `# ${t('kpi.reportTitle')} — ${project.title}`,
    '',
    `${formatDate(stamp)} · ${t(`kpi.health.${m.health.level}`)}`,
    '',
    `| | |`,
    '| --- | --- |',
    `| ${t('common.progress')} | **${m.progress} %** |`,
    `| ${t('kpi.doneOf', { done: m.done, total: m.total })} | |`,
    `| ${t('kpi.late')} | ${m.late} |`,
    `| ${t('kpi.dueSoon')} | ${m.dueSoon} |`,
    `| ${t('kpi.undated')} | ${m.undated} |`,
    `| ${t('kpi.hours')} | ${m.time.logged} / ${m.time.estimate} |`,
    `| ${t('kpi.awaitedDocs')} | ${m.documents.awaited}${m.documents.late ? ` (${m.documents.late} ⚠)` : ''} |`,
    `| ${t('kpi.window')} | ${span} |`,
    ''
  ]

  section(lines, t('kpi.breakdown'), [`| ${t('common.status')} | ${t('count.tasksWord')} |`, '| --- | --- |'])
  for (const slice of m.byStatus) lines.push(`| ${slice.label} | ${slice.count} |`)
  lines.push('')

  if (m.byPriority.length) {
    section(lines, t('common.priority'), [`| ${t('common.priority')} | ${t('count.tasksWord')} |`, '| --- | --- |'])
    for (const slice of m.byPriority) lines.push(`| ${slice.label} | ${slice.count} |`)
    lines.push('')
  }

  if (m.phases.length) {
    section(lines, t('kpi.phases'), [
      `| ${t('task.type.phase')} | ${t('common.progress')} | ${t('count.tasksWord')} | ${t('common.due')} | |`,
      '| --- | --- | --- | --- | --- |'
    ])
    for (const phase of m.phases) {
      lines.push(
        `| ${phase.title} | ${phase.progress} % | ${phase.count} | ${phase.due ? formatDateShort(phase.due) : '—'} | ${phase.overruns ? t('kpi.overruns') : ''} |`
      )
    }
    lines.push('')
  }

  if (m.milestones.length) {
    section(lines, t('kpi.milestones'), [
      `| ${t('task.type.milestone')} | ${t('common.due')} | |`,
      '| --- | --- | --- |'
    ])
    for (const milestone of m.milestones) {
      lines.push(
        `| ${milestone.title} | ${milestone.date ? formatDateShort(milestone.date) : '—'} | ${t(`kpi.milestone.${milestone.state}`)} |`
      )
    }
    lines.push('')
  }

  if (m.byAssignee.length) {
    section(lines, t('kpi.workload'), [
      `| ${t('task.assignees')} | ${t('count.tasksWord')} | ${t('kpi.doneWord')} | ${t('kpi.late')} |`,
      '| --- | --- | --- | --- |'
    ])
    for (const row of m.byAssignee) {
      lines.push(`| ${row.name || t('kpi.unassigned')} | ${row.total} | ${row.done} | ${row.late} |`)
    }
    lines.push('')
  }

  const base = sanitizeFileName(`${t('kpi.reportTitle')} ${project.title} ${stamp}`)
  let path = normalizePath(folder ? `${folder}/${base}.md` : `${base}.md`)
  for (let n = 2; plugin.app.vault.getAbstractFileByPath(path); n++) {
    path = normalizePath(folder ? `${folder}/${base} (${n}).md` : `${base} (${n}).md`)
  }
  await plugin.app.vault.create(path, lines.join('\n'))
  return path
}

function section(lines: string[], heading: string, header: string[]): void {
  lines.push(`## ${heading}`, '', ...header)
}
