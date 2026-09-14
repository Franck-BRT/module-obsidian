import { describe, expect, it } from 'vitest'
import { VIEW_MODES } from '../types'
import { SUBVIEW_CLASS, SUBVIEW_CLASSES } from './subviewClasses'

/**
 * The list is only useful if it is complete: a class a sub-view adds and this list does
 * not name is a class nothing ever removes, and the next view inherits its layout. The
 * type already refuses a view without a class; these check what the type cannot — that
 * the flat list really carries every one, and that no two views wear the same class.
 */
describe('the classes a sub-view leaves on the shared body', () => {
  it('carries one for every view the switcher offers', () => {
    expect(SUBVIEW_CLASSES).toHaveLength(VIEW_MODES.length)
    for (const mode of VIEW_MODES) expect(SUBVIEW_CLASSES).toContain(SUBVIEW_CLASS[mode])
  })

  it('gives each view a class of its own', () => {
    expect(new Set(SUBVIEW_CLASSES).size).toBe(SUBVIEW_CLASSES.length)
  })
})
