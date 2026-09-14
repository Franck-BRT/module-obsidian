import { describe, expect, it } from 'vitest'
import { VIEW_MODES } from '../types'
import { viewModeLabel, viewModeOptions } from './viewModes'

/**
 * A view missing from these options is a view a project can never be set to open on —
 * which is exactly what had happened to the library and the dashboard.
 */
describe('choosing which view a project opens on', () => {
  it('offers every view the switcher offers, in the same order', () => {
    expect(viewModeOptions().map((option) => option.id)).toEqual([...VIEW_MODES])
  })

  it('gives each one a name, and no two the same', () => {
    const labels = VIEW_MODES.map(viewModeLabel)
    expect(labels.every((label) => label.length > 0)).toBe(true)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
