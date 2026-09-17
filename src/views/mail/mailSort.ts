import type { PMSettings } from '../../types'
import type { MailEntry } from '../../store/MailBox'
import { entryDate, entryFrom, entrySubject } from '../../store/MailBox'
import { t } from '../../i18n'

/**
 * What a mailbox can be read by.
 *
 * Date leads, newest first, because that is what a mailbox is: the thing that arrived
 * last is the thing being looked for. Sender and subject are the other two ways anyone
 * has ever looked through mail; the file name is there for the messages that cannot be
 * read, which have nothing else to be found by.
 */
export const MAIL_SORT_KEYS: PMSettings['mailSortKey'][] = ['date', 'from', 'subject', 'name']

export function mailSortKeyLabel(key: PMSettings['mailSortKey']): string {
  switch (key) {
    case 'date':
      return t('email.date')
    case 'from':
      return t('email.from')
    case 'subject':
      return t('email.subject')
    case 'name':
      return t('email.fileName')
  }
}

/**
 * An empty field sorts last, whichever way round the list is read.
 *
 * A message with no readable date is not the oldest message in the box; it is one whose
 * date is unknown. Reversing the order should not parade those at the top.
 */
function compare(a: string, b: string, dir: number): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return dir * a.localeCompare(b)
}

function field(entry: MailEntry, key: PMSettings['mailSortKey']): string {
  switch (key) {
    case 'date':
      return entryDate(entry)
    case 'from':
      return entryFrom(entry)
    case 'subject':
      return entrySubject(entry)
    case 'name':
      return entry.name
  }
}

/**
 * The messages in the order the mailbox should list them.
 *
 * The file name is the tie-break, because it is the one field every message has and no
 * two messages in a folder share: two mails from the same sender on the same day then
 * hold a stable order rather than whichever one the vault happened to list first.
 */
export function orderMail(
  entries: MailEntry[],
  order: { sortKey: PMSettings['mailSortKey']; sortDir: PMSettings['mailSortDir'] }
): MailEntry[] {
  const dir = order.sortDir === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    const primary = compare(field(a, order.sortKey), field(b, order.sortKey), dir)
    if (primary !== 0) return primary
    return order.sortKey === 'name' ? 0 : a.name.localeCompare(b.name)
  })
}
