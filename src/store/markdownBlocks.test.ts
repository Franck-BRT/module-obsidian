import { describe, expect, it } from 'vitest'
import { DOCX_TEXT_WIDTH } from './docx'
import { inlineRuns, markdownBlocks } from './markdownBlocks'

describe('inlineRuns', () => {
  it('reads bold and italic, and keeps an underscore inside a word', () => {
    expect(inlineRuns('a **gras** et *italique* ou _aussi_ GC_PL_002')).toEqual([
      { text: 'a ' },
      { text: 'gras', bold: true },
      { text: ' et ' },
      { text: 'italique', italic: true },
      { text: ' ou ' },
      { text: 'aussi', italic: true },
      { text: ' GC_PL_002' }
    ])
  })

  it('makes links the words they show, and an escaped mark the mark', () => {
    expect(inlineRuns('[[Projets/B12|le projet]], [[Plan RDC]], [site](https://x.fr), 5 \\* 3, a<br>b')).toEqual([
      { text: 'le projet, Plan RDC, site, 5 * 3, a\nb' }
    ])
  })
})

describe('markdownBlocks', () => {
  it('reads headings, paragraphs with their line breaks, quotes and lists', () => {
    const blocks = markdownBlocks(
      '---\ntype: x\n---\n%% note\nà moi %%\n# Titre\n\nligne 1\nligne 2\n\n## Partie\n### Sous\n> cité\n> encore\n- un\n- deux\n\n&nbsp;\n---\n![[logo.png]]'
    )
    expect(
      blocks.map((block) =>
        block.kind === 'p' ? [block.style, block.runs.map((run) => run.text).join('')] : ['table']
      )
    ).toEqual([
      ['Title', 'Titre'],
      ['Normal', 'ligne 1\nligne 2'],
      ['Heading1', 'Partie'],
      ['Heading2', 'Sous'],
      ['Quote', 'cité\nencore'],
      ['Bullet', 'un'],
      ['Bullet', 'deux'],
      ['Normal', '']
    ])
  })

  it('reads a table, its header bold, its widths the line’s', () => {
    const [table] = markdownBlocks(
      '| Réf | Titre |\n|:---|---:|\n| A-1 | Un titre bien plus long que la référence |\n| B\\|2 | x<br>y |'
    )
    if (table.kind !== 'table') throw new Error('no table')
    expect(table.header.map((cell) => cell.runs)).toEqual([
      [{ text: 'Réf', bold: true }],
      [{ text: 'Titre', bold: true }]
    ])
    expect(table.rows.map((row) => row.map((cell) => cell.runs.map((run) => run.text).join('')))).toEqual([
      ['A-1', 'Un titre bien plus long que la référence'],
      ['B|2', 'x\ny']
    ])
    const widths = table.header.map((cell) => cell.width)
    expect(widths.reduce((a, b) => a + b, 0)).toBe(DOCX_TEXT_WIDTH)
    expect(widths[1]).toBeGreaterThan(widths[0])
  })
})
