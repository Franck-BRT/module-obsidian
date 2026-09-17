import { FileView, WorkspaceLeaf, setIcon } from 'obsidian'
import type { TFile } from 'obsidian'
import type PMPlugin from '../main'
import { parseEmail, type EmailMessage } from '../store/email'
import { EmptyState } from '../ui/primitives/EmptyState'
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
    const root = this.contentEl.createDiv('pm-message')
    root.createEl('h1', { cls: 'pm-message-subject', text: mail.subject.trim() || file.basename })

    const envelope = root.createDiv('pm-message-envelope')
    this.addRow(envelope, t('email.from'), mail.from)
    this.addRow(envelope, t('email.to'), mail.to.join(', '))
    this.addRow(envelope, t('email.cc'), mail.cc.join(', '))
    this.addRow(envelope, t('email.date'), mail.date)

    // Obsidian's button component keeps either an icon or a label, each overwriting the
    // other, so the two are put in the button themselves.
    const action = root.createDiv('pm-message-actions').createEl('button', { cls: 'pm-message-cta mod-cta' })
    setIcon(action.createSpan({ cls: 'pm-glyph-icon' }), 'square-check-big')
    action.createSpan({ text: t('email.toTicket') })
    action.addEventListener(
      'click',
      safeAsync(() => ticketFromMessage(this.plugin, file))
    )

    // The body is the message as it was written: line breaks are the author's, so it is
    // laid out as text rather than rendered as markdown, which would eat them.
    root.createDiv({ cls: 'pm-message-body', text: mail.body.trim() || t('email.emptyBody') })
  }

  /** A row only when the message actually carried that field: an empty "Copie :" says nothing. */
  private addRow(parent: HTMLElement, label: string, value: string): void {
    if (!value.trim()) return
    const row = parent.createDiv('pm-message-row')
    row.createSpan({ cls: 'pm-message-label', text: label })
    row.createSpan({ cls: 'pm-message-value', text: value })
  }
}
