import { FileView, Notice, TFile, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../main'
import { parseEmail, type EmailAttachment, type EmailMessage } from '../store/email'
import { EmptyState } from '../ui/primitives/EmptyState'
import { renderMailPreview } from './mail/mailPreview'
import { attachmentBytes, saveAttachment } from '../store/Attachments'
import { safeAsync, truncateTitle } from '../utils'
import { ticketFromMessage } from './messageToTicket'
import { t } from '../i18n'

export const PM_MESSAGE_VIEW_TYPE = 'pm-message'

/**
 * A message, read inside the vault.
 *
 * Obsidian hands a file it does not know to the operating system, so clicking a `.msg`
 * reopens Outlook on a message the reader has already left — the file is in the vault but
 * none of it is. Claiming the extension is what makes it a document like any other: the
 * envelope and the text are there to be read, and the one thing a reader wants to do with
 * a message that matters is one button away.
 *
 * This is deliberately not the right-click menu. A menu entry only exists where the file
 * is listed and depends on every other listener behaving; opening a file is the gesture a
 * reader makes first, and it cannot be intercepted by anything else.
 */
export class MessageView extends FileView {
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
  }

  getViewType(): string {
    return PM_MESSAGE_VIEW_TYPE
  }

  getIcon(): string {
    return 'mail'
  }

  getDisplayText(): string {
    return this.file ? truncateTitle(this.file.basename, 10) : t('email.message')
  }

  async onLoadFile(file: TFile): Promise<void> {
    const bytes = new Uint8Array(await this.app.vault.readBinary(file))
    const mail = parseEmail(file.name, bytes)
    this.contentEl.empty()
    this.contentEl.addClass('pm-message-view')
    if (!mail) {
      new EmptyState(this.contentEl).setIcon('✉️').setTitle(t('email.unreadable', { name: file.name }))
      return
    }
    this.render(file, mail)
  }

  onUnloadFile(): Promise<void> {
    this.contentEl.empty()
    return Promise.resolve()
  }

  private render(file: TFile, mail: EmailMessage): void {
    renderMailPreview(this.contentEl, mail, {
      fallbackTitle: file.basename,
      action: {
        label: t('email.toTicket'),
        icon: 'square-check-big',
        onClick: safeAsync(() => ticketFromMessage(this.plugin, file))
      },
      onAttachment: safeAsync((attachment: EmailAttachment) => this.openAttachment(file, attachment))
    })
  }

  /**
   * An attachment, written beside the message it came with.
   *
   * Beside it, rather than in a project's documents, because a message opened as a file
   * says nothing about which project it belongs to — and guessing one from the folder it
   * happens to sit in would file a drawing under a project nobody chose. The mailbox view
   * knows the project and puts it where it belongs; this does the honest thing instead.
   */
  private async openAttachment(file: TFile, attachment: EmailAttachment): Promise<void> {
    const bytes = await attachmentBytes(this.app, file.path, attachment.name)
    if (!bytes) {
      new Notice(t('email.attachmentFailed', { name: attachment.name }))
      return
    }
    const path = await saveAttachment(this.app, file.parent?.path ?? '', attachment, bytes)
    new Notice(t('email.attachmentSaved', { path }))
    const saved = this.app.vault.getAbstractFileByPath(path)
    if (saved instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(saved)
  }
}
