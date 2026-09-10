import type { Task } from '../../../types'
import { Chip } from '../../primitives/Chip'
import { IconButton } from '../../primitives/IconButton'
import { renderTagChip } from '../tagChip'
import { renderTreeGuides } from '../treeGuides'
import { makeInlineEdit } from './inlineEdit'
import { t } from '../../../i18n'

export interface TitleCellProps {
  task: Task
  /** One entry per indent column: does an ancestor at that column still have rows below it. Null draws no connectors. */
  treeGuides: boolean[] | null
  isLastChild: boolean
  showTagColors: boolean
  onTitleClick: () => void
  onTitleSave: (newTitle: string) => Promise<void>
  onAddSubtask: () => void
}

export class TitleCell {
  el: HTMLTableCellElement

  constructor(parentRow: HTMLElement, props: TitleCellProps) {
    const { task } = props
    this.el = parentRow.createEl('td', { cls: 'pm-table-cell-title' })
    renderTreeGuides(this.el, props.treeGuides, props.isLastChild)
    const inner = this.el.createDiv('pm-table-title-inner')

    const titleSpan = inner.createSpan({ text: task.title, cls: 'pm-task-title-text' })
    titleSpan.addEventListener('click', () => props.onTitleClick())
    titleSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      makeInlineEdit({
        container: inner,
        display: titleSpan,
        inputType: 'text',
        value: task.title,
        onSave: props.onTitleSave
      })
    })

    new IconButton(inner)
      .setIcon('plus')
      .setTooltip(t('task.addSubtask'))
      .setRevealOnHover(true)
      .onClick((e) => {
        e.stopPropagation()
        props.onAddSubtask()
      })

    if (task.type === 'milestone') {
      new Chip(inner)
        .setLabel(t('common.milestoneBadge'))
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-purple)')
        .setTooltip(t('common.milestone'))
    }
    if (task.type === 'subtask') {
      new Chip(inner)
        .setLabel(t('common.sub'))
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-green)')
        .setTooltip(t('common.subtask'))
    }
    if (task.recurrence) {
      new Chip(inner)
        .setLabel(t('common.recurringBadge'))
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--color-blue)')
        .setTooltip(t('task.recurring'))
    }
    if (task.archived) {
      new Chip(inner)
        .setLabel(t('common.archived'))
        .setVariant('solid')
        .setSize('sm')
        .setColor('var(--text-muted)')
        .setTooltip(t('common.archived'))
    }

    if (task.tags.length) {
      const tagRow = inner.createDiv('pm-table-tags')
      for (const tag of task.tags) {
        renderTagChip(tagRow, tag, props.showTagColors)
      }
    }
  }
}
