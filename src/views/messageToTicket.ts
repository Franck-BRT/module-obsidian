import { Notice, TFile } from 'obsidian'
import { safeAsync } from '../utils'
import type PMPlugin from '../main'
import { emailToMarkdown, isEmailFile, parseEmail } from '../store/email'
import { ProjectPickerModal, pickVaultFile } from '../modals/PickerModals'
import { openTaskModal } from '../ui/ModalFactory'
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
  const defaults = { title: mail.subject.trim() || file.basename, description }

  // The message says nothing about which project it concerns, so the reader does.
  const projects = plugin.index.projectRefs().filter((ref) => !ref.program)
  const open = async (path: string): Promise<void> => {
    const project = await plugin.store.loadProjectByPath(path)
    if (!project) return
    openTaskModal(plugin, project, { defaults, onSave: () => undefined })
  }
  if (projects.length === 1) {
    await open(projects[0].path)
    return
  }
  new ProjectPickerModal(
    plugin.app,
    projects,
    safeAsync((ref) => open(ref.path))
  ).open()
}
