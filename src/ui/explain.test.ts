import { describe, expect, it } from 'vitest'
import { placeBubble } from './explain'

describe('where a button’s explanation shows', () => {
  const viewport = { width: 1000, height: 800 }
  const size = { width: 300, height: 80 }

  it('is under the button, centred on it', () => {
    expect(placeBubble({ left: 400, right: 500, top: 100, bottom: 130 }, size, viewport)).toEqual({
      left: 300,
      top: 138
    })
  })

  it('stays on screen at either edge', () => {
    expect(placeBubble({ left: 960, right: 990, top: 100, bottom: 130 }, size, viewport).left).toBe(692)
    expect(placeBubble({ left: 0, right: 20, top: 100, bottom: 130 }, size, viewport).left).toBe(8)
  })

  it('goes above when there is no room below', () => {
    expect(placeBubble({ left: 400, right: 500, top: 740, bottom: 770 }, size, viewport).top).toBe(652)
  })
})
