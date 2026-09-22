import { describe, expect, it } from 'vitest'
import { readZipEntries } from '../../test/readZip'
import { bodySize, buildPptx, pptxParts, SLIDE, type PptxDeck, type PptxSlide } from './pptx'

const slide = (over: Partial<PptxSlide> = {}): PptxSlide => ({
  eyebrow: 'REQ-THERM-0001',
  title: 'Maintien en température de la soute',
  body: [{ text: 'Le système doit maintenir la soute entre 5 °C et 30 °C.' }],
  footer: 'Approuvée  ·  Performance',
  ...over
})

const deck = (slides: PptxSlide[] = [slide()]): PptxDeck => ({ title: 'Revue', slides })

const part = (name: string, of: PptxDeck = deck()): string => {
  const found = pptxParts(of).find((entry) => entry.name === name)
  if (!found) throw new Error(`no part ${name}`)
  return new TextDecoder().decode(found.data)
}

describe('a slide', () => {
  const xml = part('ppt/slides/slide1.xml')

  it('carries its own position for every shape', () => {
    // Nothing inherited from a placeholder: a layout this file does not control is a
    // layout that can put the text somewhere else.
    expect([...xml.matchAll(/<a:off x="\d+" y="\d+"\/>/g)].length).toBeGreaterThanOrEqual(4)
  })

  it('writes the identifier above the title and the footer at the bottom', () => {
    expect(xml.indexOf('REQ-THERM-0001')).toBeLessThan(xml.indexOf('Maintien en'))
    expect(xml).toContain('Approuvée')
  })

  it('escapes what would otherwise close a tag', () => {
    expect(part('ppt/slides/slide1.xml', deck([slide({ title: 'a < b & "c"' })]))).toContain(
      'a &lt; b &amp; &quot;c&quot;'
    )
  })

  it('draws a bullet only where one was asked for', () => {
    const bulleted = part(
      'ppt/slides/slide1.xml',
      deck([slide({ body: [{ text: 'un', bullet: true }, { text: 'deux' }] })])
    )
    expect([...bulleted.matchAll(/<a:buChar/g)]).toHaveLength(1)
    expect([...bulleted.matchAll(/<a:buNone\/>/g)].length).toBeGreaterThanOrEqual(1)
  })

  // An override would be twelve attributes to get right for no gain, and a colour map a
  // slide gets wrong is a slide of white text on white.
  it('takes its colours from the master', () => {
    expect(xml).toContain('<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>')
  })

  it('leaves out the body box of a slide that has no body', () => {
    expect(part('ppt/slides/slide1.xml', deck([slide({ body: [] })]))).not.toContain('name="Body"')
  })
})

describe('bodySize', () => {
  // PowerPoint only shrinks overflowing text once somebody opens the box and edits it,
  // and a deck is shown straight from the file.
  it('shrinks the text of a requirement too long for the slide', () => {
    const long = Array.from({ length: 40 }, () => 'une phrase de longueur ordinaire').join(', ')
    expect(bodySize([{ text: long }])).toBeLessThan(bodySize([{ text: 'court' }]))
  })

  it('leaves a short statement at the size it was meant to be read at', () => {
    expect(bodySize([{ text: 'Le système doit ouvrir la trappe en 3 s.' }])).toBe(18)
  })

  it('never shrinks past what can be read in a room', () => {
    const huge = Array.from({ length: 400 }, () => 'phrase').join(' ')
    expect(bodySize([{ text: huge }])).toBeGreaterThanOrEqual(11)
  })
})

describe('the package', () => {
  const two = deck([slide(), slide({ title: 'Deuxième' })])

  it('declares, points at and writes every part', () => {
    const names = pptxParts(two).map((entry) => entry.name)
    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      'ppt/theme/theme1.xml',
      'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
      'ppt/slides/slide2.xml',
      'ppt/slides/_rels/slide2.xml.rels'
    ])
    const types = part('[Content_Types].xml', two)
    for (const name of names.filter((entry) => entry.endsWith('.xml') && !entry.includes('_rels'))) {
      if (name === '[Content_Types].xml') continue
      expect(types).toContain(`PartName="/${name}"`)
    }
  })

  // A master without a theme is a file PowerPoint offers to repair.
  it('gives the master a theme and a layout to point at', () => {
    const rels = part('ppt/slideMasters/_rels/slideMaster1.xml.rels', two)
    expect(rels).toContain('Target="../theme/theme1.xml"')
    expect(rels).toContain('Target="../slideLayouts/slideLayout1.xml"')
  })

  // The schema insists on three of each, and a theme short of one is a file that will
  // not open rather than a file that looks plainer.
  it('writes the three format lists the schema wants three of', () => {
    const theme = part('ppt/theme/theme1.xml', two)
    for (const list of ['fillStyleLst', 'lnStyleLst', 'effectStyleLst', 'bgFillStyleLst']) {
      expect(theme).toContain(`<a:${list}>`)
    }
    expect([...theme.matchAll(/<a:effectStyle>/g)]).toHaveLength(3)
  })

  it('lists each slide against the relationship that reaches it', () => {
    expect(part('ppt/presentation.xml', two)).toContain(
      '<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/>'
    )
    const rels = part('ppt/_rels/presentation.xml.rels', two)
    expect(rels).toContain(
      'Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"'
    )
  })

  it('is sixteen by nine, in the units the format measures in', () => {
    expect(part('ppt/presentation.xml', two)).toContain(
      `<p:sldSz cx="${SLIDE.width * 12700}" cy="${SLIDE.height * 12700}"/>`
    )
  })

  it('comes out of the archive the way an unzipper reads it', () => {
    for (const entry of readZipEntries(buildPptx(two, new Date('2026-09-22T10:00:00Z')))) {
      expect(entry.ok).toBe(true)
    }
  })
})
