import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES, PALETTE_RESTEPS } from '../types'
import { restepPalette } from './paletteRestep'

const FIRST = PALETTE_RESTEPS[0] ?? {}
const SECOND = PALETTE_RESTEPS[1] ?? {}
const THIRD = PALETTE_RESTEPS[2] ?? {}

describe('re-stepping a colour a vault may still carry', () => {
  it('swaps an untouched old default for the new one', () => {
    const palette = [{ color: '#b8a06b' }, { color: '#79b58d' }]
    expect(restepPalette(palette, FIRST)).toBe(true)
    expect(palette.map((p) => p.color)).toEqual(['#b76b1c', '#06915f'])
  })

  it('leaves a colour the user chose alone, and says nothing changed', () => {
    const palette = [{ color: '#ff0000' }, { color: '#123456' }]
    expect(restepPalette(palette, FIRST)).toBe(false)
    expect(palette.map((p) => p.color)).toEqual(['#ff0000', '#123456'])
  })

  it('matches however the hex was spelled', () => {
    const palette = [{ color: '#B8A06B' }]
    expect(restepPalette(palette, FIRST)).toBe(true)
    expect(palette[0]?.color).toBe('#b76b1c')
  })

  it('is idempotent: a palette already re-stepped does not move again', () => {
    expect(restepPalette([{ color: '#b76b1c' }, { color: '#06915f' }], FIRST)).toBe(false)
  })

  it('touches only its own pass, so a vault can be walked forward one at a time', () => {
    const palette = [{ color: '#b8a06b' }, { color: '#767491' }]
    expect(restepPalette(palette, FIRST)).toBe(true)
    // The cancelled purple belongs to the later pass and is still waiting.
    expect(palette[1]?.color).toBe('#767491')
    expect(restepPalette(palette, SECOND)).toBe(true)
    expect(palette[1]?.color).toBe('#367794')
  })

  it('walks a vault that has had none of them through every pass', () => {
    const palette = [{ color: '#b8a06b' }, { color: '#79b58d' }, { color: '#767491' }, { color: '#c47070' }]
    for (const pass of PALETTE_RESTEPS) restepPalette(palette, pass)
    expect(palette.map((p) => p.color)).toEqual(['#b16a08', '#06915f', '#367794', '#f83e54'])
  })

  it('carries a colour through two passes when a later one moves it again', () => {
    // The review amber was re-stepped once, then again: a vault that had neither must
    // end on the second value, not stop at the first.
    const palette = [{ color: '#b8a06b' }]
    restepPalette(palette, FIRST)
    expect(palette[0]?.color).toBe('#b76b1c')
    restepPalette(palette, THIRD)
    expect(palette[0]?.color).toBe('#b16a08')
  })
})

describe('the palettes a fresh install starts with', () => {
  it('carries none of the colours a pass has replaced', () => {
    const colors = [...DEFAULT_STATUSES, ...DEFAULT_PRIORITIES].map((entry) => entry.color)
    for (const pass of PALETTE_RESTEPS) for (const old of Object.keys(pass)) expect(colors).not.toContain(old)
  })

  it('carries the new ones instead, in both palettes', () => {
    expect(DEFAULT_STATUSES.find((s) => s.id === 'review')?.color).toBe('#b16a08')
    expect(DEFAULT_STATUSES.find((s) => s.id === 'blocked')?.color).toBe('#f83e54')
    expect(DEFAULT_STATUSES.find((s) => s.id === 'done')?.color).toBe('#06915f')
    // The same two hexes were the priority palette's High and Low, so they had the same
    // defect: one fix, both palettes.
    expect(DEFAULT_PRIORITIES.find((p) => p.id === 'high')?.color).toBe('#b16a08')
    expect(DEFAULT_PRIORITIES.find((p) => p.id === 'critical')?.color).toBe('#f83e54')
    expect(DEFAULT_PRIORITIES.find((p) => p.id === 'low')?.color).toBe('#06915f')
    expect(DEFAULT_STATUSES.find((s) => s.id === 'cancelled')?.color).toBe('#367794')
  })
})
