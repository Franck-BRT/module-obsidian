import { normalizePath } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { fillAgenda, type AgendaTemplate } from '../../store/agenda/agendaTemplate'
import { ContactBook, contactFileName, readContacts } from '../../store/contacts'
import { personKeyer } from '../../store/people'
import { findTaskById } from '../../store/TaskIndex'
import { flattenTasks } from '../../store/TaskTreeOps'
import { ensureFolder, projectSubFolder } from '../../store/vaultFs'
import { AgendaFiller, previousMeeting } from './agendaBlocks'

/** Where a project keeps its meetings' notes. */
const MEETING_FOLDER = '_meetings'

/**
 * The agenda written: the template filled from the project as it stands on the day, as a
 * note in the project's meetings folder, linked to the project and the meeting. Its path.
 */
export async function writeAgenda(
  plugin: PMPlugin,
  project: Project,
  template: AgendaTemplate,
  date: string,
  meeting?: Task
): Promise<string> {
  const app = plugin.app
  const tasks = flattenTasks(project.tasks).map((flat) => flat.task)
  const config = plugin.store.configFor(project)
  const previous = previousMeeting(tasks, date, meeting?.meetingKind ?? template.kinds[0], meeting?.id)
  const filler = new AgendaFiller({
    projectTitle: project.title,
    projectPath: project.filePath,
    tasks,
    statuses: config.statuses,
    priorities: config.priorities,
    date,
    horizon: template.horizon,
    meeting,
    previous: previous ?? undefined,
    book: new ContactBook(readContacts(app, plugin.settings.peopleFolder)),
    keyOf: personKeyer(app),
    link: (path, title) => `[[${path.replace(/\.md$/, '')}|${title.replace(/[[\]|]/g, ' ')}]]`
  })
  const body = fillAgenda(template.body, (block) => filler.render(block))
  const link = (path: string, title: string): string =>
    JSON.stringify(`[[${path.replace(/\.md$/, '')}|${title.replace(/[[\]|]/g, ' ')}]]`)
  const front = [
    '---',
    `agenda: ${JSON.stringify(template.name)}`,
    `project: ${link(project.filePath, project.title)}`,
    ...(meeting?.filePath ? [`meeting: ${link(meeting.filePath, meeting.title)}`] : []),
    `date: ${date}`,
    '---',
    ''
  ]
  const folder = projectSubFolder(app, project.filePath, MEETING_FOLDER)
  await ensureFolder(app, folder)
  const base = contactFileName(`${date} ${meeting?.title ?? template.name}`) || date
  let path = normalizePath(`${folder}/${base}.md`)
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} (${n}).md`)
  await app.vault.create(path, [...front, body].join('\n'))
  return path
}

/**
 * A meeting's description with a link to one of its agendas: a line under its agenda
 * heading — the heading added at the end the first time —, the same agenda never twice.
 */
export function withAgendaLink(description: string, heading: string, line: string, path: string): string {
  const target = path.replace(/\.md$/, '')
  if (description.includes(`[[${target}|`) || description.includes(`[[${target}]]`)) return description
  const lines = description.replace(/\s+$/, '').split('\n')
  const at = lines.findIndex((one) => /^#{1,6}\s/.test(one) && one.replace(/^#{1,6}\s+/, '').trim() === heading)
  if (at < 0) {
    const before = lines.join('\n').trim()
    return `${before ? `${before}\n\n` : ''}### ${heading}\n- ${line}\n`
  }
  // After the last line of the section: up to the next heading, blank lines at its end aside.
  let end = at + 1
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++
  while (end > at + 1 && !lines[end - 1].trim()) end--
  lines.splice(end, 0, `- ${line}`)
  return `${lines.join('\n')}\n`
}

/**
 * The agenda named in its meeting's description, linked: in the copy the caller holds —
 * an editor open on the meeting —, and in the meeting's note when it is saved already.
 */
export async function linkAgendaToMeeting(
  plugin: PMPlugin,
  project: Project,
  meeting: Task,
  path: string,
  words: { heading: string; line: (link: string) => string }
): Promise<void> {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
  const link = `[[${path.replace(/\.md$/, '')}|${name.replace(/[[\]|]/g, ' ')}]]`
  const description = withAgendaLink(meeting.description, words.heading, words.line(link), path)
  if (description === meeting.description) return
  meeting.description = description
  if (findTaskById(project, meeting.id)) await plugin.store.updateTask(project, meeting.id, { description })
}
