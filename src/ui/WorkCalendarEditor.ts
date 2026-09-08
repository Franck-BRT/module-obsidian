import type { PMSettings } from '../types'
import { WEEKDAY_LABELS } from '../store/WorkCalendar'

/** Monday first, matching how a working week is usually written down. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7]

/**
 * Seven toggles for the working week. At least one day always stays on: a week with
 * no working day would leave the scheduler with nowhere to put anything.
 */
export function renderWorkingWeekdays(container: HTMLElement, settings: PMSettings, onChange: () => void): void {
  const row = container.createDiv('pm-weekday-row')
  for (const day of WEEKDAY_ORDER) {
    const label = WEEKDAY_LABELS[day]
    const button = row.createEl('button', {
      cls: 'pm-weekday-toggle',
      text: label.slice(0, 3),
      attr: { type: 'button', 'aria-label': label }
    })
    const paint = (): void => {
      const on = settings.workingWeekdays.includes(day)
      button.toggleClass('pm-weekday-toggle--on', on)
      button.setAttribute('aria-pressed', String(on))
    }
    paint()
    button.addEventListener('click', () => {
      const at = settings.workingWeekdays.indexOf(day)
      if (at === -1) settings.workingWeekdays.push(day)
      else if (settings.workingWeekdays.length > 1) settings.workingWeekdays.splice(at, 1)
      else return
      settings.workingWeekdays.sort((a, b) => a - b)
      paint()
      onChange()
    })
  }
}

/** One YYYY-MM-DD per line. Anything else is dropped when the calendar is built. */
export function renderHolidays(container: HTMLElement, settings: PMSettings, onChange: () => void): void {
  const area = container.createEl('textarea', {
    cls: 'pm-holiday-input',
    attr: { rows: '4', placeholder: '2026-12-25\n2026-12-26', spellcheck: 'false' }
  })
  area.value = settings.holidays.join('\n')
  const commit = (): void => {
    const dates = area.value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    settings.holidays = [...new Set(dates)].sort()
    onChange()
  }
  area.addEventListener('blur', () => {
    commit()
    area.value = settings.holidays.join('\n')
  })
}

/** Flags entries the calendar will ignore, so a typo doesn't fail silently. */
export function invalidHolidays(holidays: string[]): string[] {
  return holidays.filter((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h))
}
