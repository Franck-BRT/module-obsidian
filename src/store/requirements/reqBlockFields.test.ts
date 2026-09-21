import { describe, expect, it } from 'vitest'
import { cleanBlockFields, DEFAULT_REQ_BLOCK_FIELDS, resolveBlockFields } from './reqBlockFields'

describe('cleanBlockFields', () => {
  it('keeps what it can draw, in the order it was given', () => {
    expect(cleanBlockFields(['status', 'id', 'rating'])).toEqual(['status', 'id', 'rating'])
  })

  // A settings file is a file, and a file can be edited by hand or written by a build
  // that knew a column this one does not.
  it('drops a column this build has never heard of', () => {
    expect(cleanBlockFields(['id', 'couleur', 'text'])).toEqual(['id', 'text'])
  })

  it('keeps a repeated column once, so it is not drawn twice', () => {
    expect(cleanBlockFields(['id', 'text', 'id'])).toEqual(['id', 'text'])
  })

  // Three lines need two of them, so this is the one entry that repeats.
  it('keeps every line break it was given', () => {
    expect(cleanBlockFields(['id', 'break', 'title', 'break', 'rating'])).toEqual([
      'id',
      'break',
      'title',
      'break',
      'rating'
    ])
  })

  it('makes nothing at all out of something that is not a list', () => {
    expect(cleanBlockFields('id, text')).toEqual([])
    expect(cleanBlockFields(undefined)).toEqual([])
  })
})

describe('resolveBlockFields', () => {
  it('lets the block decide, whatever the settings hold', () => {
    expect(resolveBlockFields(['id', 'title'], ['id', 'text', 'status', 'rating'])).toEqual(['id', 'title'])
  })

  it('takes the settings when the block named no columns', () => {
    expect(resolveBlockFields([], ['id', 'title', 'text'])).toEqual(['id', 'title', 'text'])
  })

  // A block reduced to a blank rectangle reads as a bug in the document, and nobody
  // would think to go and blame the settings for it.
  it('falls back to the built-in list rather than drawing nothing', () => {
    expect(resolveBlockFields([], [])).toEqual(DEFAULT_REQ_BLOCK_FIELDS)
    expect(resolveBlockFields([], ['couleur'])).toEqual(DEFAULT_REQ_BLOCK_FIELDS)
  })

  // Line breaks alone would draw two empty lines and nothing else, which reads as a
  // broken document rather than as a list somebody emptied.
  it('treats a list of nothing but line breaks as nothing at all', () => {
    expect(resolveBlockFields([], ['break', 'break'])).toEqual(DEFAULT_REQ_BLOCK_FIELDS)
    expect(resolveBlockFields(['break'], ['id', 'title'])).toEqual(['id', 'title'])
  })

  it('does not hand out the built-in list itself, which a caller could then sort', () => {
    const got = resolveBlockFields([], [])
    got.push('title')
    expect(DEFAULT_REQ_BLOCK_FIELDS).not.toContain('title')
  })
})
