import { normalizePath, Notice, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project } from '../../types'
import { personKeyer } from '../../store'
import { ProjectScope } from '../../store/ProjectScope'
import { flattenTasks } from '../../store/TaskTreeOps'
import { projectMetrics } from '../../store/Metrics'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import {
  isQuiet,
  isoWeek,
  weeklyDue,
  weeklyFacts,
  weeklySnapshot,
  type WeeklyFacts
} from '../../store/weekly/weeklyFacts'
import { LlmClient } from '../../store/llm/client'
import { chatModel } from '../../store/chat/chatModels'
import { isPhase } from '../../store/Phase'
import { today } from '../../dates'
import { isTerminalStatus, safeAsync, sanitizeFileName } from '../../utils'
import { currentLocale, t } from '../../i18n'
import { writeStatusReportPdf } from '../dashboard/statusReport'
import { workProjects } from '../visa/visaWaits'
import { factsMarkdown, recipients, weekNumber, weeklyNote, weeklyRequest } from './weeklyText'

const RECORDS = new Set(['risk', 'decision', 'reserve', 'meeting', 'document'])

/** A project still under way: some work in it is not finished. */
function isActive(plugin: PMPlugin, project: Project): boolean {
  const statuses = plugin.store.configFor(project).statuses
  return flattenTasks(project.tasks).some(
    ({ task }) =>
      !task.archived && !isPhase(task) && !RECORDS.has(task.type) && !isTerminalStatus(task.status, statuses)
  )
}

/** A name for a new file in a folder, numbered past the ones already there. */
function freePath(plugin: PMPlugin, folder: string, base: string, ext: string): string {
  let path = normalizePath(`${folder}/${base}.${ext}`)
  for (let n = 2; plugin.app.vault.getAbstractFileByPath(path); n++) {
    path = normalizePath(`${folder}/${base} (${n}).${ext}`)
  }
  return path
}

/** The model's few lines for management; '' with why when there is no model, or it failed. */
async function synthesize(
  plugin: PMPlugin,
  project: Project,
  facts: WeeklyFacts
): Promise<{ text: string; missing: string }> {
  if (isQuiet(facts)) return { text: '', missing: t('weekly.quietSynthesis') }
  const llm = plugin.settings.llm
  const model = chatModel(plugin.settings.chat.model, llm.modelText)
  if (!llm.enabled || !llm.baseUrl.trim() || !model) return { text: '', missing: t('weekly.noModel') }
  try {
    const reply = await new LlmClient({ settings: llm }).chat(
      weeklyRequest(model, project.title, facts.week, factsMarkdown(facts), currentLocale())
    )
    const text = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    return text ? { text, missing: '' } : { text: '', missing: t('weekly.modelFailed') }
  } catch (error) {
    console.error(error)
    return { text: '', missing: t('weekly.modelFailed') }
  }
}

/**
 * One project's week: its status report as PDF, what changed since the week before, the
 * model's synthesis of it, and the mail to management drafted — all in a note in the
 * project's « Rapports » folder, whose path comes back. The project's state is kept for
 * next week's comparison.
 */
export async function writeWeeklyReport(plugin: PMPlugin, project: Project, day = today().toString()): Promise<string> {
  const config = plugin.store.configFor(project)
  const scope = new ProjectScope({ kind: 'project', path: project.filePath }, [project], plugin.store)
  const tasks = flattenTasks(scope.tasks()).map((flat) => flat.task)
  const metrics = projectMetrics({
    tasks,
    statuses: config.statuses,
    priorities: config.priorities,
    today: day,
    keyOf: personKeyer(plugin.app),
    topRisks: Number.MAX_SAFE_INTEGER
  })
  const root = folderOf(project.filePath)
  const folder = normalizePath(root ? `${root}/${t('weekly.folder')}` : t('weekly.folder'))
  await ensureFolder(plugin.app, folder)
  const pdf = await writeStatusReportPdf(plugin, scope, metrics, { folder, open: false })
  const facts = weeklyFacts({
    tasks: project.tasks,
    statuses: config.statuses,
    calendar: config.workCalendar,
    today: day,
    progress: metrics.progress,
    previous: plugin.settings.weeklySnapshots[project.filePath]
  })
  const synthesis = await synthesize(plugin, project, facts)
  const base = sanitizeFileName(t('weekly.fileName', { project: project.title, week: facts.week }))
  const path = freePath(plugin, folder, base, 'md')
  await plugin.app.vault.create(
    path,
    weeklyNote({
      project: { title: project.title, link: `[[${project.filePath.replace(/\.md$/, '')}|${project.title}]]` },
      facts,
      synthesis: synthesis.text,
      missing: synthesis.missing,
      pdf,
      to: recipients(plugin.settings.weeklyReportTo)
    })
  )
  plugin.settings.weeklySnapshots = {
    ...plugin.settings.weeklySnapshots,
    [project.filePath]: weeklySnapshot(facts, project.tasks, config.statuses)
  }
  await plugin.saveSettings()
  return path
}

let running = false

/**
 * The week's reports, one per active project, written the first time Obsidian is open
 * on or after the chosen weekday — or whenever asked —, then said in a notice that opens
 * them.
 */
export async function runWeeklyReports(plugin: PMPlugin, asked = false): Promise<void> {
  const day = today().toString()
  if (running || (!asked && !weeklyDue(plugin.settings, day))) return
  running = true
  try {
    const projects = (await workProjects(plugin)).filter((project) => isActive(plugin, project))
    plugin.settings.weeklyReportDone = isoWeek(day)
    await plugin.saveSettings()
    if (!projects.length) {
      if (asked) new Notice(t('weekly.noProject'))
      return
    }
    const working = new Notice(t('weekly.working', { count: projects.length }), 0)
    const written: { project: Project; path: string }[] = []
    for (const project of projects) {
      try {
        written.push({ project, path: await writeWeeklyReport(plugin, project, day) })
      } catch (error) {
        console.error(error)
        new Notice(t('weekly.failed', { project: project.title }))
      }
    }
    working.hide()
    if (!written.length) return
    const fragment = createFragment((el) => {
      el.createDiv({
        cls: 'pm-chase-notice-title',
        text: t('weekly.ready', { count: written.length, week: weekNumber(isoWeek(day)) })
      })
      const list = el.createEl('ul', { cls: 'pm-chase-notice-list' })
      for (const { project, path } of written) {
        const link = list.createEl('li').createEl('a', { href: '#', text: project.title })
        link.addEventListener(
          'click',
          safeAsync(async (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            notice.hide()
            const file = plugin.app.vault.getAbstractFileByPath(path)
            if (file instanceof TFile) await plugin.app.workspace.getLeaf('tab').openFile(file)
          })
        )
      }
    })
    const notice = new Notice(fragment, 0)
  } finally {
    running = false
  }
}
