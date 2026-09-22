import { describe, expect, it } from 'vitest'
import { para, type DocxDocument, type DocxTable } from './docx'
import { buildPdf, layoutPdf, PAGE, pdfString, TEXT_WIDTH, winAnsiByte, type PdfText } from './pdf'
import { textWidth } from './pdfFont'

const doc = (blocks: DocxDocument['blocks']): DocxDocument => ({ title: 'Spécification', blocks })
const texts = (page: ReturnType<typeof layoutPdf>[number]): PdfText[] =>
  page.filter((item): item is PdfText => item.kind === 'text')
const lineOf = (item: PdfText): string => item.spans.map((span) => span.text).join(' ')

const LONG =
  "Le système de conditionnement d'air doit maintenir la température de la soute entre 5 °C et 30 °C pendant toute la durée du vol, y compris au sol par 45 °C extérieurs et en croisière par moins quarante."

describe('laying out a page', () => {
  it('breaks a paragraph into lines that fit the page', () => {
    const [page] = layoutPdf(doc([para('Normal', LONG)]))
    const lines = texts(page)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      const last = line.spans[line.spans.length - 1]
      expect(last.x + textWidth(last.text, line.size)).toBeLessThanOrEqual(PAGE.margin + TEXT_WIDTH + 0.01)
    }
  })

  it('keeps every word, in order, across the lines it made', () => {
    const [page] = layoutPdf(doc([para('Normal', LONG)]))
    expect(texts(page).map(lineOf).join(' ')).toBe(LONG)
  })

  /**
   * A word can change style in the middle of itself, and a layout that put a space at
   * every run boundary would write "pm-req , et" — which is how you can tell, reading a
   * document, that a machine laid it out.
   */
  it('puts no space where the text had none, whatever the styling did', () => {
    const [page] = layoutPdf(
      doc([
        {
          kind: 'p',
          style: 'Normal',
          runs: [{ text: 'un bloc ' }, { text: 'pm-req', italic: true }, { text: ', et la suite' }]
        }
      ])
    )
    const spans = texts(page)[0].spans
    expect(spans.map((span) => span.text)).toEqual(['un', 'bloc', 'pm-req', ',', 'et', 'la', 'suite'])
    // The comma sits exactly where the word before it ended.
    const req = spans[2]
    expect(spans[3].x).toBeCloseTo(req.x + textWidth(req.text, texts(page)[0].size), 2)
  })

  // A hard break is something the author wrote, and a requirement on three lines means
  // something by being on three lines.
  it('ends the line where the text said to', () => {
    const [page] = layoutPdf(doc([para('Normal', 'un\ndeux')]))
    expect(texts(page).map(lineOf)).toEqual(['un', 'deux'])
  })

  it('starts a second page rather than writing past the bottom of the first', () => {
    const pages = layoutPdf(doc(Array.from({ length: 90 }, (_, i) => para('Normal', `Paragraphe ${i}.`))))
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      for (const item of texts(page)) expect(item.y).toBeGreaterThanOrEqual(PAGE.margin - 0.01)
    }
  })

  // A heading alone at the foot of a page belongs to what comes after it.
  it('does not leave a heading stranded at the bottom', () => {
    const blocks = [
      ...Array.from({ length: 52 }, (_, i) => para('Normal', `Paragraphe ${i}.`)),
      para('Heading2', 'Une section'),
      para('Normal', 'Son premier paragraphe.')
    ]
    const pages = layoutPdf(doc(blocks))
    const last = pages[pages.length - 1]
    const heading = texts(last).findIndex((item) => lineOf(item) === 'Une section')
    expect(heading).toBeGreaterThanOrEqual(0)
    expect(texts(last).length).toBeGreaterThan(heading + 1)
  })
})

describe('laying out a table', () => {
  const table = (rows: number, text: string): DocxTable => ({
    kind: 'table',
    header: [
      { runs: [{ text: 'Identifiant' }], width: 2000 },
      { runs: [{ text: 'Énoncé' }], width: 7638 }
    ],
    rows: Array.from({ length: rows }, (_, i) => [
      { runs: [{ text: `REQ-THERM-000${i}` }], width: 2000 },
      { runs: [{ text }], width: 7638 }
    ])
  })

  it('draws a box for every cell', () => {
    const [page] = layoutPdf(doc([table(2, 'Court.')]))
    expect(page.filter((item) => item.kind === 'rect')).toHaveLength(6)
  })

  // A column nobody can name is a column nobody can read.
  it('brings the header back at the top of every page the table runs onto', () => {
    const pages = layoutPdf(doc([table(40, LONG)]))
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) expect(texts(page).map(lineOf)).toContain('Identifiant')
  })

  /**
   * A requirement whose wording is longer than a page has to arrive in full. Moving the
   * row whole would loop forever, and cutting it short would lose the end of a
   * requirement in a document somebody signs.
   */
  it('continues a row that is taller than a page instead of losing it', () => {
    const huge = Array.from({ length: 400 }, (_, i) => `phrase numéro ${i}`).join(', ')
    const pages = layoutPdf(doc([table(1, huge)]))
    expect(pages.length).toBeGreaterThan(1)
    const written = pages
      .flatMap((page) => texts(page))
      .map(lineOf)
      .join(' ')
    expect(written).toContain('phrase numéro 0')
    expect(written).toContain('phrase numéro 399')
  })
})

describe('what a string becomes', () => {
  it('escapes the three characters that would end it', () => {
    expect(pdfString('a (b) \\ c')).toBe('(a \\(b\\) \\\\ c)')
  })

  it('writes an accent as the byte Helvetica draws', () => {
    expect(pdfString('é')).toBe('(\\351)')
    expect(winAnsiByte('é')).toBe(0xe9)
  })

  // The typographic corner of WinAnsi is the one a French document actually uses.
  it('knows the apostrophe and the dash this plugin writes', () => {
    expect(winAnsiByte('’')).toBe(0x92)
    expect(winAnsiByte('—')).toBe(0x97)
  })

  // Said out loud rather than dropped: a reader who sees one knows something was lost.
  it('turns a character Helvetica does not hold into a question mark', () => {
    expect(winAnsiByte('★')).toBe(0x3f)
  })
})

describe('the file', () => {
  /** Read back the way a reader does: through the table that says where each object is. */
  const objects = (bytes: Uint8Array): number => {
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-1.7')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    const start = Number(/startxref\s+(\d+)/.exec(text)?.[1])
    expect(text.slice(start, start + 4)).toBe('xref')
    const count = Number(/xref\n0 (\d+)/.exec(text)?.[1])
    for (let i = 1; i < count; i++) {
      const entry = /0 (\d+)\n((?:\d{10} \d{5} [fn] \n)+)/.exec(text.slice(start))
      expect(entry).not.toBeNull()
      const offset = Number(entry?.[2].split('\n')[i]?.slice(0, 10))
      expect(text.slice(offset, offset + `${i} 0 obj`.length)).toBe(`${i} 0 obj`)
    }
    return count - 1
  }

  it('says where each of its objects is, to the byte', () => {
    expect(objects(buildPdf(doc([para('Title', 'Spécification'), para('Normal', LONG)])))).toBeGreaterThan(7)
  })

  it('declares as many pages as it laid out', () => {
    const blocks = Array.from({ length: 90 }, (_, i) => para('Normal', `Paragraphe ${i}.`))
    const bytes = buildPdf(doc(blocks))
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text).toContain(`/Count ${layoutPdf(doc(blocks)).length}`)
  })

  // A Length that counted characters rather than bytes would leave the reader mid-stream.
  it('measures a stream in bytes, accents and all', () => {
    const text = new TextDecoder('latin1').decode(buildPdf(doc([para('Normal', 'éééé')])))
    const declared = Number(/\/Length (\d+) >>\nstream\n/.exec(text)?.[1])
    const body = text.slice(text.indexOf('stream\n') + 7, text.indexOf('\nendstream'))
    expect(body.length).toBe(declared)
  })
})
