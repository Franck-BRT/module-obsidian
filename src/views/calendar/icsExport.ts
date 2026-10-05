import { App, Modal, normalizePath, Notice, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Project } from '../../types'
import { icsCalendar, icsEvents, ICS_KINDS, type IcsKind, type IcsWords } from '../../store/calendar/ics'
import { ensureFolder, folderOf } from '../../store/vaultFs'
import { displayName, safeAsync, sanitizeFileName } from '../../utils'
import { t } from '../../i18n'

function kindLabel(kind: IcsKind): string {
  switch (kind) {
    case 'meetings':
      return t('ics.kind.meetings')
    case 'milestones':
      return t('ics.kind.milestones')
    case 'dues':
      return t('ics.kind.dues')
    case 'decisions':
      return t('ics.kind.decisions')
    case 'documents':
      return t('ics.kind.documents')
    case 'reserves':
      return t('ics.kind.reserves')
    case 'phases':
      return t('ics.kind.phases')
  }
}

function words(project: string): IcsWords {
  return {
    project,
    meeting: (title) => title,
    milestone: (title) => t('ics.milestone', { title }),
    due: (title) => t('ics.due', { title }),
    decision: (title) => t('ics.decision', { title }),
    document: (title) => t('ics.document', { title }),
    reserve: (title) => t('ics.reserve', { title }),
    phase: (title) => t('ics.phase', { title }),
    category: kindLabel,
    people: (names) => names.map(displayName).join(', ')
  }
}

/** Kept for the next export: what the reader chose to send to their calendar. */
let chosen: IcsKind[] = ['meetings', 'milestones', 'dues', 'decisions', 'documents', 'reserves']

/** Opens a file with the system's own application, where Obsidian offers it. */
async function openOutside(app: App, path: string): Promise<boolean> {
  const opener = (app as App & { openWithDefaultApp?: (path: string) => Promise<void> }).openWithDefaultApp
  if (!opener) return false
  await opener.call(app, path)
  return true
}

/** The projects' calendar written beside the first of them; its path comes back. */
export async function writeIcs(plugin: PMPlugin, projects: Project[], kinds: IcsKind[], name: string): Promise<string> {
  const events = projects.flatMap((project) =>
    icsEvents(project.tasks, plugin.store.configFor(project).statuses, kinds, words(project.title))
  )
  const folder = folderOf(projects[0]?.filePath ?? '')
  if (folder) await ensureFolder(plugin.app, folder)
  const base = sanitizeFileName(t('ics.fileName', { name }))
  const path = normalizePath(folder ? `${folder}/${base}.ics` : `${base}.ics`)
  const content = icsCalendar(name, events)
  const existing = plugin.app.vault.getAbstractFileByPath(path)
  // The same file each time, rewritten: imported again, it updates the calendar.
  if (existing instanceof TFile) await plugin.app.vault.modify(existing, content)
  else await plugin.app.vault.create(path, content)
  return path
}

/**
 * What to send to the calendar — meetings, milestones, due dates, decisions, documents
 * awaited, reserves, lots —, then the `.ics` written beside the project, ready to open
 * in Outlook or any calendar.
 */
export class IcsExportModal extends Modal {
  constructor(
    private plugin: PMPlugin,
    private projects: Project[],
    private name: string
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.setTitle(t('ics.title'))
    this.modalEl.addClass('pm-ics-modal')
    const root = this.contentEl
    root.createDiv({ cls: 'pm-ics-intro', text: t('ics.intro', { name: this.name }) })
    const picked = new Set(chosen)
    const list = root.createDiv('pm-ics-kinds')
    for (const kind of ICS_KINDS) {
      const row = list.createEl('label', { cls: 'pm-ics-kind' })
      const box = row.createEl('input', { attr: { type: 'checkbox' } })
      box.checked = picked.has(kind)
      row.createSpan({ text: kindLabel(kind) })
      box.addEventListener('change', () => {
        if (box.checked) picked.add(kind)
        else picked.delete(kind)
      })
    }
    root.createDiv({ cls: 'pm-ics-note', text: t('ics.note') })
    const foot = root.createDiv('pm-ics-foot')
    foot.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close())
    const go = foot.createEl('button', { cls: 'mod-cta', text: t('ics.export') })
    go.addEventListener(
      'click',
      safeAsync(async () => {
        chosen = ICS_KINDS.filter((kind) => picked.has(kind))
        if (!chosen.length) {
          new Notice(t('ics.nothing'))
          return
        }
        this.close()
        const path = await writeIcs(this.plugin, this.projects, chosen, this.name)
        const fragment = createFragment((el) => {
          el.createDiv({ text: t('ics.written', { path }) })
          const open = el.createEl('button', { cls: 'mod-cta', text: t('ics.open') })
          open.addEventListener(
            'click',
            safeAsync(async (event: MouseEvent) => {
              event.stopPropagation()
              notice.hide()
              if (!(await openOutside(this.plugin.app, path))) new Notice(t('ics.cannotOpen'))
            })
          )
        })
        const notice = new Notice(fragment, 12_000)
      })
    )
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
