import { Menu } from 'obsidian'
import type PMPlugin from '../../main'
import type { ProjectScope } from '../../store'
import { TASK_TYPES, type TaskType } from '../../types'
import { typeConfigOf } from '../../store/TicketPalette'
import { openAddTask } from '../../views/addTask'
import { addPaletteMenuItem } from '../StatusBadge'
import { renderAddButton } from './addButton'
import { t } from '../../i18n'

/**
 * The kinds an add row offers, in the order the palette lists them: the plain task first,
 * because it is what is nearly always meant.
 *
 * The whole list, and the list itself is checked against the union — a kind the tool can
 * make but never offers is a kind nobody knows about.
 */
export const ADDABLE_TYPES: readonly TaskType[] = TASK_TYPES

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
/**
 * Asks which kind, then makes one.
 *
 * The menu itself rather than a button, because the same question is asked from three
 * places that look nothing alike: the ghost at the foot of a view, the toolbar's filled
 * button, and the small plus on a lot's heading. Each renders its own control and hands
 * the answer here, so the vocabulary they offer cannot drift apart again.
 *
 * Each entry takes its name and its icon from the ticket-type palette, so renaming a kind
 * in the settings renames it here, and the menu reads as the same vocabulary as the
 * badges on the rows below it.
 */
export function showAddTicketMenu(event: MouseEvent | KeyboardEvent, add: (type: TaskType) => void): void {
  const menu = new Menu()
  for (const type of ADDABLE_TYPES) {
    addPaletteMenuItem(menu, typeConfigOf(type), { onClick: () => add(type) })
  }
  if (event instanceof MouseEvent) {
    menu.showAtMouseEvent(event)
    return
  }
  // Reached from the keyboard, where there is no pointer to hang the menu on: it opens
  // under whatever was activated instead.
  const anchor = event.target instanceof HTMLElement ? event.target.getBoundingClientRect() : null
  menu.showAtPosition(anchor ? { x: anchor.left, y: anchor.bottom } : { x: 0, y: 0 })
}

/** The ghost at the foot of a view: one "add", and the menu says what of. */
export function renderAddTicketButton(parent: HTMLElement, opts: AddTicketOpts): HTMLButtonElement {
  return renderAddButton(parent, t('task.addTicket'), (e) => {
    showAddTicketMenu(e, (type) =>
      openAddTask(opts.plugin, opts.scope, { event: e, defaults: { type }, onSave: opts.onSave })
    )
  })
}
