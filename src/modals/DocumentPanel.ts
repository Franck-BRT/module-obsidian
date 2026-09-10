import { Notice } from 'obsidian'
import type PMPlugin from '../main'
import type { DocState, Project, Task } from '../types'
import { DOC_STATES } from '../types'
import { documentOf, pendingApprovers, reopen } from '../store/Document'
import { docStateLabel } from '../views/library/docStateLabel'
import { depositDocument } from '../views/library/documentActions'
import { renderPropRow } from '../ui/FormField'
import { renderInputControl, renderSelectControl } from '../ui/composites/properties'
import { renderPersonPicker } from '../ui/PersonPicker'
import { Chip } from '../ui/primitives/Chip'
import { IconButton } from '../ui/primitives/IconButton'
import { collectAllAssignees } from '../store/TaskTreeOps'
import { displayName, safeAsync } from '../utils'
import { t } from '../i18n'

export interface DocumentPanelContext {
  task: Task
  project: Project
  plugin: PMPlugin
  rerender: () => void
  /** Saves the ticket as it stands, so a deposit is not lost if the editor is closed. */
  save: () => Promise<void>
}

/**
 * The documentary half of a ticket's editor: where the file is, what state it is in,
 * who has to sign it, and what has already landed.
 *
 * Only the fields belong here. Everything that touches the vault — depositing, restoring
 * — goes through the same actions the library uses, so a version behaves the same
 * whichever screen it was added from.
 */
export function renderDocumentPanel(container: HTMLElement, ctx: DocumentPanelContext): void {
  const { task, project, plugin, rerender } = ctx
  const meta = documentOf(task)
  if (!task.document) task.document = meta

  const section = container.createDiv('pm-modal-section')
  const header = section.createDiv('pm-modal-section-header')
  header.createEl('h4', { text: t('doc.section'), cls: 'pm-modal-section-title' })

  const grid = section.createDiv('pm-prop-grid')

  renderPropRow(
    grid,
    t('doc.state'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: meta.state,
        options: DOC_STATES.map((state) => ({ id: state, label: docStateLabel(state) })),
        onChange: (id) => {
          const next = id as DocState
          // Coming back from approved drops the visas: they signed the issue before.
          task.document = next === 'in-review' && meta.state === 'approved' ? reopen(meta) : { ...meta, state: next }
          rerender()
        }
      })
      return cell
    },
    'file-check'
  )

  const text = (label: string, icon: string, key: 'reference' | 'issue' | 'issuer' | 'recipient' | 'phase'): void => {
    renderPropRow(
      grid,
      label,
      () => {
        const cell = createDiv('pm-prop-value')
        renderInputControl({
          container: cell,
          value: meta[key],
          onChange: (value) => {
            task.document = { ...documentOf(task), [key]: value }
            rerender()
          }
        })
        return cell
      },
      icon
    )
  }
  text(t('doc.reference'), 'hash', 'reference')
  text(t('doc.issue'), 'git-commit-horizontal', 'issue')
  text(t('doc.issuer'), 'send', 'issuer')
  text(t('doc.recipient'), 'inbox', 'recipient')
  text(t('doc.phase'), 'milestone', 'phase')

  renderPropRow(
    grid,
    t('doc.approvers'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderPersonPicker({
        container: cell,
        plugin,
        sourcePath: task.filePath ?? project.filePath,
        extra: () => [...project.teamMembers, ...collectAllAssignees(project.tasks)],
        addLabel: t('doc.addApprover'),
        selected: () => documentOf(task).approvers,
        add: (value) => {
          const current = documentOf(task)
          if (!current.approvers.includes(value)) {
            task.document = { ...current, approvers: [...current.approvers, value] }
          }
        },
        remove: (value) => {
          const current = documentOf(task)
          task.document = {
            ...current,
            approvers: current.approvers.filter((approver) => approver !== value),
            approvals: current.approvals.filter((approval) => approval.by !== value)
          }
        }
      })
      return cell
    },
    'stamp'
  )

  renderFileRow(section, ctx)
  renderVersions(section, ctx)

  const waiting = pendingApprovers(meta)
  if (meta.approvers.length && waiting.length) {
    section.createDiv({
      cls: 'pm-doc-waiting',
      text: t('doc.pendingFrom', { who: waiting.map(displayName).join(', ') })
    })
  }
}

function renderFileRow(section: HTMLElement, ctx: DocumentPanelContext): void {
  const { task, project, plugin } = ctx
  const meta = documentOf(task)
  const row = section.createDiv('pm-doc-file-row')
  row.createSpan({ cls: 'pm-doc-file-label', text: t('doc.file') })

  if (meta.file) {
    const file = plugin.documents.fileOf(meta)
    const chip = new Chip(row)
      .setLabel(meta.file.slice(meta.file.lastIndexOf('/') + 1))
      .setVariant('outline')
      .setLeadingIcon(file ? (meta.linked ? 'link' : 'paperclip') : 'file-x')
      .setTooltip(file ? (meta.linked ? t('view.linkedFile') : meta.file) : t('view.missingFile'))
    chip.el.addClass('pm-clickable')
    chip.el.addEventListener(
      'click',
      safeAsync(async () => {
        if (!(await plugin.documents.open(meta))) new Notice(t('doc.cannotOpen'))
      })
    )
  } else {
    row.createSpan({ cls: 'pm-library-nofile', text: t('view.noDocFile') })
  }

  new IconButton(row)
    .setIcon('upload')
    .setTooltip(t('doc.deposit'))
    .onClick(
      safeAsync(async () => {
        // Saved first: a deposit writes the note itself, and an unsaved edit here would
        // be overwritten by it.
        await ctx.save()
        await depositDocument(plugin, project, task, async () => {
          ctx.rerender()
        })
      })
    )
}

function renderVersions(section: HTMLElement, ctx: DocumentPanelContext): void {
  const meta = documentOf(ctx.task)
  if (!meta.versions.length) return
  const list = section.createDiv('pm-doc-versions')
  for (const version of [...meta.versions].reverse()) {
    const line = list.createDiv('pm-doc-version')
    line.createSpan({ cls: 'pm-doc-version-no', text: t('doc.version', { version: version.version }) })
    line.createSpan({ cls: 'pm-doc-version-meta', text: `${version.at.slice(0, 10)} · ${displayName(version.by)}` })
    if (version.note) line.createSpan({ cls: 'pm-doc-version-note', text: version.note })
  }
}
