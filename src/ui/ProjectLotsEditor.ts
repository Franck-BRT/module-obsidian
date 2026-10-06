import { setIcon } from 'obsidian'
import type { PMSettings } from '../types'
import { documentsLot } from '../store/projectLots'
import { explain } from './explain'
import { t } from '../i18n'

/**
 * The lots a new project is made with: Documents first, locked — every project has it —,
 * then the reader's, each renamed, taken off, or one more added.
 */
export function renderProjectLots(parent: HTMLElement, settings: PMSettings, onChange: () => void): void {
  parent.empty()
  const list = parent.createDiv('pm-lots-editor')
  const locked = list.createDiv('pm-lots-row is-locked')
  const name = locked.createEl('input', { attr: { type: 'text', disabled: 'true' } })
  name.value = documentsLot()
  const lock = locked.createSpan('pm-lots-lock')
  setIcon(lock, 'lock')
  explain(lock, t('settings.projectLots.locked'), t('settings.projectLots.lockedHint'))
  settings.projectLots.forEach((lot, at) => {
    const row = list.createDiv('pm-lots-row')
    const input = row.createEl('input', { attr: { type: 'text', placeholder: t('settings.projectLots.placeholder') } })
    input.value = lot
    input.addEventListener('change', () => {
      settings.projectLots[at] = input.value.trim()
      onChange()
    })
    const remove = row.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': t('settings.projectLots.remove') }
    })
    setIcon(remove, 'trash-2')
    remove.addEventListener('click', () => {
      settings.projectLots.splice(at, 1)
      onChange()
      renderProjectLots(parent, settings, onChange)
    })
  })
  const add = list.createEl('button', { text: t('settings.projectLots.add') })
  add.addEventListener('click', () => {
    settings.projectLots.push('')
    renderProjectLots(parent, settings, onChange)
    const inputs = list.querySelectorAll<HTMLInputElement>('.pm-lots-row:not(.is-locked) input')
    inputs[inputs.length - 1]?.focus()
  })
}
