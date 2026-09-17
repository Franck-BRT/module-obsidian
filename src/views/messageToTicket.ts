import { Notice, TFile } from 'obsidian'
import { safeAsync } from '../utils'
import type PMPlugin from '../main'
import { emailToMarkdown, isEmailFile, parseEmail } from '../store/email'
import { pickOption, pickProject, pickVaultFile } from '../modals/PickerModals'
import { openTaskModal } from '../ui/ModalFactory'
import { ADDABLE_TYPES } from '../ui/composites/addTicketButton'
import { typeConfigOf } from '../store/TicketPalette'
import { makeDocument, type Task, type TaskType } from '../types'
import { t } from '../i18n'

/**
 * Turning a message already sitting in the vault into a ticket.
 *
 * A `.msg` dropped straight into the file tree is just a file as far as Obsidian is
 * concerned: clicking it hands it to the operating system, which opens Outlook again —
 * correct, and useless. The right-click menu is where a file offers what can be done with
 * it, so that is where the plugin says it can read one.
 */
export function registerMessageFileMenu(plugin: PMPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !isEmailFile(file.name)) return
      menu.addItem((item) =>
        item
          .setTitle(t('email.toTicket'))
          .setIcon('mail')
          .onClick(safeAsync(() => ticketFromMessage(plugin, file)))
      )
    })
  )
}

/**
 * The same thing from the command palette.
 *
 * A right-click menu only exists where the file does, and a menu that is expected but
 * absent — an older build still loaded, a file list that offers no menu — leaves the
 * feature with no way in at all. A command is always there, so the reader can always get
 * from a message to a ticket, and can see at once whether this build has the feature.
 */
export async function pickMessageForTicket(plugin: PMPlugin): Promise<void> {
  const messages = plugin.app.vault.getFiles().filter((file) => isEmailFile(file.name))
  if (messages.length === 0) {
    new Notice(t('email.noMessages'))
    return
  }
  const file = await pickVaultFile(plugin.app, t('email.pickMessage'), (candidate) => isEmailFile(candidate.name))
  if (file) await ticketFromMessage(plugin, file)
}

export async function ticketFromMessage(plugin: PMPlugin, file: TFile): Promise<void> {
  const bytes = new Uint8Array(await plugin.app.vault.readBinary(file))
  const mail = parseEmail(file.name, bytes)
  if (!mail) {
    new Notice(t('email.unreadable', { name: file.name }))
    return
  }
  const labels = { from: t('email.from'), to: t('email.to'), cc: t('email.cc'), date: t('email.date') }
  const description = `${emailToMarkdown(mail, labels)}\n\n${t('email.original')} [[${file.path}]]`.trim()
  const title = mail.subject.trim() || file.basename

  // The message says nothing about which project it concerns, nor what it is asking for,
  // so both are asked in that order: where it goes, then what it becomes. A vault with a
  // single project has nothing to ask about the first.
  const projects = plugin.index.projectRefs().filter((ref) => !ref.program)
  const first = projects[0]
  if (!first) {
    new Notice(t('email.noProject'))
    return
  }
  const chosen = projects.length === 1 ? first : await pickProject(plugin.app, projects)
  if (!chosen) return

  const type = await pickOption<TaskType>(
    plugin.app,
    t('email.pickType'),
    ADDABLE_TYPES.map((kind) => {
      const config = typeConfigOf(kind)
      return { id: kind, label: config.label, ...(config.icon ? { icon: config.icon } : {}) }
    })
  )
  if (!type) return

  const project = await plugin.store.loadProjectByPath(chosen.path)
  if (!project) return
  openTaskModal(plugin, project, { defaults: defaultsFor(type, title, description), onSave: () => undefined })
}

/**
 * What the form opens on.
 *
 * A document ticket is the one kind that carries something of its own, so it is given the
 * reference the inbox would have given it — the two ways of turning a message into a
 * document must not produce different tickets.
 */
function defaultsFor(type: TaskType, title: string, description: string): Partial<Task> {
  const base: Partial<Task> = { title, description, type }
  return type === 'document' ? { ...base, document: makeDocument({ reference: title }) } : base
}
