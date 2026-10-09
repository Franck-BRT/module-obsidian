import { Modal, Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { changeOf } from '../../store/change'
import { nextIssue } from '../../store/changeFollowUp'
import { documentOf } from '../../store/Document'
import { flattenTasks } from '../../store/TaskTreeOps'
import { versionLabel, type LibraryDoc } from '../../store/library/libraryDoc'
import { resolveAffected } from '../decisions/decisionLinks'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

/** A document a change touches, that a closed change may make to be issued again. */
export type RevisableDoc =
  | { kind: 'library'; title: string; version: string; doc: LibraryDoc }
  | { kind: 'ticket'; title: string; version: string; task: Task; project: Project }

type Action = 'none' | 'next' | 'revise'

/** The documents among what a change touches: those of the library, and the project's document tickets. */
export function revisableDocs(plugin: PMPlugin, projects: Project[], change: Task): RevisableDoc[] {
  const holders = projects.flatMap((project) =>
    flattenTasks(project.tasks).map((flat) => ({ task: flat.task, project }))
  )
  const tasks = holders.map((one) => one.task)
  const source = change.filePath ?? ''
  const docs = plugin.library.docs()
  const out: RevisableDoc[] = []
  for (const raw of changeOf(change).affected) {
    const found = resolveAffected(plugin, raw, source, tasks)
    if (found.kind === 'document') {
      const doc = docs.find((one) => one.record === found.path)
      if (doc) out.push({ kind: 'library', title: doc.title, version: versionLabel(doc), doc })
    } else if (found.kind === 'ticket' && found.task?.type === 'document') {
      const project = holders.find((one) => one.task === found.task)?.project
      if (project) {
        out.push({
          kind: 'ticket',
          title: found.task.title,
          version: documentOf(found.task).issue,
          task: found.task,
          project
        })
      }
    }
  }
  return out
}

/** The issue a document goes to: its revision one up — or its edition when it has only that. */
function nextOf(doc: RevisableDoc): string {
  if (doc.kind === 'ticket') return nextIssue(documentOf(doc.task).issue)
  if (doc.doc.revision?.trim() || !doc.doc.edition?.trim()) return nextIssue(doc.doc.revision ?? '')
  return nextIssue(doc.doc.edition)
}

/**
 * The documents a closed change touched, each to be issued again — its next issue
 * awaited —, or marked « à réviser », or left as it is; the reader chooses for each.
 */
export class ReviseDocsModal extends Modal {
  private actions: Action[]

  constructor(
    private plugin: PMPlugin,
    private change: Task,
    private docs: RevisableDoc[],
    private onDone: () => Promise<void> = async () => {}
  ) {
    super(plugin.app)
    this.actions = docs.map(() => 'next')
  }

  onOpen(): void {
    this.modalEl.addClass('pm-revise-modal')
    const number = changeOf(this.change).number || this.change.title
    this.setTitle(t('change.revise.title', { number }))
    const root = this.contentEl
    root.createDiv({ cls: 'pm-implementation-hint', text: t('change.revise.hint') })
    const list = root.createDiv('pm-revise-list')
    this.docs.forEach((doc, at) => {
      const row = list.createDiv('pm-revise-row')
      setIcon(row.createSpan('pm-revise-icon'), doc.kind === 'library' ? 'library' : 'file-text')
      const what = row.createDiv('pm-revise-what')
      what.createDiv({ cls: 'pm-revise-title', text: doc.title })
      what.createDiv({
        cls: 'pm-revise-version',
        text: [
          doc.kind === 'library' ? t('change.revise.inLibrary') : t('change.revise.inRegister'),
          doc.version ? t('change.revise.current', { version: doc.version }) : t('change.revise.noVersion')
        ].join(' · ')
      })
      const select = row.createEl('select', { cls: 'dropdown' })
      const next = doc.kind === 'library' ? this.libraryNext(doc) : nextOf(doc)
      select.createEl('option', {
        value: 'next',
        text: t('change.revise.next', { from: doc.version || '—', to: next })
      })
      select.createEl('option', { value: 'revise', text: t('change.revise.mark', { tag: t('change.reviseTag') }) })
      select.createEl('option', { value: 'none', text: t('change.revise.none') })
      select.value = this.actions[at]
      select.addEventListener('change', () => (this.actions[at] = select.value as Action))
    })
    const foot = root.createDiv('pm-board-foot')
    foot.createEl('button', { text: t('change.tasks.later') }).addEventListener('click', () => this.close())
    const apply = foot.createEl('button', { cls: 'mod-cta', text: t('change.revise.apply') })
    apply.addEventListener(
      'click',
      safeAsync(async () => {
        apply.disabled = true
        try {
          await this.apply()
        } finally {
          apply.disabled = false
        }
      })
    )
  }

  /** The version a library document goes to, written as the library shows it: « 2-16 ». */
  private libraryNext(doc: Extract<RevisableDoc, { kind: 'library' }>): string {
    const edition = doc.doc.edition?.trim() ?? ''
    const revision = doc.doc.revision?.trim() ?? ''
    if (revision || !edition) return versionLabel({ edition, revision: nextOf(doc) })
    return versionLabel({ edition: nextOf(doc), revision })
  }

  private async apply(): Promise<void> {
    const tag = t('change.reviseTag')
    let changed = 0
    for (const [at, doc] of this.docs.entries()) {
      const action = this.actions[at]
      if (action === 'none') continue
      if (doc.kind === 'library') {
        const library = this.plugin.library
        if (action === 'revise') await library.classify(doc.doc, { tags: [tag] })
        else if (doc.doc.revision?.trim() || !doc.doc.edition?.trim()) {
          await library.setHandFields(doc.doc, { revision: nextOf(doc) })
        } else await library.setHandFields(doc.doc, { edition: nextOf(doc) })
      } else {
        const patch: Partial<Task> =
          action === 'revise'
            ? { tags: doc.task.tags.includes(tag) ? doc.task.tags : [...doc.task.tags, tag] }
            : { document: { ...documentOf(doc.task), issue: nextOf(doc), state: 'expected' } }
        await this.plugin.store.updateTask(doc.project, doc.task.id, patch)
      }
      changed += 1
    }
    this.close()
    new Notice(t('change.revise.done', { count: changed }))
    await this.onDone()
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
