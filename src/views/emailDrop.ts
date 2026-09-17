import { Notice, normalizePath } from 'obsidian'
import type PMPlugin from '../main'
import type { ProjectScope } from '../store'
import type { EmailMessage } from '../store/email'
import { emailToMarkdown, isEmailFile, parseEmail } from '../store/email'
import { sanitizeFileName } from '../utils'
import { openAddTask } from './addTask'
import { t } from '../i18n'

/**
 * A message dragged out of a mail client and dropped on a project.
 *
 * Outlook hands over the whole message as a file rather than as text, so the drop is
 * worth reading rather than ignoring: what arrives is a subject, a sender, a date and a
 * body, which is most of a ticket already filled in. The ticket is opened rather than
 * created outright — the reader still decides what kind it is, which lot it goes in and
 * whether the subject is really the title — and the message file is kept beside it, since
 * a summary is not the correspondence.
 */
export function attachEmailDrop(
  el: HTMLElement,
  plugin: PMPlugin,
  scopeOf: () => ProjectScope | null,
  onSave: () => void | Promise<void>
): void {
  el.addEventListener('dragover', (e: DragEvent) => {
    if (!hasEmail(e)) return
    e.preventDefault()
    el.addClass('pm-email-drop-target')
  })
  el.addEventListener('dragleave', () => el.removeClass('pm-email-drop-target'))
  el.addEventListener('drop', (e: DragEvent) => {
    el.removeClass('pm-email-drop-target')
    const files = Array.from(e.dataTransfer?.files ?? []).filter((file) => isEmailFile(file.name))
    if (!files.length) return
    e.preventDefault()
    void handleDrop(plugin, scopeOf(), files, onSave)
  })
}

/**
 * Whether the drag is carrying a message.
 *
 * A drag in progress will not let anything read the files it holds — only their names and
 * types — so the answer has to come from the type list, and a `.msg` arrives with a type
 * no browser has a name for. An unnamed file is therefore treated as a candidate: the
 * cost of being wrong is a highlight that leads to a drop we then ignore.
 */
function hasEmail(e: DragEvent): boolean {
  const items = Array.from(e.dataTransfer?.items ?? [])
  return items.some((item) => item.kind === 'file')
}

async function handleDrop(
  plugin: PMPlugin,
  scope: ProjectScope | null,
  files: File[],
  onSave: () => void | Promise<void>
): Promise<void> {
  if (!scope?.canAddTask) {
    new Notice(t('email.noProject'))
    return
  }
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const mail = parseEmail(file.name, bytes)
      if (!mail) {
        new Notice(t('email.unreadable', { name: file.name }))
        continue
      }
      const link = await keepMessageFile(plugin, file.name, bytes)
      openAddTask(plugin, scope, { defaults: draftFrom(mail, link), onSave })
    } catch (error) {
      console.error('[Black Projects] Failed to read a dropped message:', error)
      new Notice(t('email.unreadable', { name: file.name }))
    }
  }
}

/** What the message fills in on a new ticket. Everything stays editable. */
export function draftFrom(mail: EmailMessage, link: string): { title: string; description: string; due: string } {
  const labels = { from: t('email.from'), to: t('email.to'), cc: t('email.cc'), date: t('email.date') }
  const body = emailToMarkdown(mail, labels)
  const attached = link ? `\n\n${t('email.original')} [[${link}]]` : ''
  return {
    title: mail.subject || t('email.untitled'),
    description: `${body}${attached}`.trim(),
    // The day it was sent is when the ticket came in, not when it is due: left to the
    // reader rather than guessed at.
    due: ''
  }
}

/**
 * The message itself, kept where Obsidian keeps attachments.
 *
 * A ticket made from a mail summarises it; the thread, the signatures and whatever was
 * attached are only in the file. Saving it through the vault's own attachment path means
 * it lands wherever the user has said attachments go.
 */
async function keepMessageFile(plugin: PMPlugin, name: string, bytes: Uint8Array): Promise<string> {
  try {
    const safe = sanitizeFileName(name) || 'message.msg'
    const target = await plugin.app.fileManager.getAvailablePathForAttachment(safe)
    const file = await plugin.app.vault.createBinary(normalizePath(target), bytes.buffer as ArrayBuffer)
    return file.path
  } catch (error) {
    // Worth a ticket without its attachment rather than no ticket at all.
    console.error('[Black Projects] Could not keep the dropped message:', error)
    return ''
  }
}
