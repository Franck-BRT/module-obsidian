import { setIcon, setTooltip } from 'obsidian'
import { DEPENDENCY_TYPE_LABELS, DEPENDENCY_TYPES, type DependencyOption } from '../../../types'
import { IconButton } from '../../primitives/IconButton'
import { renderNoteLink } from '../noteLink'

/** The note a row's task lives in, and what activating the row leads to. */
export interface DepLink {
  path: string
  open: () => void
}

/** Editing affordances for how the link schedules, shown only where deps are editable. */
export interface DepOptionEditor {
  value: DependencyOption
  onChange: (next: DependencyOption) => void
}

export interface DepRowProps {
  id: string
  title: string
  link?: DepLink | null
  tooltip?: string
  option?: DepOptionEditor
  onRemove?: () => void
}

/**
 * One task in a dependency list: link icon, task id, title, and a remove button when the
 * list is editable. Backs both Depends on and Blocks, so the two read the same.
 */
export function renderDepRow(parent: HTMLElement, props: DepRowProps): HTMLElement {
  const row = parent.createDiv('pm-dep-row')
  setIcon(row.createSpan({ cls: 'pm-dep-icon' }), 'link-2')
  row.createSpan({ cls: 'pm-dep-id', text: props.id })
  const link = props.link
  if (!link) {
    row.createSpan({ cls: 'pm-dep-title', text: props.title })
  } else {
    renderNoteLink(row, { label: props.title, path: link.path, open: link.open, cls: 'pm-dep-title' })
  }
  if (props.tooltip) setTooltip(row, props.tooltip)
  if (props.option) renderDepOption(row, props.option)
  if (props.onRemove) {
    new IconButton(row).setIcon('x').setTooltip('Remove dependency').onClick(props.onRemove)
  }
  return row
}

/** The link type and its lag, in working days: negative overlaps the predecessor. */
function renderDepOption(row: HTMLElement, editor: DepOptionEditor): void {
  const select = row.createEl('select', { cls: 'pm-input pm-select pm-dep-type' })
  for (const type of DEPENDENCY_TYPES) {
    select.createEl('option', { value: type, text: type })
  }
  select.value = editor.value.type
  setTooltip(select, DEPENDENCY_TYPE_LABELS[editor.value.type])
  select.addEventListener('change', () => {
    const type = DEPENDENCY_TYPES.find((t) => t === select.value) ?? editor.value.type
    setTooltip(select, DEPENDENCY_TYPE_LABELS[type])
    editor.onChange({ ...editor.value, type })
  })

  const lag = row.createEl('input', {
    cls: 'pm-input pm-dep-lag',
    attr: { type: 'number', step: '1', 'aria-label': 'Lag in working days' }
  })
  lag.value = String(editor.value.lag)
  setTooltip(lag, 'Lag in working days. Negative overlaps the predecessor.')
  lag.addEventListener('change', () => {
    const parsed = Number.parseInt(lag.value, 10)
    const next = Number.isFinite(parsed) ? parsed : 0
    lag.value = String(next)
    editor.onChange({ ...editor.value, lag: next })
  })
}
