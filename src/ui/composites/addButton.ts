import { setIcon } from 'obsidian'

/**
 * The ghost "+ label" shared by every add row.
 *
 * The icon is a plus by default, which is what adding looks like. A row offering more
 * than one kind of thing passes its own, so two buttons side by side still say which is
 * which once a narrow column has taken their labels away.
 */
export function renderAddButton(
  parent: HTMLElement,
  label: string,
  onClick: (e: MouseEvent) => void,
  icon = 'plus'
): HTMLButtonElement {
  const btn = parent.createEl('button', { cls: 'pm-prop-add' })
  setIcon(btn.createSpan({ cls: 'pm-glyph-icon' }), icon)
  btn.createSpan({ cls: 'pm-prop-add-label', text: label })
  btn.addEventListener('click', onClick)
  return btn
}
