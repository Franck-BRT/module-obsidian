import { describe, expect, it } from 'vitest'
import { charWidth, textWidth, wrapText } from './pdfFont'

describe('how wide Helvetica draws it', () => {
  // The values every PDF reader uses for Helvetica. If these drift, every line this
  // plugin breaks is broken in the wrong place.
  it('knows the widths the readers know', () => {
    expect(charWidth(' ')).toBe(278)
    expect(charWidth('M')).toBe(833)
    expect(charWidth('i')).toBe(222)
    expect(charWidth('0')).toBe(556)
  })

  // An accent takes no room of its own in Helvetica.
  it('gives an accented letter the width of the letter under it', () => {
    expect(charWidth('é')).toBe(charWidth('e'))
    expect(charWidth('À')).toBe(charWidth('A'))
    expect(charWidth('ç')).toBe(charWidth('c'))
  })

  it('has a width for the typography a French document uses', () => {
    expect(charWidth('’')).toBe(222)
    expect(charWidth('—')).toBe(1000)
    expect(charWidth('°')).toBe(400)
  })

  it('measures a string at the size it will be drawn', () => {
    expect(textWidth('ii', 10)).toBeCloseTo(4.44, 2)
    expect(textWidth('ii', 20)).toBeCloseTo(8.88, 2)
  })
})

describe('wrapText', () => {
  const width = (lines: string[], size: number) => Math.max(...lines.map((line) => textWidth(line, size)))

  it('breaks at the spaces, and nowhere else it can help it', () => {
    const lines = wrapText('un deux trois quatre cinq six sept huit neuf dix', 10, 60)
    expect(width(lines, 10)).toBeLessThanOrEqual(60)
    expect(lines.join(' ')).toBe('un deux trois quatre cinq six sept huit neuf dix')
  })

  // An identifier in a narrow column has to go somewhere, and a line running past the
  // margin is worse than one broken mid-word.
  it('cuts a word that is wider than the column', () => {
    const lines = wrapText('REQ-THERM-0001-SOUTE-AVANT', 10, 40)
    expect(lines.length).toBeGreaterThan(1)
    expect(width(lines, 10)).toBeLessThanOrEqual(40)
    expect(lines.join('')).toBe('REQ-THERM-0001-SOUTE-AVANT')
  })

  it('keeps the breaks the text already had', () => {
    expect(wrapText('un\ndeux', 10, 500)).toEqual(['un', 'deux'])
  })

  // A caller measuring a paragraph's height must never measure nothing for text that is
  // there.
  it('always gives back a line', () => {
    expect(wrapText('', 10, 100)).toEqual([''])
  })
})
