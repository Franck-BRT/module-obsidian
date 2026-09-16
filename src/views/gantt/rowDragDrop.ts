import type PMPlugin from '../../main'
import type { Project, Task } from '../../types'
import { isPhase } from '../../store/Phase'
import { safeAsync } from '../../utils'

const DROP_CLASSES = [
  'pm-gantt-label-row--drop-before',
  'pm-gantt-label-row--drop-after',
  'pm-gantt-label-row--drop-inside'
]

export interface RowDragOpts {
  plugin: PMPlugin
  project: Project
  /** False while a sort is on: the order a drag would write is not the one on screen. */
  reorderable: boolean
  onRefresh: () => Promise<void>
}

export type DropZone = 'before' | 'after' | 'inside'

/**
 * Which drop a row offers at this height, as a fraction from its top edge.
 *
 * A lot takes a drop in its middle band, which is the only way into one that is folded
 * shut: what it holds is not on screen to be dropped beside. A plain ticket is two halves
 * only — dropping into one would make it a parent by accident, and a ticket holding a
 * ticket is not what anyone meant by dragging onto it.
 */
export function dropZoneFor(task: Pick<Task, 'type'>, ratio: number): DropZone {
  if (!isPhase(task)) return ratio < 0.5 ? 'before' : 'after'
  if (ratio < 0.25) return 'before'
  if (ratio > 0.75) return 'after'
  return 'inside'
}

/**
 * Picking a row up and putting it somewhere else, in the label column.
 *
 * Shared by every row the column draws rather than living with one of them: a lot is
 * rendered as a heading and a ticket as a label, and wiring the drag into only the second
 * left lots unable to be moved **and** unable to be dropped into — which is the half of
 * the plan a reader most often wants to reorganise.
 *
 * A lot also accepts a drop in the middle of its row, which is the only way into one that
 * is folded shut: what it holds is not on screen to be dropped beside. A plain ticket
 * keeps two halves, so nothing acquires children by accident.
 */
export function attachRowDragDrop(el: HTMLElement, task: Task, opts: RowDragOpts): void {
  el.draggable = opts.reorderable
  el.addEventListener('dragstart', (e: DragEvent) => {
    e.dataTransfer?.setData('text/plain', task.id)
    el.addClass('pm-gantt-label-row--dragging')
  })
  el.addEventListener('dragend', () => {
    el.removeClass('pm-gantt-label-row--dragging')
  })

  let dropPosition: DropZone = 'before'
  el.addEventListener('dragover', (e: DragEvent) => {
    if (!opts.reorderable) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    dropPosition = dropZoneFor(task, (e.clientY - rect.top) / rect.height)
    el.removeClasses(DROP_CLASSES)
    el.addClass(`pm-gantt-label-row--drop-${dropPosition}`)
  })
  el.addEventListener('dragleave', () => {
    el.removeClasses(DROP_CLASSES)
  })
  el.addEventListener(
    'drop',
    safeAsync(async (e: DragEvent) => {
      e.preventDefault()
      el.removeClasses(DROP_CLASSES)
      if (!opts.reorderable) return
      const draggedId = e.dataTransfer?.getData('text/plain')
      if (!draggedId || draggedId === task.id) return
      await opts.plugin.store.reorderTask(opts.project, draggedId, task.id, dropPosition)
      await opts.onRefresh()
    })
  )
}
