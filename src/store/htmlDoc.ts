import type { DocxBlock, DocxCell, DocxDocument, DocxRun, DocxStyle } from './docx'
import { escapeXml } from './xml'

/**
 * The same document, as one page.
 *
 * The sixth thing built from the one document model, and the only one that needs nothing
 * at all to be read: a single file, no assets beside it, opens in any browser on any
 * machine, prints from there. It is what gets attached to an email to somebody who has
 * neither the vault nor Word.
 *
 * Everything is inline. A stylesheet beside the file is a file that arrives alone half
 * the time, and a specification that lands as unstyled text reads as a draft somebody
 * forgot to finish.
 */

export interface HtmlMeta {
  exported: string
  source?: string
  /** What the page says above the title, where a document usually carries its status. */
  kicker?: string
}

export interface HtmlOptions {
  meta?: HtmlMeta
  /**
   * An anchor for a cell that names something, so a reviewer can link to one row.
   *
   * Given by the caller rather than guessed here: this file has no idea what a
   * requirement identifier looks like, and should not learn.
   */
  anchor?: (text: string) => string | undefined
}

const STYLE = `
:root { color-scheme: light dark; --ink: #1a1a1a; --quiet: #5c5c5c; --rule: #d8d8d8; --paper: #ffffff; --band: #f6f6f6; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #e6e6e6; --quiet: #a0a0a0; --rule: #3a3a3a; --paper: #1b1b1b; --band: #242424; }
}
* { box-sizing: border-box; }
body {
  margin: 0 auto; padding: 48px 24px 96px; max-width: 60rem; background: var(--paper); color: var(--ink);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 1.5rem; }
h2 { font-size: 1.4rem; margin: 2.5rem 0 .75rem; }
h3 { font-size: 1.15rem; margin: 2rem 0 .5rem; }
h4 { font-size: 1rem; margin: 1.5rem 0 .5rem; }
p { margin: 0 0 1rem; }
ul { margin: 0 0 1rem; padding-left: 1.4rem; }
li { margin: .2rem 0; }
blockquote { margin: 0 0 1rem; padding: .1rem 0 .1rem 1rem; border-left: 3px solid var(--rule); color: var(--quiet); }
.meta { color: var(--quiet); font-size: .875rem; }
.kicker { color: var(--quiet); font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; margin: 0 0 .5rem; }
table { width: 100%; border-collapse: collapse; margin: 0 0 1.5rem; font-size: .9375rem; }
th, td { border: 1px solid var(--rule); padding: .5rem .625rem; text-align: left; vertical-align: top; }
th { background: var(--band); font-weight: 600; }
tbody tr:target { outline: 2px solid currentColor; outline-offset: -2px; }
td em { color: var(--quiet); }
td.name { white-space: nowrap; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--rule); color: var(--quiet); font-size: .8125rem; }
@media print {
  :root { --ink: #000; --quiet: #444; --rule: #999; --paper: #fff; --band: #f0f0f0; }
  @page { margin: 18mm; }
  body { max-width: none; padding: 0; font-size: 10.5pt; }
  /* A table that runs over a page has to keep naming its columns, and a row cut in two
     is a requirement nobody can quote. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  h2, h3, h4 { break-after: avoid; }
}
`

/** A newline the author wrote is a line break, in a cell as much as in a paragraph. */
function textHtml(text: string): string {
  return escapeXml(text).replace(/\n/g, '<br>')
}

/**
 * A run, with its emphasis around the words and not around the spaces.
 *
 * A mark written under a wording arrives with its newline in front of it, and an emphasis
 * wrapped around a line break is a break inside a phrase that was never emphasised.
 */
function runHtml(run: DocxRun): string {
  const open = run.bold && run.italic ? '<strong><em>' : run.bold ? '<strong>' : run.italic ? '<em>' : ''
  const close = run.bold && run.italic ? '</em></strong>' : run.bold ? '</strong>' : run.italic ? '</em>' : ''
  if (!open || !run.text.trim()) return textHtml(run.text)
  const lead = run.text.slice(0, run.text.length - run.text.trimStart().length)
  const tail = run.text.slice(run.text.trimEnd().length)
  return `${textHtml(lead)}${open}${textHtml(run.text.trim())}${close}${textHtml(tail)}`
}

function runsHtml(runs: DocxRun[]): string {
  return runs.map(runHtml).join('')
}

const TAG: Partial<Record<DocxStyle, string>> = {
  // The title takes the page's one first-level heading; everything under it moves down.
  Title: 'h1',
  Heading1: 'h2',
  Heading2: 'h3',
  Heading3: 'h4'
}

function cellHtml(cell: DocxCell, tag: 'th' | 'td', named: boolean): string {
  const scope = tag === 'th' ? ' scope="col"' : ''
  // A cell the caller recognised as a name is never broken across two lines: an
  // identifier split over a line end is one nobody can read back or search for.
  const cls = named ? ' class="name"' : ''
  return `<${tag}${scope}${cls}>${runsHtml(cell.runs)}</${tag}>`
}

function tableHtml(block: Extract<DocxBlock, { kind: 'table' }>, options: HtmlOptions): string {
  const head = `<tr>${block.header.map((cell) => cellHtml(cell, 'th', false)).join('')}</tr>`
  const rows = block.rows
    .map((row) => {
      // The identifier makes the row addressable: a review that can send a link to one
      // requirement is a review that stops describing which one it means.
      const names = row.map((cell) => options.anchor?.(cell.runs.map((run) => run.text).join('')))
      const anchor = names.find(Boolean)
      const id = anchor ? ` id="${escapeXml(anchor)}"` : ''
      return `<tr${id}>${row.map((cell, at) => cellHtml(cell, 'td', Boolean(names[at]))).join('')}</tr>`
    })
    .join('')
  return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`
}

export function toHtml(doc: DocxDocument, options: HtmlOptions = {}): string {
  const out: string[] = []
  let list: string[] = []
  const closeList = (): void => {
    if (!list.length) return
    out.push(`<ul>${list.join('')}</ul>`)
    list = []
  }

  if (options.meta?.kicker) out.push(`<p class="kicker">${escapeXml(options.meta.kicker)}</p>`)
  for (const block of doc.blocks) {
    if (block.kind === 'table') {
      closeList()
      out.push(tableHtml(block, options))
      continue
    }
    const inner = runsHtml(block.runs)
    if (!block.runs.some((run) => run.text.trim())) continue
    const style = block.style ?? 'Normal'
    if (style === 'Bullet') {
      list.push(`<li>${inner}</li>`)
      continue
    }
    closeList()
    const tag = TAG[style]
    if (tag) out.push(`<${tag}>${inner}</${tag}>`)
    else if (style === 'Quote') out.push(`<blockquote><p>${inner}</p></blockquote>`)
    else if (style === 'Meta') out.push(`<p class="meta">${inner}</p>`)
    else out.push(`<p>${inner}</p>`)
  }
  closeList()

  if (options.meta) {
    const bits = [escapeXml(options.meta.exported)]
    if (options.meta.source) bits.push(escapeXml(options.meta.source))
    out.push(`<footer>${bits.join(' · ')}</footer>`)
  }

  return [
    '<!doctype html>',
    '<html lang="fr">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeXml(doc.title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    out.join('\n'),
    '</body>',
    '</html>',
    ''
  ].join('\n')
}
