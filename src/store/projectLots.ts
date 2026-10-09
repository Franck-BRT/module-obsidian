import { makeTask, type PMSettings, type Project, type Task } from '../types'
import { fold } from './library/libraryDoc'
import { t } from '../i18n'

/**
 * The lots every project has: Documents, where the documents filed into it go, always —
 * then those the settings list, Reserves first by default, where its reserves go.
 */

/** The lot the documents filed into a project go in: always there, never taken off the list. */
export function documentsLot(): string {
  return t('lots.documents')
}

/** The lot a project's reserves go in. */
export function reservesLot(): string {
  return t('lots.reserves')
}

/** The lot the tickets carrying out approved changes go in. */
export function changesLot(): string {
  return t('lots.changes')
}

/** The lots a new project is made with: Documents, then the settings' own, each once. */
export function projectLots(settings: Pick<PMSettings, 'projectLots'>): string[] {
  const out: string[] = []
  for (const name of [documentsLot(), ...settings.projectLots]) {
    const clean = name.trim()
    if (clean && !out.some((one) => fold(one) === fold(clean))) out.push(clean)
  }
  return out
}

/** A project's lot by its name — at its top level, case and accents aside —; undefined when it has none. */
export function findLot(project: Pick<Project, 'tasks'>, name: string): Task | undefined {
  const wanted = fold(name.trim())
  return project.tasks.find((task) => task.type === 'phase' && fold(task.title.trim()) === wanted)
}

/** A project's lot by its name, made at its top level when it has none; its id. */
export async function ensureLot(
  store: { insertTask(project: Project, task: Task, parentId?: string | null): Promise<void> },
  project: Project,
  name: string
): Promise<string> {
  const found = findLot(project, name)
  if (found) return found.id
  const lot = makeTask({ title: name, type: 'phase', start: '' })
  await store.insertTask(project, lot)
  return lot.id
}
