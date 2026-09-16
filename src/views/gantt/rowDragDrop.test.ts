import { describe, expect, it } from 'vitest'
import { makeTask } from '../../types'
import { dropZoneFor } from './rowDragDrop'

const lot = makeTask({ title: 'Lot', type: 'phase' })
const ticket = makeTask({ title: 'Tâche' })

describe('the drop a row offers', () => {
  it('lets a lot be dropped into, which is the only way into a folded one', () => {
    expect(dropZoneFor(lot, 0.5)).toBe('inside')
    expect(dropZoneFor(lot, 0.3)).toBe('inside')
    expect(dropZoneFor(lot, 0.7)).toBe('inside')
  })

  it('keeps the edges of a lot for placing something beside it', () => {
    expect(dropZoneFor(lot, 0)).toBe('before')
    expect(dropZoneFor(lot, 0.2)).toBe('before')
    expect(dropZoneFor(lot, 0.8)).toBe('after')
    expect(dropZoneFor(lot, 1)).toBe('after')
  })

  it('never drops into a plain ticket, which would make it a parent by accident', () => {
    for (const ratio of [0, 0.25, 0.49, 0.5, 0.75, 1]) {
      expect(dropZoneFor(ticket, ratio)).not.toBe('inside')
    }
    expect(dropZoneFor(ticket, 0.49)).toBe('before')
    expect(dropZoneFor(ticket, 0.51)).toBe('after')
  })
})
