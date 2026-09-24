import { describe, expect, it } from 'vitest'
import { para, type DocxDocument, type DocxTable } from './docx'
import { toHtml } from './htmlDoc'

const doc = (blocks: DocxDocument['blocks']): DocxDocument => ({ title: 'Spécification', blocks })

describe('a document as one page', () => {
  // A file that arrives alone half the time, and a specification that lands as unstyled
  // text reads as a draft somebody forgot to finish.
  it('carries everything it needs inside itself', () => {
    const html = toHtml(doc([para('Title', 'Spécification')]))
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<style>')
    expect(html).not.toMatch(/<(link|script|img)\b/)
  })

  it('names the page after the document', () => {
    expect(toHtml(doc([]))).toContain('<title>Spécification</title>')
  })

  it('gives the title the page’s one first-level heading and moves the rest down', () => {
    const html = toHtml(doc([para('Title', 'T'), para('Heading1', 'A'), para('Heading2', 'B'), para('Heading3', 'C')]))
    expect(html).toContain('<h1>T</h1>')
    expect(html).toContain('<h2>A</h2>')
    expect(html).toContain('<h3>B</h3>')
    expect(html).toContain('<h4>C</h4>')
  })

  it('escapes what would otherwise be markup', () => {
    expect(toHtml(doc([para('Normal', '<script>alert(1)</script>')]))).toContain('&lt;script&gt;')
  })

  // An emphasis wrapped around a line break is a break inside a phrase that was never
  // emphasised.
  it('puts the emphasis around the words and not around the break before them', () => {
    const html = toHtml(
      doc([{ kind: 'p', style: 'Normal', runs: [{ text: 'a' }, { text: '\nen retard', italic: true }] }])
    )
    expect(html).toContain('a<br><em>en retard</em>')
  })

  it('keeps the emphasis the runs carried', () => {
    const html = toHtml(
      doc([{ kind: 'p', style: 'Normal', runs: [{ text: 'a ' }, { text: 'gras', bold: true }, { text: ' b' }] }])
    )
    expect(html).toContain('a <strong>gras</strong> b')
  })

  // Consecutive bullets are one list, not four.
  it('gathers the bullets into a single list', () => {
    const html = toHtml(doc([para('Bullet', 'un'), para('Bullet', 'deux'), para('Normal', 'après')]))
    expect(html).toContain('<ul><li>un</li><li>deux</li></ul>')
    expect([...html.matchAll(/<ul>/g)]).toHaveLength(1)
  })

  it('closes the list before whatever follows it', () => {
    expect(toHtml(doc([para('Bullet', 'un'), para('Normal', 'après')]))).toContain('</ul>\n<p>après</p>')
  })

  it('writes a quote as a quote and a remark as a remark', () => {
    const html = toHtml(doc([para('Quote', 'citée'), para('Meta', 'introuvable')]))
    expect(html).toContain('<blockquote><p>citée</p></blockquote>')
    expect(html).toContain('<p class="meta">introuvable</p>')
  })

  it('says what it is and when it was taken, at the foot of the page', () => {
    const html = toHtml(doc([]), { meta: { exported: '2026-09-24', source: 'Specs/Thermique.md', kicker: 'Snapshot' } })
    expect(html).toContain('<p class="kicker">Snapshot</p>')
    expect(html).toContain('<footer>2026-09-24 · Specs/Thermique.md</footer>')
  })
})

describe('a table as one page', () => {
  const table: DocxTable = {
    kind: 'table',
    header: [
      { runs: [{ text: 'Identifiant' }], width: 2000 },
      { runs: [{ text: 'Énoncé' }], width: 7000 }
    ],
    rows: [
      [
        { runs: [{ text: 'REQ-THERM-0001' }], width: 2000 },
        { runs: [{ text: 'Entre 5 et 30 °C.' }, { text: '\nAffichée en FR', italic: true }], width: 7000 }
      ]
    ]
  }

  it('heads its columns, so a reader and a screen reader both know what they are', () => {
    const html = toHtml(doc([table]))
    expect(html).toContain('<th scope="col">Identifiant</th>')
    expect(html).toContain('<thead>')
    expect(html).toContain('<tbody>')
  })

  it('turns a line break inside a cell into one the page shows', () => {
    expect(toHtml(doc([table]))).toContain('Entre 5 et 30 °C.<br><em>Affichée en FR</em>')
  })

  /**
   * A review that can send a link to one requirement is a review that stops describing
   * which one it means. The rule for what is addressable belongs to the caller: this
   * file has no idea what an identifier looks like and should not learn.
   */
  it('makes a row addressable when the caller recognises what it names', () => {
    const html = toHtml(doc([table]), { anchor: (text) => (text.startsWith('REQ-') ? text : undefined) })
    expect(html).toContain('<tr id="REQ-THERM-0001">')
  })

  // An identifier split over a line end is one nobody can read back or search for.
  it('keeps a name on one line', () => {
    const html = toHtml(doc([table]), { anchor: (text) => (text.startsWith('REQ-') ? text : undefined) })
    expect(html).toContain('<td class="name">REQ-THERM-0001</td>')
    expect(html).toContain('td.name { white-space: nowrap; }')
  })

  it('leaves the rows alone when nobody said what is addressable', () => {
    expect(toHtml(doc([table]))).toContain('<tr>')
  })

  // A table that runs over a page has to keep naming its columns.
  it('repeats the header when the page is printed', () => {
    expect(toHtml(doc([table]))).toContain('thead { display: table-header-group; }')
  })
})
