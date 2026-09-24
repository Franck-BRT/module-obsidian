/**
 * Reading XML, by hand.
 *
 * Not a general parser, and it does not pretend to be one: no DTD, no namespaces beyond
 * reading the attribute, no processing instructions beyond skipping them. It reads what
 * this plugin writes, and what a person editing that by hand is likely to produce. The
 * browser's own parser would do more, but it does not exist where the tests run, and a
 * format whose reader cannot be tested is a format whose round trip is a hope.
 *
 * Strict where it matters: a closing tag that does not match its opening one is an error
 * with a position, never a tree quietly reshaped around the mistake.
 */

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** The text directly inside, entities decoded, concatenated across the children. */
  text: string
  /**
   * Text and elements in the order they were written. `text` is enough for a record; a
   * wording held as XHTML — `a<br/>b` — means something by its order, and loses it there.
   */
  content: (XmlNode | string)[]
}

export class XmlError extends Error {
  constructor(
    message: string,
    readonly at: number
  ) {
    super(`${message} (at ${at})`)
  }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10))
    // An entity nobody declared is left as written rather than guessed at.
    return ENTITIES[name] ?? whole
  })
}

// Sticky, and read from where the cursor stands: a file from a requirements tool runs to
// megabytes, and slicing the rest of it at every tag is the slow way to read one.
const NAME = /[A-Za-z_][\w.:-]*/y

function nameAt(source: string, at: number): string | undefined {
  NAME.lastIndex = at
  return NAME.exec(source)?.[0]
}

function readAttrs(source: string, from: number): { attrs: Record<string, string>; end: number; selfClosing: boolean } {
  const attrs: Record<string, string> = {}
  let at = from
  for (;;) {
    while (/\s/.test(source[at] ?? '')) at++
    const char = source[at]
    if (char === undefined) throw new XmlError('unterminated tag', from)
    if (char === '>') return { attrs, end: at + 1, selfClosing: false }
    if (char === '/' && source[at + 1] === '>') return { attrs, end: at + 2, selfClosing: true }
    const name = nameAt(source, at)
    if (!name) throw new XmlError(`unexpected "${char}" in a tag`, at)
    at += name.length
    while (/\s/.test(source[at] ?? '')) at++
    if (source[at] !== '=') throw new XmlError(`attribute ${name} has no value`, at)
    at++
    while (/\s/.test(source[at] ?? '')) at++
    const quote = source[at]
    if (quote !== '"' && quote !== "'") throw new XmlError(`attribute ${name} is not quoted`, at)
    const close = source.indexOf(quote, at + 1)
    if (close === -1) throw new XmlError(`attribute ${name} is never closed`, at)
    attrs[name] = decodeEntities(source.slice(at + 1, close))
    at = close + 1
  }
}

function append(node: XmlNode, text: string): void {
  if (!text) return
  node.text += text
  const last = node.content.length - 1
  if (typeof node.content[last] === 'string') node.content[last] += text
  else node.content.push(text)
}

/** The document's root element. Throws an XmlError, with a position, on anything malformed. */
export function parseXml(source: string): XmlNode {
  const stack: XmlNode[] = []
  let root: XmlNode | null = null
  let at = source.charCodeAt(0) === 0xfeff ? 1 : 0

  while (at < source.length) {
    const open = source.indexOf('<', at)
    const text = source.slice(at, open === -1 ? source.length : open)
    if (stack.length) append(stack[stack.length - 1], decodeEntities(text))
    else if (text.trim()) throw new XmlError('text outside the root element', at)
    if (open === -1) break

    if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open)
      if (end === -1) throw new XmlError('unterminated declaration', open)
      at = end + 2
      continue
    }
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open)
      if (end === -1) throw new XmlError('unterminated comment', open)
      at = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open)
      if (end === -1) throw new XmlError('unterminated CDATA', open)
      if (!stack.length) throw new XmlError('CDATA outside the root element', open)
      append(stack[stack.length - 1], source.slice(open + 9, end))
      at = end + 3
      continue
    }
    if (source[open + 1] === '/') {
      const end = source.indexOf('>', open)
      const name = source.slice(open + 2, end === -1 ? undefined : end).trim()
      const node = stack.pop()
      if (!node || node.name !== name) {
        throw new XmlError(`</${name}> closes ${node ? `<${node.name}>` : 'nothing'}`, open)
      }
      at = end + 1
      continue
    }

    const name = nameAt(source, open + 1)
    if (!name) throw new XmlError('a tag with no name', open)
    const read = readAttrs(source, open + 1 + name.length)
    const node: XmlNode = { name, attrs: read.attrs, children: [], text: '', content: [] }
    if (stack.length) {
      stack[stack.length - 1].children.push(node)
      stack[stack.length - 1].content.push(node)
    } else if (root) throw new XmlError('a second root element', open)
    else root = node
    if (!read.selfClosing) stack.push(node)
    at = read.end
  }

  if (stack.length) throw new XmlError(`<${stack[stack.length - 1].name}> is never closed`, source.length)
  if (!root) throw new XmlError('no root element', 0)
  return root
}

/** The first child of that name, or null. */
export function child(node: XmlNode, name: string): XmlNode | null {
  return node.children.find((each) => each.name === name) ?? null
}

/** Every child of that name, in document order. */
export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((each) => each.name === name)
}

/**
 * The element's name without the namespace prefix a tool may have put on it.
 *
 * Files written by other tools prefix their elements as they please — `reqif:SPEC-OBJECT`,
 * `x:row` — and what a reader means is the element, not the prefix.
 */
export function localName(node: XmlNode): string {
  return node.name.slice(node.name.indexOf(':') + 1)
}

/** Every child of that local name, whatever its prefix. */
export function childrenLocal(node: XmlNode | null | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((each) => localName(each) === name) : []
}

/** The first child of that local name, whatever its prefix, or null. */
export function childLocal(node: XmlNode | null | undefined, name: string): XmlNode | null {
  return childrenLocal(node, name)[0] ?? null
}
