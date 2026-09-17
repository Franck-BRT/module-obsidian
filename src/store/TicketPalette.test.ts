import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DOC_STATES, DEFAULT_MEETING_KINDS, DEFAULT_TYPES, makeDocument, makeTask, type Task } from '../types'
import {
  docStateConfigOf,
  meetingKindConfigOf,
  setTicketAppearance,
  showsTypeBadge,
  typeConfigOf
} from './TicketPalette'

const appearance = (badges: 'none' | 'distinct' | 'all') => ({
  types: DEFAULT_TYPES,
  docStates: DEFAULT_DOC_STATES,
  meetingKinds: DEFAULT_MEETING_KINDS,
  badges
})

const task = (over: Partial<Task> = {}): Task => makeTask({ title: 'x', ...over })

afterEach(() => setTicketAppearance(appearance('distinct')))

describe('the palette a ticket is marked with', () => {
  it('answers with what the settings hold', () => {
    setTicketAppearance({
      ...appearance('distinct'),
      types: [{ id: 'milestone', label: 'Étape clé', color: '#123456', icon: 'flag' }]
    })
    expect(typeConfigOf('milestone')).toMatchObject({ label: 'Étape clé', color: '#123456' })
  })

  it('falls back to the built-in entry rather than drawing nothing', () => {
    // A settings file written before a kind existed, or edited by hand down to one row.
    setTicketAppearance({ ...appearance('distinct'), types: [], docStates: [], meetingKinds: [] })
    expect(typeConfigOf('phase')).toEqual(DEFAULT_TYPES.find((entry) => entry.id === 'phase'))
    expect(docStateConfigOf('approved')).toEqual(DEFAULT_DOC_STATES.find((entry) => entry.id === 'approved'))
  })

  it('gives every kind and every document state a glyph of its own', () => {
    // Colour is the accent here, never the only channel: five hues cannot all be told
    // apart without full colour vision, and these sit beside the status palette.
    const icons = DEFAULT_TYPES.map((entry) => entry.icon)
    expect(new Set(icons).size).toBe(DEFAULT_TYPES.length)
    expect(icons.every(Boolean)).toBe(true)
    const stateIcons = DEFAULT_DOC_STATES.map((entry) => entry.icon)
    expect(new Set(stateIcons).size).toBe(DEFAULT_DOC_STATES.length)
    expect(stateIcons.every(Boolean)).toBe(true)
  })
})

describe('which tickets say their kind', () => {
  it('leaves the plain task alone by default, and marks the rest', () => {
    setTicketAppearance(appearance('distinct'))
    expect(showsTypeBadge(task({ type: 'task' }))).toBe(false)
    expect(showsTypeBadge(task({ type: 'milestone' }))).toBe(true)
    expect(showsTypeBadge(task({ type: 'phase' }))).toBe(true)
    expect(showsTypeBadge(task({ type: 'subtask' }))).toBe(true)
  })

  it('marks the plain task too when asked, and nothing when told not to', () => {
    setTicketAppearance(appearance('all'))
    expect(showsTypeBadge(task({ type: 'task' }))).toBe(true)
    setTicketAppearance(appearance('none'))
    expect(showsTypeBadge(task({ type: 'milestone' }))).toBe(false)
  })

  it('never marks a document twice: its own badge already says what it is', () => {
    const doc = task({ type: 'document', document: makeDocument({ reference: 'STB-01' }) })
    for (const mode of ['distinct', 'all'] as const) {
      setTicketAppearance(appearance(mode))
      expect(showsTypeBadge(doc)).toBe(false)
    }
  })
})

describe('how a meeting is marked', () => {
  it('says what it is about rather than that it is a meeting', () => {
    const meeting = task({ type: 'meeting', meetingKind: 'technical' })
    expect(meetingKindConfigOf(meeting)).toMatchObject({ id: 'technical' })
    // Once, not twice: the kind badge replaces the type badge.
    expect(showsTypeBadge(meeting)).toBe(false)
  })

  it('still says it is a meeting when it does not say what about', () => {
    const meeting = task({ type: 'meeting' })
    expect(meetingKindConfigOf(meeting)).toBeNull()
    expect(showsTypeBadge(meeting)).toBe(true)
  })

  /** A kind deleted from the settings must not be renamed as some other kind. */
  it('claims nothing about a meeting whose kind has been deleted', () => {
    const meeting = task({ type: 'meeting', meetingKind: 'gone-kind' })
    expect(meetingKindConfigOf(meeting)).toBeNull()
    expect(showsTypeBadge(meeting)).toBe(true)
  })

  it('never reads a kind off something that is not a meeting', () => {
    expect(meetingKindConfigOf(task({ type: 'task', meetingKind: 'technical' }))).toBeNull()
  })

  it('gives every meeting kind a glyph of its own', () => {
    const icons = DEFAULT_MEETING_KINDS.map((kind) => kind.icon)
    expect(new Set(icons).size).toBe(DEFAULT_MEETING_KINDS.length)
  })
})
