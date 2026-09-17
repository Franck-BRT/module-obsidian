import { setIcon } from 'obsidian'
import type { EmailMessage } from '../../store/email'
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
