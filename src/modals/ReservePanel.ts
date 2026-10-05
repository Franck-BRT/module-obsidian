import { Notice, setIcon, TFile } from 'obsidian'
import type PMPlugin from '../main'
import type { Project, ReservePhase, ReserveState, Task, TaskReserve } from '../types'
import {
  moveReserve,
  nextReserveNumber,
  RESERVE_PHASES,
  RESERVE_SEVERITIES,
  RESERVE_STATES,
  reserveOf,
  statusForReserve
} from '../store/reserve'
import { flattenTasks } from '../store/TaskTreeOps'
import { renderPropRow } from '../ui/FormField'
import { renderInputControl, renderSelectControl } from '../ui/composites/properties'
import { formatDate, today } from '../dates'
import { safeAsync } from '../utils'
import { explain } from '../ui/explain'
import { phaseLabel, severityLabel, stateLabel } from '../views/reserves/reserveLabels'
import { t } from '../i18n'

export interface ReservePanelContext {
  task: Task
  project: Project
  plugin: PMPlugin
  rerender: () => void
}

/** The images of a paste or a drop, named for the reserve they go with. */
export function imagesOf(
  items: DataTransferItemList | FileList | null | undefined,
  base: string
): { blob: Blob; name: string }[] {
  const out: { blob: Blob; name: string }[] = []
  const files: File[] = []
  if (!items) return out
  if (items instanceof FileList) files.push(...Array.from(items))
  else {
    for (const item of Array.from(items)) {
      const file = item.kind === 'file' ? item.getAsFile() : null
      if (file) files.push(file)
    }
  }
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
    out.push({ blob: file, name: `${base} ${Date.now()}${out.length ? `-${out.length}` : ''}.${ext}` })
  }
  return out
}

/** Photos kept with the reserve's ticket, their paths added to it. */
export async function addReservePhotos(
  plugin: PMPlugin,
  project: Project,
  task: Task,
  images: { blob: Blob; name: string }[]
): Promise<void> {
  for (const image of images) {
    try {
      const file = await plugin.store.saveTaskAttachment(project, task, image.name, await image.blob.arrayBuffer())
      const reserve = reserveOf(task)
      task.reserve = { ...reserve, photos: [...reserve.photos, file.path] }
    } catch (error) {
      console.error(error)
      new Notice(t('editor.attachmentFailed'))
    }
  }
}

/**
 * The reserve half of a ticket's editor: its number, when it was raised, where, which
 * trade, how serious, where it stands — the days it was said and seen lifted —, and its
 * photos, pasted, dropped or picked. Seen lifted, its ticket is done.
 */
export function renderReservePanel(container: HTMLElement, ctx: ReservePanelContext): void {
  const { task, project, plugin, rerender } = ctx
  if (!task.reserve) {
    const tasks = flattenTasks(project.tasks).map((flat) => flat.task)
    task.reserve = { ...reserveOf(task), number: nextReserveNumber(tasks), raisedOn: today().toString() }
  }
  const reserve = reserveOf(task)
  const set = (patch: Partial<TaskReserve>): void => {
    task.reserve = { ...reserveOf(task), ...patch }
  }

  // Focusable, so a photo can be pasted into it once it is clicked.
  const section = container.createDiv({ cls: 'pm-modal-section pm-reserve-panel', attr: { tabindex: '0' } })
  const header = section.createDiv('pm-modal-section-header')
  header.createEl('h4', { text: t('reserve.section'), cls: 'pm-modal-section-title' })
  const grid = section.createDiv('pm-prop-grid')

  const text = (label: string, icon: string, key: 'number' | 'location' | 'lot', placeholder: string): void => {
    renderPropRow(
      grid,
      label,
      () => {
        const cell = createDiv('pm-prop-value')
        renderInputControl({
          container: cell,
          value: reserve[key],
          placeholder,
          onChange: (value) => {
            set({ [key]: value.trim() })
            rerender()
          }
        })
        return cell
      },
      icon
    )
  }
  text(t('reserve.number'), 'hash', 'number', 'R-001')

  renderPropRow(
    grid,
    t('reserve.state'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: reserve.state,
        options: RESERVE_STATES.map((state) => ({ id: state, label: stateLabel(state) })),
        onChange: (id) => {
          const state = id as ReserveState
          task.reserve = moveReserve(reserveOf(task), state, today().toString())
          const status = statusForReserve(state, task.status, plugin.store.configFor(project).statuses)
          if (status) task.status = status
          rerender()
        }
      })
      const days = [
        reserve.raisedOn && t('reserve.raisedOn', { date: formatDate(reserve.raisedOn) }),
        reserve.declaredOn && t('reserve.declaredOn', { date: formatDate(reserve.declaredOn) }),
        reserve.liftedOn && t('reserve.liftedOn', { date: formatDate(reserve.liftedOn) })
      ].filter(Boolean)
      if (days.length) cell.createSpan({ cls: 'pm-reserve-days', text: days.join(' · ') })
      return cell
    },
    'clipboard-check'
  )

  renderPropRow(
    grid,
    t('reserve.phase'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: reserve.phase,
        options: RESERVE_PHASES.map((phase) => ({ id: phase, label: phaseLabel(phase) })),
        onChange: (id) => {
          set({ phase: id as ReservePhase })
          rerender()
        }
      })
      return cell
    },
    'flag'
  )

  renderPropRow(
    grid,
    t('reserve.severity'),
    () => {
      const cell = createDiv('pm-prop-value')
      renderSelectControl({
        container: cell,
        value: reserve.severity,
        options: RESERVE_SEVERITIES.map((severity) => ({ id: severity, label: severityLabel(severity) })),
        onChange: (id) => {
          set({ severity: id as TaskReserve['severity'] })
          rerender()
        }
      })
      return cell
    },
    'triangle-alert'
  )
  text(t('reserve.location'), 'map-pin', 'location', t('reserve.locationPlaceholder'))
  text(t('reserve.lot'), 'layers', 'lot', t('reserve.lotPlaceholder'))

  // Its photos: pasted here, dropped here, or picked.
  const photos = section.createDiv('pm-reserve-photos')
  photos.createDiv({ cls: 'pm-reserve-label', text: t('reserve.photos') })
  const strip = photos.createDiv('pm-reserve-strip')
  for (const path of reserve.photos) {
    const file = plugin.app.vault.getAbstractFileByPath(path)
    const frame = strip.createDiv('pm-reserve-photo')
    if (file instanceof TFile) {
      const img = frame.createEl('img', { attr: { src: plugin.app.vault.getResourcePath(file), alt: file.name } })
      img.addEventListener(
        'click',
        safeAsync(() => plugin.app.workspace.getLeaf('tab').openFile(file))
      )
    } else frame.createSpan({ cls: 'pm-reserve-missing', text: t('reserve.photoMissing') })
    const remove = frame.createEl('button', {
      cls: 'pm-reserve-photo-remove',
      attr: { 'aria-label': t('reserve.photoRemove') }
    })
    setIcon(remove, 'x')
    remove.addEventListener('click', () => {
      set({ photos: reserveOf(task).photos.filter((one) => one !== path) })
      rerender()
    })
  }
  const add = strip.createEl('label', { cls: 'pm-reserve-add' })
  setIcon(add.createSpan({ cls: 'pm-reserve-add-icon' }), 'camera')
  add.createSpan({ text: t('reserve.photoAdd') })
  explain(add, t('reserve.photoAdd'), t('tip.reserve.photo'))
  const input = add.createEl('input', { attr: { type: 'file', accept: 'image/*', multiple: '' } })
  input.addClass('pm-hidden')
  const take = async (images: { blob: Blob; name: string }[]): Promise<void> => {
    if (!images.length) return
    await addReservePhotos(plugin, project, task, images)
    rerender()
  }
  const base = reserveOf(task).number || t('task.type.reserve')
  input.addEventListener(
    'change',
    safeAsync(() => take(imagesOf(input.files, base)))
  )
  section.addEventListener(
    'paste',
    safeAsync(async (event: ClipboardEvent) => {
      const images = imagesOf(event.clipboardData?.items, base)
      if (!images.length) return
      event.preventDefault()
      await take(images)
    })
  )
  photos.addEventListener('dragover', (event) => event.preventDefault())
  photos.addEventListener(
    'drop',
    safeAsync(async (event: DragEvent) => {
      const images = imagesOf(event.dataTransfer?.files, base)
      if (!images.length) return
      event.preventDefault()
      await take(images)
    })
  )
}
