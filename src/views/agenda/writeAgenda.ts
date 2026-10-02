import { normalizePath } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { fillAgenda, type AgendaTemplate } from '../../store/agenda/agendaTemplate'
import { ContactBook, contactFileName, readContacts } from '../../store/contacts'
import { personKeyer } from '../../store/people'
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
