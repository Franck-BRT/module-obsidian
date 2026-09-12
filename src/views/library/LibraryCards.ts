import { setIcon, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { DocState, Project, Task } from '../../types'
import { documentOf, isAwaited } from '../../store/Document'
import { formatDateShort, today } from '../../dates'
import { displayName, safeAsync } from '../../utils'
import { Chip } from '../../ui/primitives/Chip'
import { t } from '../../i18n'
import { docStateLabel } from './docStateLabel'

/** Formats Obsidian renders itself, and can therefore show inside a card. */
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])

/** A file type's icon when there is nothing to show: better than a grey square. */
function iconFor(extension: string): string {
  if (IMAGES.has(extension)) return 'image'
  switch (extension) {
    case 'pdf':
      return 'file-text'
    case 'doc':
    case 'docx':
    case 'odt':
    case 'rtf':
      return 'file-type'
    case 'xls':
    case 'xlsx':
    case 'csv':
    case 'ods':
      return 'table'
    case 'ppt':
    case 'pptx':
      return 'presentation'
    case 'dwg':
    case 'dxf':
    case 'ifc':
    case 'rvt':
      return 'ruler'
    case 'zip':
    case 'rar':
    case '7z':
      return 'file-archive'
    default:
      return 'file'
  }
}

export interface CardsContext {
  /**
   * The states, in the order their bands are stacked. The wall groups by state whatever
   * else the library is sorted by, so this is what sorting by state can still say here:
   * which end of a document's life the eye meets first.
   */
  states: readonly DocState[]
  plugin: PMPlugin
  projectOf: (taskId: string) => Project | null
  picked: Set<string>
  openTicket: (task: Task) => void
  openMenu: (e: MouseEvent, task: Task) => void
  onRefresh: () => Promise<void>
}

/**
 * The documents as a wall of thumbnails, grouped by state.
 *
 * The register answers "what is the issue of PL-002 and who has signed it"; this answers
 * "what have we got", which is a question you settle with your eyes. Both read the same
 * documents — this is a second way of looking, not a second place to keep things.
 */
export function renderDocumentCards(parent: HTMLElement, docs: Task[], ctx: CardsContext): void {
  const wall = parent.createDiv('pm-doc-wall')
  for (const state of ctx.states) {
    const group = docs.filter((task) => documentOf(task).state === state)
    if (!group.length) continue
    const heading = wall.createDiv('pm-doc-wall-heading')
    heading.createSpan({ cls: 'pm-doc-wall-state', text: docStateLabel(state) })
    heading.createSpan({ cls: 'pm-doc-wall-count', text: String(group.length) })
    const grid = wall.createDiv('pm-doc-grid')
    for (const task of group) renderCard(grid, task, state, ctx)
  }
}

function renderCard(grid: HTMLElement, task: Task, state: DocState, ctx: CardsContext): void {
  const meta = documentOf(task)
  const file = ctx.plugin.documents.fileOf(meta)
  const card = grid.createDiv('pm-doc-card')
  card.dataset.state = state
  card.addEventListener('contextmenu', (e) => ctx.openMenu(e, task))

  const box = card.createEl('input', { type: 'checkbox', cls: 'pm-doc-card-pick' })
  box.checked = ctx.picked.has(task.id)
  box.addEventListener('click', (e) => e.stopPropagation())
  box.addEventListener('change', () => {
    if (box.checked) ctx.picked.add(task.id)
    else ctx.picked.delete(task.id)
  })

  const preview = card.createDiv('pm-doc-card-preview')
  renderPreview(preview, file, ctx.plugin)
  preview.setAttr('aria-label', file ? t('doc.open') : t('view.noPreview'))
  preview.addEventListener(
    'click',
    safeAsync(async () => {
      if (!file) {
        ctx.openTicket(task)
        return
      }
      await ctx.plugin.documents.open(meta)
    })
  )

  const body = card.createDiv('pm-doc-card-body')
  const titleRow = body.createDiv('pm-doc-card-title-row')
  const title = titleRow.createSpan({ cls: 'pm-doc-card-title', text: task.title })
  title.setAttr('aria-label', t('view.openTicket'))
  title.addEventListener('click', () => ctx.openTicket(task))

  const line = body.createDiv('pm-doc-card-line')
  const ref = [meta.reference, meta.issue].filter(Boolean).join(' · ')
  if (ref) line.createSpan({ cls: 'pm-doc-card-ref', text: ref })
  const last = meta.versions[meta.versions.length - 1]
  if (last) line.createSpan({ cls: 'pm-doc-card-version', text: t('doc.version', { version: last.version }) })

  const foot = body.createDiv('pm-doc-card-foot')
  new Chip(foot).setLabel(docStateLabel(state)).setSize('sm').setVariant('outline')
  if (task.due) {
    const late = isAwaited(task, today().toString())
    foot.createSpan({
      cls: late ? 'pm-doc-card-due pm-library-late' : 'pm-doc-card-due',
      text: formatDateShort(task.due)
    })
  }
  if (meta.issuer) foot.createSpan({ cls: 'pm-doc-card-issuer', text: displayName(meta.issuer) })
}

/**
 * An image shows itself; a PDF shows its first page, loaded only once the card is on
 * screen — a hundred embedded readers opening at once is not worth the picture. Anything
 * else gets its type's icon and its extension, which is all there is to say about it.
 */
function renderPreview(parent: HTMLElement, file: TFile | null, plugin: PMPlugin): void {
  if (!file) {
    parent.addClass('pm-doc-card-preview--empty')
    setIcon(parent.createDiv('pm-doc-card-icon'), 'file-question')
    return
  }
  if (IMAGES.has(file.extension)) {
    const img = parent.createEl('img', { cls: 'pm-doc-card-img' })
    img.src = plugin.app.vault.getResourcePath(file)
    img.alt = file.name
    return
  }
  if (file.extension === 'pdf') {
    const holder = parent.createDiv('pm-doc-card-pdf')
    const observer = new IntersectionObserver((entries, self) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const frame = holder.createEl('iframe', { cls: 'pm-doc-card-frame' })
        frame.src = `${plugin.app.vault.getResourcePath(file)}#page=1&toolbar=0&navpanes=0&view=FitH`
        self.disconnect()
      }
    })
    observer.observe(holder)
    return
  }
  parent.addClass('pm-doc-card-preview--file')
  setIcon(parent.createDiv('pm-doc-card-icon'), iconFor(file.extension))
  parent.createDiv({ cls: 'pm-doc-card-ext', text: file.extension.toUpperCase() })
}
