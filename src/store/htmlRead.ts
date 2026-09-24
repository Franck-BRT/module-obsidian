import type { DocxReadBlock, DocxReadParagraph } from './docxRead'

/**
 * An HTML page, read into the paragraphs and tables a Word document reads into.
 *
 * HTML as it is found rather than as it should be: paragraphs nobody closed, list items
 * that end where the next begins, `<br>` with no end, entities by the name, a page saved
 * out of Word with its own classes and its own tags. So this is a forgiving reader, not
 * the strict one XML gets — a tag that closes nothing is ignored, a tag left open is
 * closed by the one that could not sit inside it, the way a browser would.
 *
 * What a page shows is what is read. Its scripts, styles and head are not; nor its
 * navigation and its footer, which on the plugin's own export is the date it was taken.
 */

export interface HtmlNode {
  name: string
  attrs: Record<string, string>
  children: (HtmlNode | string)[]
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])
const RAW = new Set(['script', 'style', 'textarea', 'title', 'template', 'noscript'])
/** Elements a paragraph cannot hold, whose start closes one left open. */
const CLOSES_P = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'fieldset',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul'
])

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  shy: '',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  sbquo: '‚',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  minus: '−',
  bull: '•',
  middot: '·',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  micro: 'µ',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  copy: '©',
  reg: '®',
  trade: '™',
  sect: '§',
  para: '¶',
  le: '≤',
  ge: '≥',
  ne: '≠',
  asymp: '≈',
  infin: '∞',
  rarr: '→',
  larr: '←',
  harr: '↔',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '',
  zwj: '',
  iexcl: '¡',
  iquest: '¿',
  ordf: 'ª',
  ordm: 'º',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  frac14: '¼',
  frac12: '½',
  frac34: '¾',
  szlig: 'ß',
  oelig: 'œ',
  OElig: 'Œ',
  aelig: 'æ',
  AElig: 'Æ'
}
// The accented letters, by their shape: `eacute` is é, `Ccedil` is Ç — the letter and
// its combining accent, composed.
const ACCENTS: Record<string, string> = {
  grave: '\u0300',
  acute: '\u0301',
  circ: '\u0302',
  tilde: '\u0303',
  uml: '\u0308',
  ring: '\u030a',
  cedil: '\u0327'
}

/** A character by its number, or the replacement mark for a number that is none. */
function codePoint(value: number): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '\ufffd'
}

function entity(name: string): string | undefined {
  if (name.startsWith('#x') || name.startsWith('#X')) {
    return codePoint(Number.parseInt(name.slice(2), 16))
  }
  if (name.startsWith('#')) return codePoint(Number.parseInt(name.slice(1), 10))
  if (ENTITIES[name] !== undefined) return ENTITIES[name]
  const accent = /^([A-Za-z])(grave|acute|circ|tilde|uml|ring|cedil)$/.exec(name)
  if (accent) return (accent[1] + ACCENTS[accent[2]]).normalize('NFC')
  if (name === 'oslash') return 'ø'
  if (name === 'Oslash') return 'Ø'
  return undefined
}

export function decodeHtml(text: string): string {
  return text.replace(
    /&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);?/g,
    (whole, name: string) => entity(name) ?? whole
  )
}

function readAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of source.matchAll(/([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
    const raw = match[2] ?? ''
    attrs[match[1].toLowerCase()] = decodeHtml(raw.replace(/^["']|["']$/g, ''))
  }
  return attrs
}

/** The page as a tree, repaired the way a browser repairs it. */
export function parseHtml(source: string): HtmlNode {
  const root: HtmlNode = { name: '#root', attrs: {}, children: [] }
  const stack: HtmlNode[] = [root]
  const top = (): HtmlNode => stack[stack.length - 1]
  const closeUpTo = (name: string): void => {
    const at = stack.map((node) => node.name).lastIndexOf(name)
    if (at > 0) stack.length = at
  }
  /** Closes `name` if it is open above any of `barriers` — an item inside its own list only. */
  const closeOpen = (name: string, barriers: string[]): void => {
    for (let at = stack.length - 1; at > 0; at--) {
      if (stack[at].name === name) {
        stack.length = at
        return
      }
      if (barriers.includes(stack[at].name)) return
    }
  }

  let at = 0
  while (at < source.length) {
    const open = source.indexOf('<', at)
    if (open === -1 || open > at) {
      const text = source.slice(at, open === -1 ? undefined : open)
      if (text) top().children.push(decodeHtml(text))
      if (open === -1) break
      at = open
      continue
    }
    if (source.startsWith('<!--', at)) {
      const end = source.indexOf('-->', at + 4)
      at = end === -1 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<!', at) || source.startsWith('<?', at)) {
      const end = source.indexOf('>', at)
      at = end === -1 ? source.length : end + 1
      continue
    }
    const tag = /^<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/s.exec(source.slice(at, at + 4096))
    if (!tag) {
      top().children.push('<')
      at += 1
      continue
    }
    at += tag[0].length
    const name = tag[2].toLowerCase()
    if (tag[1]) {
      // A paragraph closed that was never opened is an empty one, in a browser's reading.
      if (name === 'p' && !stack.some((node) => node.name === 'p')) continue
      if (name === 'br') {
        top().children.push({ name: 'br', attrs: {}, children: [] })
        continue
      }
      closeUpTo(name)
      continue
    }
    if (CLOSES_P.has(name)) closeOpen('p', ['button', 'table', 'td', 'th', 'li'])
    if (name === 'li') closeOpen('li', ['ul', 'ol'])
    if (name === 'dt' || name === 'dd') {
      closeOpen('dt', ['dl'])
      closeOpen('dd', ['dl'])
    }
    if (name === 'tr') closeOpen('tr', ['table', 'thead', 'tbody', 'tfoot'])
    if (name === 'td' || name === 'th') {
      closeOpen('td', ['tr', 'table'])
      closeOpen('th', ['tr', 'table'])
    }
    if (name === 'thead' || name === 'tbody' || name === 'tfoot') {
      for (const section of ['thead', 'tbody', 'tfoot']) closeOpen(section, ['table'])
    }
    const node: HtmlNode = { name, attrs: readAttrs(tag[3]), children: [] }
    top().children.push(node)
    if (RAW.has(name)) {
      // A script's or a style's text is not the page's, and may hold anything.
      const end = source.toLowerCase().indexOf(`</${name}`, at)
      const stop = end === -1 ? source.length : end
      node.children.push(source.slice(at, stop))
      const close = source.indexOf('>', stop)
      at = close === -1 ? source.length : close + 1
      continue
    }
    if (!VOID.has(name) && !tag[4]) stack.push(node)
  }
  return root
}

/* ---- The page as a document ------------------------------------------------------ */

const SKIPPED = new Set([
  'head',
  'script',
  'style',
  'template',
  'noscript',
  'nav',
  'footer',
  'button',
  'form',
  'svg',
  'iframe',
  'object',
  'select',
  'title'
])
/** Elements that are blocks of the page: in a run of text, they start a line of their own. */
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'center',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figure',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'html',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul'
])

/** Whether an element holds a heading, a table or a quote — more than an item's words. */
function holdsParts(node: HtmlNode): boolean {
  return node.children.some(
    (child) => typeof child !== 'string' && (/^(h[1-6]|table|blockquote|pre)$/.test(child.name) || holdsParts(child))
  )
}

/** Whether an element holds blocks somewhere inside it, and is then walked rather than read as a run. */
function holdsBlocks(node: HtmlNode): boolean {
  return node.children.some((child) => typeof child !== 'string' && (BLOCKS.has(child.name) || holdsBlocks(child)))
}

function classes(node: HtmlNode): string[] {
  return (node.attrs.class ?? '').toLowerCase().split(/\s+/).filter(Boolean)
}

/** The words of an inline run: spaces as a browser shows them, `<br>` as a line break. */
function inlineText(node: HtmlNode | string, out: string[], pre = false): void {
  if (typeof node === 'string') {
    out.push(pre ? node : node.replace(/[ \t\r\n\f]+/g, ' '))
    return
  }
  if (SKIPPED.has(node.name)) return
  if (node.name === 'br') {
    out.push('\n')
    return
  }
  // Word's saved pages keep an empty paragraph mark as `<o:p>`: nothing to read.
  if (node.name === 'o:p') return
  const isPre = pre || node.name === 'pre'
  const block = BLOCKS.has(node.name)
  if (block && out.length) out.push('\n')
  for (const child of node.children) inlineText(child, out, isPre)
  if (block) out.push('\n')
}

function textOf(node: HtmlNode, pre = false): string {
  const out: string[] = []
  for (const child of node.children) inlineText(child, out, pre)
  return out
    .join('')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => (pre ? line.replace(/\s+$/, '') : line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** A paragraph set wholly in italics — `<p><em>…</em></p>` — is a note under something. */
function wholeItalic(node: HtmlNode): boolean {
  const content = node.children.filter((child) => typeof child !== 'string' || child.trim() !== '')
  return content.length === 1 && typeof content[0] !== 'string' && ['em', 'i'].includes(content[0].name)
}

function tableRows(table: HtmlNode): string[][] {
  const rows: string[][] = []
  const collect = (node: HtmlNode): void => {
    for (const child of node.children) {
      if (typeof child === 'string') continue
      if (child.name === 'tr') {
        rows.push(
          child.children
            .filter((cell): cell is HtmlNode => typeof cell !== 'string' && (cell.name === 'td' || cell.name === 'th'))
            .flatMap((cell) => {
              // A cell spanning columns is written once and stands for the others, empty.
              const span = Math.min(20, Math.max(1, Number(cell.attrs.colspan) || 1))
              return [textOf(cell), ...Array<string>(span - 1).fill('')]
            })
        )
      } else if (child.name !== 'table') collect(child)
    }
  }
  collect(table)
  return rows
}

const HANDLED = new Set(['p', 'blockquote', 'pre', 'ul', 'ol', 'table', 'dl', 'li', 'hr'])

/** The page as paragraphs and tables, in the order it shows them. */
export function readHtml(source: string): DocxReadBlock[] {
  const blocks: DocxReadBlock[] = []
  let loose: (HtmlNode | string)[] = []

  // Text sitting straight in a container, outside any paragraph, is a paragraph too.
  const flushLoose = (): void => {
    const text = textOf({ name: 'div', attrs: {}, children: loose })
    loose = []
    if (text) blocks.push({ kind: 'p', style: 'normal', styleName: '', text })
  }
  const paragraph = (
    style: DocxReadParagraph['style'],
    node: HtmlNode,
    extra: Partial<DocxReadParagraph> = {}
  ): void => {
    const text = textOf(node, node.name === 'pre')
    if (text) blocks.push({ kind: 'p', style, styleName: node.attrs.class ?? node.name, text, ...extra })
  }

  const walk = (node: HtmlNode): void => {
    for (const child of node.children) {
      if (typeof child === 'string') {
        loose.push(child)
        continue
      }
      if (SKIPPED.has(child.name)) continue
      const name = child.name
      const heading = /^h([1-6])$/.exec(name)
      if (!heading && !HANDLED.has(name)) {
        // A container — the body, a section, a div — is walked; an inline element is text.
        if (holdsBlocks(child)) {
          flushLoose()
          walk(child)
        } else loose.push(child)
        continue
      }
      flushLoose()
      const kind = classes(child)
      if (kind.includes('kicker')) continue
      if (heading) paragraph('heading', child, { level: Number(heading[1]) })
      else if (name === 'p' && kind.includes('title')) paragraph('title', child)
      else if (name === 'p') {
        const meta = kind.includes('meta') || wholeItalic(child)
        paragraph(meta ? 'meta' : kind.includes('quote') ? 'quote' : 'normal', child)
      } else if (name === 'blockquote') paragraph('quote', child)
      else if (name === 'pre') paragraph('normal', child)
      else if (name === 'ul' || name === 'ol') {
        const nested = (part: HtmlNode | string): boolean =>
          typeof part !== 'string' && ['ul', 'ol'].includes(part.name)
        for (const item of child.children) {
          if (typeof item === 'string') continue
          if (item.name !== 'li') {
            // A list set straight inside a list — how a sub-level is often written.
            walk({ ...child, name: 'div', children: [item] })
            continue
          }
          const own = { ...item, children: item.children.filter((part) => !nested(part)) }
          // An item holding headings or paragraphs is a numbered part of the document, not
          // a bullet: a page saved out of a word processor numbers its headings this way.
          if (holdsParts(own)) walk(own)
          else paragraph('list', own)
          walk({ ...item, name: 'div', children: item.children.filter(nested) })
        }
      } else if (name === 'table') {
        const rows = tableRows(child)
        if (rows.length) blocks.push({ kind: 'table', rows })
      } else if (name === 'dl') {
        for (const item of child.children) {
          if (typeof item !== 'string') paragraph('normal', item)
        }
      } else if (name === 'li') paragraph('list', child)
    }
    flushLoose()
  }
  walk(parseHtml(source))

  // One first-level heading, before any other: the page's title, and every heading under
  // it a level up — the export writes the title as `h1` and categories as `h2`.
  const headings = blocks.filter((block): block is DocxReadParagraph => block.kind === 'p' && block.style === 'heading')
  if (headings[0]?.level === 1 && headings.filter((block) => block.level === 1).length === 1) {
    headings[0].style = 'title'
    delete headings[0].level
    for (const block of headings.slice(1)) block.level = Math.max(1, (block.level ?? 2) - 1)
  }
  return blocks
}
