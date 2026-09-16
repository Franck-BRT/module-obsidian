import { Menu } from 'obsidian'
import type PMPlugin from '../../main'
import type { ProjectScope } from '../../store'
import type { TaskType } from '../../types'
import { typeConfigOf } from '../../store/TicketPalette'
import { openAddTask } from '../../views/addTask'
import { addPaletteMenuItem } from '../StatusBadge'
import { renderAddButton } from './addButton'
import { t } from '../../i18n'

/**
 * The kinds an add row offers, in the order the palette lists them: the plain task first,
 * because it is what is nearly always meant.
 */
export const ADDABLE_TYPES: readonly TaskType[] = ['task', 'subtask', 'milestone', 'phase', 'document']

export interface AddTicketOpts {
  plugin: PMPlugin
  scope: ProjectScope
  onSave: () => void | Promise<void>
}

/**
 * One "add" button that asks what kind, rather than one button per kind.
 *
 * A button each does not scale: the tool knows five kinds of ticket and only two of them
 * had ever earned a place on the row, which made the other three look unavailable. A
 * single ghost opening a menu says what the tool can make, and each entry carries the
 * kind's **own** icon — the one chosen in the settings — so the menu and the badges on
 * the rows below it read as the same vocabulary.
 */
export function renderAddTicketButton(parent: HTMLElement, opts: AddTicketOpts): HTMLButtonElement {
  return renderAddButton(parent, t('task.addTicket'), (e) => {
    const menu = new Menu()
    for (const type of ADDABLE_TYPES) {
      const config = typeConfigOf(type)
      addPaletteMenuItem(menu, config, {
        onClick: () =>
          openAddTask(opts.plugin, opts.scope, {
            event: e,
            defaults: { type },
            onSave: opts.onSave
          })
      })
    }
    menu.showAtMouseEvent(e)
  })
}
