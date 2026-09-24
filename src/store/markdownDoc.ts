import type { DocxBlock, DocxCell, DocxDocument, DocxRun, DocxStyle } from './docx'

/**
 * The same document, written as Markdown.
 *
 * The fourth thing built from the one document model, after Word, PDF and the deck, and
 * the only one of them somebody can read in a terminal, put under git and see the diff
 * of. A specification that leaves as Markdown leaves as text: no reader required, no
 * format to be wrong about in ten years.
 *
 * What it gives up is layout. A Markdown table is as wide as its widest cell and a
 * paragraph is a paragraph, so the column widths and the page breaks the other three
 * carry are dropped here rather than approximated.
 */

export interface MarkdownMeta {
  /** When the snapshot was taken. A document that does not say is a document nobody trusts. */
  exported: string
  /** The note it was flattened from, so a reader can go back to the live one. */
  source?: string
}

/**
 * A run, with its emphasis.
 *
 * The markers go around the words and never around the spaces: Markdown does not open an
 * emphasis on whitespace, so `* mot *` is three asterisks and a word rather than an
 * italic. A mark written under a wording arrives with the newline in front of it, which
 * is exactly that case.
 */
function runMd(run: DocxRun): string {
  const text = run.text.replace(/\r/g, '')
  const marks = run.bold && run.italic ? '***' : run.bold ? '**' : run.italic ? '*' : ''
  if (!marks || !text.trim()) return text
  const lead = text.slice(0, text.length - text.trimStart().length)
  const tail = text.slice(text.trimEnd().length)
  return `${lead}${marks}${text.trim()}${marks}${tail}`
}

function paraMd(runs: DocxRun[]): string {
  return runs.map(runMd).join('')
}

const HEADING: Partial<Record<DocxStyle, string>> = {
  // The title takes the one first-level heading, so everything under it moves down a
  // level: two `#` in a document is two documents as far as most readers are concerned.
  Title: '# ',
  Heading1: '## ',
  Heading2: '### ',
  Heading3: '#### '
}

/**
 * A cell, made safe for a table.
 *
 * A pipe would end the column and a newline would end the row, so the first is escaped
 * and the second becomes a line break the renderer understands. Both are common in a
 * requirement: "3 V | 5 V" and a wording marked as behind its source.
 */
export function cellMd(cell: DocxCell): string {
  return paraMd(cell.runs).replace(/\|/g, '\\|').replace(/\n+/g, '<br>').trim()
}

function tableMd(block: Extract<DocxBlock, { kind: 'table' }>): string[] {
  const head = block.header.map(cellMd)
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...block.rows.map((row) => `| ${row.map(cellMd).join(' | ')} |`),
    ''
  ]
}

export function toMarkdown(doc: DocxDocument, meta?: MarkdownMeta): string {
  const lines: string[] = []
  if (meta) {
    lines.push(
      '---',
      `title: ${JSON.stringify(doc.title)}`,
      `exported: ${JSON.stringify(meta.exported)}`,
      ...(meta.source ? [`source: ${JSON.stringify(meta.source)}`] : []),
      '---',
      ''
    )
  }

  let listed = false
  for (const block of doc.blocks) {
    // A line straight after a list, with nothing between, is read as more of the last
    // item. The blank line is what ends the list.
    const bullet = block.kind === 'p' && block.style === 'Bullet'
    if (listed && !bullet) lines.push('')
    listed = bullet

    if (block.kind === 'table') {
      lines.push(...tableMd(block))
      continue
    }
    const text = paraMd(block.runs)
    if (!text.trim()) continue
    const style = block.style ?? 'Normal'
    const heading = HEADING[style]
    if (heading) lines.push(`${heading}${text}`, '')
    else if (style === 'Quote') lines.push(...text.split('\n').map((line) => `> ${line}`), '')
    else if (style === 'Bullet') lines.push(`- ${text}`)
    // A note under something, and the one place italics are added rather than kept: a
    // requirement the library does not hold has to read as a remark, not as prose.
    else if (style === 'Meta') lines.push(`*${text}*`, '')
    else lines.push(text, '')
  }

  // One trailing newline, and never a run of blank lines: a bullet list followed by a
  // paragraph must not become two lists.
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}
