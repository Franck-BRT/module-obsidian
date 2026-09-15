import type { DocState } from '../../types'
import { docStateConfigOf } from '../../store/TicketPalette'

/**
 * The state's name as the settings hold it — renaming "Expected" to "À fournir" renames
 * it in the library, the dashboard and every menu, because they all ask here.
 */
export function docStateLabel(state: DocState): string {
  return docStateConfigOf(state).label
}
