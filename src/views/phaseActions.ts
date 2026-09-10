import { Notice } from 'obsidian'
import type PMPlugin from '../main'
import type { Project, Task } from '../types'
import { openTasksIn, phaseSpan } from '../store/Phase'
import { chooseDialog } from '../ui/ModalFactory'
import { isTerminalStatus } from '../utils'
import { t } from '../i18n'

/**
 * Archives a lot, and everything it holds — that is what archiving a container means.
 *
 * A lot that still has work open is worth a question rather than a refusal: someone
 * archiving it either means "this is over, mark the rest done" or "put it away as it
 * is". Both are legitimate; guessing is not. A lot already at 100% goes without asking,
 * archiving being reversible.
 */
export async function archivePhase(
  plugin: PMPlugin,
  project: Project,
  phase: Task,
  onRefresh: () => Promise<void>
): Promise<void> {
  const statuses = plugin.store.configFor(project).statuses
  const open = openTasksIn(phase, statuses)

  if (open.length) {
    const choice = await chooseDialog(
      plugin.app,
      t('phase.archiveUnfinished', {
        title: phase.title,
        open: t('count.tasks', { count: open.length }),
        total: t('count.tasks', { count: phaseSpan(phase, statuses).count })
      }),
      [
        { id: 'anyway', label: t('phase.archiveAnyway') },
        { id: 'finish', label: t('phase.finishThenArchive'), primary: true }
      ]
    )
    if (!choice) return
    if (choice === 'finish') {
      const done = statuses.find((status) => isTerminalStatus(status.id, statuses))
      if (!done) {
        new Notice(t('phase.noCompleteStatus'))
        return
      }
      await plugin.store.updateTasks(
        project,
        open.map((task) => task.id),
        () => ({ status: done.id })
      )
    }
  }

  await plugin.store.archiveTask(project, phase.id)
  new Notice(t('phase.archived', { title: phase.title }))
  await onRefresh()
}
