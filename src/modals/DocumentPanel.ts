import { Notice } from 'obsidian'
import type PMPlugin from '../main'
import type { DocState, Project, Task } from '../types'
import { DOC_STATES } from '../types'
import { documentOf, pendingApprovers, reopen } from '../store/Document'
import { docStateLabel } from '../views/library/docStateLabel'
import { depositDocument } from '../views/library/documentActions'
import { openVisaSheet } from '../views/visa/VisaModal'
import { documentSheets } from '../views/visa/visaRun'
import { verdictLabel } from '../views/visa/visaDocument'
import { readVerdict } from '../store/visa/visaSheet'
import { formatDate, today } from '../dates'
import { visaWaitsOf } from '../store/visaDelay'
import { waitText } from '../views/visa/visaWaitWords'
import { renderPropRow } from '../ui/FormField'
import { renderInputControl, renderSelectControl } from '../ui/composites/properties'
import { renderPersonPicker } from '../ui/PersonPicker'
import { Chip } from '../ui/primitives/Chip'
import { IconButton } from '../ui/primitives/IconButton'
import { collectAllAssignees } from '../store/TaskTreeOps'
import { displayName, safeAsync } from '../utils'
import { ContactBook, readContacts } from '../store/contacts'
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
        // Who sends or receives it: the contacts offered, companies first.
        const input = cell.querySelector('input')
        if (input && (key === 'issuer' || key === 'recipient')) {
          const id = `pm-doc-${key}-contacts`
          const list = cell.createEl('datalist', { attr: { id } })
          for (const name of new ContactBook(readContacts(plugin.app, plugin.settings.peopleFolder)).names()) {
            list.createEl('option', { value: name })
          }
          input.setAttr('list', id)
        }
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

  // How long its reviewers have, and by when they are due to sign this issue.
  renderPropRow(
    grid,
    t('visa.delay'),
    () => {
      const cell = createDiv('pm-prop-value')
      const projectDays = plugin.store.configFor(project).visaDays
      renderInputControl({
        container: cell,
        value: meta.visaDays ? String(meta.visaDays) : '',
        inputType: 'number',
        suffix: ` ${t('visa.daysWord')}`,
        placeholder: t('visa.delayProject', { count: projectDays }),
        number: { min: 1, max: 365 },
        onChange: (value) => {
          const days = Math.round(Number(value))
          task.document = { ...documentOf(task), visaDays: Number.isFinite(days) && days > 0 ? days : undefined }
          rerender()
        }
      })
      const waits = visaWaitsOf(task, today().toString(), projectDays)
      if (waits.length) {
        const latest = waits[0]
        cell.createSpan({
          cls: `pm-doc-visa-due${latest.late > 0 ? ' is-late' : ''}`,
          text: `${t('visa.dueOn', { date: formatDate(latest.due) })} · ${waitText(latest)}`
        })
      }
      return cell
    },
    'timer'
  )

  renderFileRow(section, ctx)
  renderVersions(section, ctx)
  renderSheets(section, ctx)

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

  // The file read against the specifications and requirements, its observations drafted.
  if (meta.file) {
    new IconButton(row)
      .setIcon('file-search')
      .setTooltip(t('visa.title'))
      .onClick(
        safeAsync(async () => {
          await ctx.save()
          openVisaSheet(plugin, project, task, async () => {
            ctx.rerender()
          })
        })
      )
  }
}

/** Its visa sheets, issue by issue: the verdict, and what is still open from one to the next. */
function renderSheets(section: HTMLElement, ctx: DocumentPanelContext): void {
  const sheets = documentSheets(ctx.plugin, ctx.task)
  if (!sheets.length) return
  const list = section.createDiv('pm-doc-sheets')
  list.createDiv({ cls: 'pm-modal-section-title', text: t('visa.sheets') })
  for (const sheet of [...sheets].reverse()) {
    const line = list.createDiv('pm-doc-sheet')
    const link = line.createEl('a', {
      href: '#',
      text: [sheet.issue ? t('chase.mail.issue', { issue: sheet.issue }) : '', formatDate(sheet.date)]
        .filter(Boolean)
        .join(' — ')
    })
    link.addEventListener(
      'click',
      safeAsync(async (event: MouseEvent) => {
        event.preventDefault()
        await ctx.plugin.app.workspace.openLinkText(sheet.path, '', 'tab')
      })
    )
    const verdict = readVerdict(sheet.verdict)
    if (verdict) line.createSpan({ text: verdictLabel(verdict) })
    if (sheet.reviewer) line.createSpan({ text: displayName(sheet.reviewer) })
    line.createSpan({
      cls: sheet.open.length ? 'pm-doc-sheet-open' : '',
      text: t('visa.openCount', { count: sheet.open.length })
    })
  }
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
