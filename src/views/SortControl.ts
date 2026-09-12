import { ButtonComponent, Menu } from 'obsidian'
import type { PMSettings } from '../types'
import type { SortOrder } from './sortOrder'
import { safeAsync } from '../utils'
import { t } from '../i18n'

export interface SortControlProps<K extends string> {
  /** The orders this view offers: a board leaves out status, its columns being statuses. */
  keys: K[]
  label: (key: K) => string
  order: SortOrder<K>
  /**
   * The key that has no direction — a view's own stored order, which exists one way
   * only. Omit it where every key is a real field and both ways mean something.
   */
  unordered?: K
  onPick: (order: SortOrder<K>) => void | Promise<void>
}

/**
 * The button that says which order rows are in, and the menu behind it: the keys, then
 * the direction, unless the chosen key is the one that has none.
 *
 * Shared by every view that offers a sort, so the three read the same and cannot drift.
 */
export function renderSortControl<K extends string>(parent: HTMLElement, props: SortControlProps<K>): void {
  const { keys, label, order } = props
  const directed = order.sortKey !== props.unordered
  const arrow = !directed ? '' : order.sortDir === 'asc' ? ' ↑' : ' ↓'
  new ButtonComponent(parent)
    .setButtonText(`${t('sort.by')} ${label(order.sortKey)}${arrow}`)
    .setTooltip(t('sort.tooltip'))
    .onClick((e) => {
      const menu = new Menu()
      for (const key of keys) {
        menu.addItem((item) =>
          item
            .setTitle(label(key))
            .setChecked(key === order.sortKey)
            .onClick(safeAsync(async () => props.onPick({ ...order, sortKey: key })))
        )
      }
      if (directed) {
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
