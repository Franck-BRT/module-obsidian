import { ButtonComponent, Menu } from 'obsidian'
import type { PMSettings } from '../types'
import { sortKeyLabel, type SortKey, type TaskOrder } from './sortOrder'
import { safeAsync } from '../utils'
import { t } from '../i18n'

export interface SortControlProps {
  /** The orders this view offers: a board leaves out status, its columns being statuses. */
  keys: SortKey[]
  order: TaskOrder
  onPick: (order: TaskOrder) => void | Promise<void>
}

/**
 * The button that says which order rows are in, and the menu behind it: the keys, then
 * the direction once a key other than manual is chosen — there is no ascending order of
 * the project's own order, so offering one would be a lie.
 *
 * Shared by the Gantt and the board so the two read the same and cannot drift apart.
 */
export function renderSortControl(parent: HTMLElement, props: SortControlProps): void {
  const { keys, order } = props
  const arrow = order.sortKey === 'manual' ? '' : order.sortDir === 'asc' ? ' ↑' : ' ↓'
  new ButtonComponent(parent)
    .setButtonText(`${t('sort.by')} ${sortKeyLabel(order.sortKey)}${arrow}`)
    .setTooltip(t('sort.tooltip'))
    .onClick((e) => {
      const menu = new Menu()
      for (const key of keys) {
        menu.addItem((item) =>
          item
            .setTitle(sortKeyLabel(key))
            .setChecked(key === order.sortKey)
            .onClick(safeAsync(async () => props.onPick({ ...order, sortKey: key })))
        )
      }
      if (order.sortKey !== 'manual') {
        menu.addSeparator()
        for (const dir of ['asc', 'desc'] as PMSettings['ganttSortDir'][]) {
          menu.addItem((item) =>
            item
              .setTitle(dir === 'asc' ? t('sort.asc') : t('sort.desc'))
              .setChecked(dir === order.sortDir)
              .onClick(safeAsync(async () => props.onPick({ ...order, sortDir: dir })))
          )
        }
      }
      menu.showAtMouseEvent(e)
    })
}
