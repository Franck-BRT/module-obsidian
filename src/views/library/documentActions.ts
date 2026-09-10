import { Notice, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { DocState, Project, Task } from '../../types'
import { documentOf, recordApproval, reopen, statusForState } from '../../store/Document'
import { promptText } from '../../ui/ModalFactory'
import { pickOption, pickVaultFile } from '../../modals/PickerModals'
import { t } from '../../i18n'

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
  await plugin.store.updateTask(project, task.id, patch)
  await onRefresh()
}

/**
 * Takes in a new version: pick a file, say how it should be kept, and note what changed.
 *
 * Copying is the default because a file dropped in an inbox is usually wanted in the
 * project; moving keeps the vault tidy; referencing is for a file that belongs to
 * another arborescence and should stay in it.
 */
export async function depositDocument(
  plugin: PMPlugin,
  project: Project,
  task: Task,
  onRefresh: () => Promise<void>
): Promise<void> {
  if (!plugin.app.vault.getFiles().some((candidate) => candidate.extension !== 'md')) {
    new Notice(t('doc.noFilesInVault'))
    return
  }
  const file = await pickVaultFile(plugin.app, t('doc.pickFile'))
  if (!file) return
  const how = await pickDepositMode(plugin, file)
  if (!how) return
  const note = (await promptText(plugin.app, t('doc.deposit'), t('doc.depositNote'), '')) ?? ''
  // Whoever the project lists first, which is the closest thing to "me" the vault knows.
  const by = project.teamMembers[0] ?? ''

  const meta =
    how === 'link'
      ? await plugin.documents.link(task, file, { by, note })
      : await plugin.documents.deposit(project, task, file, { move: how === 'move', by, note })

  await saveDocument(plugin, project, task, meta, onRefresh)
  new Notice(t('doc.deposited', { title: task.title, version: meta.versions[meta.versions.length - 1]?.version ?? 1 }))
}

function pickDepositMode(plugin: PMPlugin, file: TFile): Promise<'copy' | 'move' | 'link' | null> {
  return pickOption<'copy' | 'move' | 'link'>(plugin.app, file.name, [
    { id: 'copy', label: t('doc.depositCopy'), icon: 'copy' },
    { id: 'move', label: t('doc.depositMove'), icon: 'folder-input' },
    { id: 'link', label: t('doc.depositLink'), icon: 'link' }
  ])
}

/** Files one person's verdict on a document, and moves it on if that was the last one. */
export async function signOff(
  plugin: PMPlugin,
  project: Project,
  task: Task,
  by: string,
  verdict: 'approved' | 'rejected',
  onRefresh: () => Promise<void>
): Promise<void> {
  const note =
    (await promptText(
      plugin.app,
      verdict === 'approved' ? t('doc.approve') : t('doc.reject'),
      t('doc.approvalNote'),
      ''
    )) ?? ''
  const meta = recordApproval(documentOf(task), { by, at: new Date().toISOString(), verdict, note })
  await saveDocument(plugin, project, task, meta, onRefresh)
}

export async function setDocState(
  plugin: PMPlugin,
  project: Project,
  task: Task,
  state: DocState,
  onRefresh: () => Promise<void>
): Promise<void> {
  const meta = documentOf(task)
  const next = state === 'in-review' && meta.state === 'approved' ? reopen(meta) : { ...meta, state }
  await saveDocument(plugin, project, task, next, onRefresh)
}
