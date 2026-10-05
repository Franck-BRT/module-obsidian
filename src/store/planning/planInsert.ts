import type { Project, Task } from '../../types'
import type { ProjectStore } from '../ProjectStore'

/** A tree inserted line by line, parents first, as the store writes one note at a time. The count comes back. */
export async function insertPlanTree(
  store: Pick<ProjectStore, 'insertTask'>,
  project: Project,
  task: Task,
  parentId: string | null
): Promise<number> {
  const children = task.subtasks
  task.subtasks = []
  await store.insertTask(project, task, parentId)
  let count = 1
  for (const child of children) count += await insertPlanTree(store, project, child, task.id)
  return count
}
