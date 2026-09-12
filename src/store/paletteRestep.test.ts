import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES, RESTEPPED_COLORS } from '../types'
import { restepPalette } from './paletteRestep'

describe('re-stepping the two colours a vault may still carry', () => {
  it('swaps an untouched old default for the new one', () => {
    const palette = [{ color: '#b8a06b' }, { color: '#79b58d' }]
    expect(restepPalette(palette)).toBe(true)
    expect(palette.map((p) => p.color)).toEqual(['#b76b1c', '#06915f'])
  })

  it('leaves a colour the user chose alone, and says nothing changed', () => {
    const palette = [{ color: '#ff0000' }, { color: '#123456' }]
    expect(restepPalette(palette)).toBe(false)
    expect(palette.map((p) => p.color)).toEqual(['#ff0000', '#123456'])
  })

  it('matches however the hex was spelled', () => {
    const palette = [{ color: '#B8A06B' }]
    expect(restepPalette(palette)).toBe(true)
    expect(palette[0]?.color).toBe('#b76b1c')
  })

  it('is idempotent: a palette already re-stepped does not move again', () => {
    const palette = [{ color: '#b76b1c' }, { color: '#06915f' }]
    expect(restepPalette(palette)).toBe(false)
  })
})

describe('the palettes a fresh install starts with', () => {
  it('carries neither of the two colours that were hard to tell apart', () => {
    const colors = [...DEFAULT_STATUSES, ...DEFAULT_PRIORITIES].map((entry) => entry.color)
    for (const old of Object.keys(RESTEPPED_COLORS)) expect(colors).not.toContain(old)
  })

  it('carries the new ones instead, in both palettes', () => {
    expect(DEFAULT_STATUSES.find((s) => s.id === 'review')?.color).toBe('#b76b1c')
    expect(DEFAULT_STATUSES.find((s) => s.id === 'done')?.color).toBe('#06915f')
    // The same two hexes were the priority palette's High and Low, so they had the same
    // defect: one fix, both palettes.
    expect(DEFAULT_PRIORITIES.find((p) => p.id === 'high')?.color).toBe('#b76b1c')
    expect(DEFAULT_PRIORITIES.find((p) => p.id === 'low')?.color).toBe('#06915f')
  })
})
