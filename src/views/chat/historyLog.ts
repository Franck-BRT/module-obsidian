import type PMPlugin from '../../main'
import { recordLines, recordProjects, type HistoryWords } from '../../store/chat/chatHistory'
import type { Applied } from '../../store/chat/applyChange'
import { fold, type ChangeSpec } from '../../store/chat/chatChange'
import { undoKey, type UndoRecord } from '../../store/chat/chatUndo'
import { t } from '../../i18n'

/** The words a change is told in, from the reader's own lists of statuses and priorities. */
export function historyWords(plugin: PMPlugin): HistoryWords {
  const labels: Record<string, string> = {
    title: t('chat.change.field.title'),
    status: t('chat.change.field.status'),
    priority: t('chat.change.field.priority'),
    start: t('chat.change.field.start'),
    due: t('chat.change.field.due'),
    progress: t('chat.change.field.progress'),
    assignees: t('chat.change.field.assignees'),
    dependencies: t('chat.change.field.after'),
    dependencyOptions: t('chat.change.field.after'),
    description: t('chat.change.field.description'),
    parent: t('history.moved'),
    completed: t('history.completed'),
    archived: t('history.archived')
  }
  return {
    field: (field) => labels[field] ?? field,
    value: (field, value) => {
      // Only what reads as text: a status's id, a date, a number, names.
      const plain = (one: unknown): string => (typeof one === 'string' || typeof one === 'number' ? String(one) : '')
      if (field === 'archived') return value === true ? t('history.yes') : value === false ? t('history.no') : ''
      if (Array.isArray(value)) return value.map(plain).filter(Boolean).join(', ')
      const text = plain(value)
      if (!text) return ''
      if (field === 'status') return plugin.settings.statuses.find((one) => one.id === text)?.label ?? text
      if (field === 'priority') return plugin.settings.priorities.find((one) => one.id === text)?.label ?? text
      return field === 'progress' ? `${text} %` : text
    },
    created: (title) => t('history.createdTicket', { title }),
    more: (count) => t('history.more', { count })
  }
}

/**
 * A change to a ticket from the chat, kept in the history once it changed something:
 * what, why, from which conversation, and under which key it can be taken back.
 */
export async function logTicketChange(
  plugin: PMPlugin,
  spec: ChangeSpec,
  name: string,
  source: string,
  chat: string,
  record: UndoRecord | null,
  done: Applied
): Promise<void> {
  if ((spec.kind !== 'ticket' && spec.kind !== 'create') || !done.ok || !done.changed) return
  const deleted = spec.kind === 'ticket' && spec.action === 'delete'
  const named = plugin.index.projectRefs().find((ref) => fold(ref.title) === fold(spec.project))?.path
  await plugin.chatHistory.add({
    kind: spec.kind === 'create' ? 'create' : deleted ? 'delete' : 'ticket',
    label: name,
    lines: record ? recordLines(record, historyWords(plugin)) : deleted ? [t('history.deleted')] : [],
    why: spec.why,
    chat,
    projects: record ? recordProjects(record) : named ? [named] : [],
    path: '',
    ticket: record?.changed[0]?.id ?? record?.created[0]?.id,
    key: record ? undoKey(source) : ''
  })
}
