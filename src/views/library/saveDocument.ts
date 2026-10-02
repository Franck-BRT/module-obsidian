import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { documentOf, statusForState } from '../../store/Document'

/**
 * Writes a document's own fields back, and keeps the ticket's status in step with them.
 *
 * The two are one thing to the user: a document marked approved is a piece of work that
 * is done, and a project whose progress ignored that would be wrong. The status is only
 * moved when the state actually changed, so nothing is overwritten behind the back of
 * someone who set a status by hand for another reason.
 */
export async function saveDocument(
  plugin: PMPlugin,
  project: Project,
  task: Task,
  next: Task['document'],
  onRefresh: () => Promise<void>
): Promise<void> {
  if (!next) return
  const before = documentOf(task).state
  const patch: Partial<Task> = { document: next }
  if (next.state !== before) {
    const status = statusForState(next.state, plugin.store.configFor(project).statuses)
    if (status) patch.status = status
  }
  // The caller's own copy is brought along: an editor holding a stale document would
  // write it back over this one the next time it saves, losing the version just added.
  Object.assign(task, patch)
  await plugin.store.updateTask(project, task.id, patch)
  await onRefresh()
}
