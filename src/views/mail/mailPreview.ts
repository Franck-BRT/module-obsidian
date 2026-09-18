import { setIcon } from 'obsidian'
import type { EmailAttachment, EmailMessage } from '../../store/email'
import { formatBytes } from '../../store/email'
import { t } from '../../i18n'

/**
 * A message, read.
 *
 * One renderer for the two places a message is read — the tab that opens when a `.msg`
 * is clicked in the vault, and the pane beside the mailbox. They are the same thing seen
 * from two doors, and a reader who learns one has learned the other; two renderers would
 * have drifted apart by the second change.
 */
export interface MailPreviewOpts {
  /** The name to fall back on when the message carries no subject of its own. */
  fallbackTitle: string
  /** The action offered above the text, when there is one to offer. */
  action?: { label: string; icon: string; onClick: () => void }
  /**
   * What a click on an attachment does. Left out where nothing can be done with one —
   * the chips are then still listed, because knowing a message came with three files is
   * worth something even where this view cannot hand them over.
   */
  onAttachment?: (attachment: EmailAttachment, event: MouseEvent) => void
}

export function renderMailPreview(parent: HTMLElement, mail: EmailMessage, opts: MailPreviewOpts): void {
  const root = parent.createDiv('pm-message')
  root.createEl('h1', { cls: 'pm-message-subject', text: mail.subject.trim() || opts.fallbackTitle })

  const envelope = root.createDiv('pm-message-envelope')
  addRow(envelope, t('email.from'), mail.from)
  addRow(envelope, t('email.to'), mail.to.join(', '))
  addRow(envelope, t('email.cc'), mail.cc.join(', '))
  addRow(envelope, t('email.date'), mail.date)

  if (opts.action) {
    const { label, icon, onClick } = opts.action
    const button = root.createDiv('pm-message-actions').createEl('button', { cls: 'pm-message-cta mod-cta' })
    // Obsidian's button component keeps either an icon or a label, each overwriting the
    // other, so the two are put in the button themselves.
    setIcon(button.createSpan({ cls: 'pm-glyph-icon' }), icon)
    button.createSpan({ text: label })
    button.addEventListener('click', onClick)
  }

  renderAttachments(root, mail.attachments, opts.onAttachment)

  // The body is the message as it was written: line breaks are the author's, so it is
  // laid out as text rather than rendered as markdown, which would eat them.
  root.createDiv({ cls: 'pm-message-body', text: mail.body.trim() || t('email.emptyBody') })
}

/** A row only when the message actually carried that field: an empty "Cc:" says nothing. */
function addRow(parent: HTMLElement, label: string, value: string): void {
  if (!value.trim()) return
  const row = parent.createDiv('pm-message-row')
  row.createSpan({ cls: 'pm-message-label', text: label })
  row.createSpan({ cls: 'pm-message-value', text: value })
}

/**
 * What came with the message.
 *
 * Above the text, not below it: an attachment is usually the point of the mail, and a
 * reader who has to scroll past a quoted thread to find out there was a drawing attached
 * has been told too late. Each says its size, because "the big one" is how people
 * actually tell two files from each other.
 */
function renderAttachments(
  parent: HTMLElement,
  attachments: EmailAttachment[],
  onPick: MailPreviewOpts['onAttachment']
): void {
  if (!attachments.length) return
  const row = parent.createDiv('pm-message-attachments')
  row.createSpan({
    cls: 'pm-message-attachments-label',
    text: t('email.attachments', { count: attachments.length })
  })
  const units = [t('unit.bytes'), t('unit.kilobytes'), t('unit.megabytes'), t('unit.gigabytes')]
  for (const attachment of attachments) {
    const chip = row.createEl('button', { cls: 'pm-message-attachment' })
    setIcon(chip.createSpan({ cls: 'pm-glyph-icon' }), attachmentIcon(attachment))
    chip.createSpan({ cls: 'pm-message-attachment-name', text: attachment.name })
    chip.createSpan({ cls: 'pm-message-attachment-size', text: formatBytes(attachment.size, units) })
    chip.setAttr('aria-label', `${attachment.name} · ${formatBytes(attachment.size, units)}`)
    if (!onPick) {
      chip.disabled = true
      continue
    }
    chip.addEventListener('click', (event) => onPick(attachment, event))
  }
}

/**
 * A glyph for what the file is.
 *
 * From the name rather than the declared type: a mail client's idea of a content type is
 * often `application/octet-stream`, and the extension is what the sender actually meant.
 */
function attachmentIcon(attachment: EmailAttachment): string {
  const name = attachment.name.toLowerCase()
  if (/\.(png|jpe?g|gif|bmp|webp|svg|heic)$/.test(name)) return 'image'
  if (name.endsWith('.pdf')) return 'file-text'
  if (/\.(xlsx?|csv|ods)$/.test(name)) return 'table'
  if (/\.(docx?|odt|rtf)$/.test(name)) return 'file-type'
  if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'file-archive'
  if (/\.(msg|eml)$/.test(name)) return 'mail'
  return 'paperclip'
}
