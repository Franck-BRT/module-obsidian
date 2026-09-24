import { escapeXml } from '../xml'
import { child, children, parseXml, XmlError, type XmlNode } from '../xmlParse'
import type { Requirement } from './Requirement'
import { csvLanguages } from './reqCsv'
import type { ReqJsonRead } from './reqJson'
import { hydrateRequirement, requirementFrontmatter } from './reqYaml'

/**
 * The library as XML, losing nothing.
 *
 * ReqIF is the XML requirements tools exchange, and it stays that: this is not a second
 * ReqIF. It is the same record the JSON export writes, in the shape an XSLT, an XPath
 * query or a system that reads XML and nothing else can walk — elements named for what
 * they hold, one requirement per element, every wording with what it knows about itself.
 *
 * The danger of a second shape is that it drifts from the first, and the file still looks
 * well-formed the day it does. So it is written from the note's own record and read back
 * into one, and the keys it handles are listed here and checked against the keys a note
 * can hold: a field added to requirements and forgotten here fails a test rather than
 * leaving the XML quietly short.
 */

export const REQ_XML_NAMESPACE = 'urn:black-projects:requirements:1'

/** Where each key of a note's record goes in the XML. Checked against the note's own keys. */
export const REQ_XML_KEYS = {
  attributes: ['id', 'rev', 'sourceLang', 'createdAt', 'updatedAt'],
  elements: ['title', 'category', 'type', 'status', 'criticality', 'verification', 'source', 'rationale', 'owner'],
  structured: ['tags', 'aliases', 'text', 'links', 'history'],
  /** Said by the element itself: every <requirement> is one. */
  implied: ['pm-requirement']
} as const

const INDENT = '  '

function element(depth: number, name: string, text: string, attrs: Record<string, string> = {}): string {
  const written = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('')
  // The text sits against its tags, never indented: a wording's leading space and its line
  // breaks are part of it, and pretty-printing inside it would change the requirement.
  return `${INDENT.repeat(depth)}<${name}${written}>${escapeXml(text)}</${name}>`
}

function requirementXml(requirement: Requirement): string[] {
  const record = requirementFrontmatter(requirement)
  // Every value the record holds at these keys is a string or a number; anything else is
  // written as nothing rather than as "[object Object]".
  const str = (value: unknown): string =>
    typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
  const out: string[] = [
    `${INDENT}<requirement ${REQ_XML_KEYS.attributes
      .map((key) => `${key}="${escapeXml(str(record[key]))}"`)
      .join(' ')}>`
  ]
  for (const key of REQ_XML_KEYS.elements) {
    // Left out when the note leaves it out, exactly as the note does: a requirement that
    // says nothing about its rationale has no rationale line, here or there.
    if (record[key] !== undefined) out.push(element(2, key, str(record[key])))
  }
  for (const key of ['tags', 'aliases'] as const) {
    const list = record[key]
    if (!Array.isArray(list) || !list.length) continue
    const one = key === 'tags' ? 'tag' : 'alias'
    out.push(
      `${INDENT.repeat(2)}<${key}>`,
      ...list.map((value) => element(3, one, str(value))),
      `${INDENT.repeat(2)}</${key}>`
    )
  }
  for (const [lang, held] of Object.entries(requirement.text)) {
    out.push(
      element(2, 'text', held.body, {
        lang,
        fromRev: String(held.fromRev),
        at: held.at,
        by: held.by,
        origin: held.origin,
        reviewed: String(held.reviewed)
      })
    )
  }
  if (requirement.links.length) {
    out.push(`${INDENT.repeat(2)}<links>`)
    for (const link of requirement.links) {
      const suspect = link.suspect === true ? ' suspect="true"' : ''
      out.push(`${INDENT.repeat(3)}<link kind="${escapeXml(link.kind)}" to="${escapeXml(link.to)}"${suspect}/>`)
    }
    out.push(`${INDENT.repeat(2)}</links>`)
  }
  if (requirement.history.length) {
    out.push(`${INDENT.repeat(2)}<history>`)
    for (const revision of requirement.history) {
      out.push(
        `${INDENT.repeat(3)}<revision rev="${revision.rev}" at="${escapeXml(revision.at)}" by="${escapeXml(revision.by)}" lang="${escapeXml(revision.lang)}">`,
        element(4, 'was', revision.was),
        element(4, 'note', revision.note),
        `${INDENT.repeat(3)}</revision>`
      )
    }
    out.push(`${INDENT.repeat(2)}</history>`)
  }
  out.push(`${INDENT}</requirement>`)
  return out
}

export interface ReqXmlOptions {
  exported: string
  languages?: string[]
}

/** Sorted by identifier, one element per line: the same library gives the same bytes. */
export function toReqXml(requirements: Requirement[], options: ReqXmlOptions): string {
  const sorted = [...requirements].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  const languages = options.languages ?? csvLanguages(sorted)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<requirements xmlns="${REQ_XML_NAMESPACE}" exported="${escapeXml(options.exported)}" count="${sorted.length}" languages="${escapeXml(languages.join(' '))}">`,
    ...sorted.flatMap(requirementXml),
    '</requirements>',
    ''
  ].join('\n')
}

/* ---- Reading ---------------------------------------------------------------- */

function textOfChild(node: XmlNode, name: string): string | undefined {
  const found = child(node, name)
  return found ? found.text : undefined
}

function number(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** One <requirement>, back into the record a note holds — and from there, a requirement. */
function recordOf(node: XmlNode): Record<string, unknown> {
  const record: Record<string, unknown> = { 'pm-requirement': true }
  for (const key of REQ_XML_KEYS.attributes) {
    if (node.attrs[key] !== undefined) record[key] = key === 'rev' ? number(node.attrs[key], 1) : node.attrs[key]
  }
  for (const key of REQ_XML_KEYS.elements) {
    const value = textOfChild(node, key)
    if (value !== undefined) record[key] = value
  }
  const tags = child(node, 'tags')
  if (tags) record.tags = children(tags, 'tag').map((each) => each.text)
  const aliases = child(node, 'aliases')
  if (aliases) record.aliases = children(aliases, 'alias').map((each) => each.text)

  const rev = number(node.attrs.rev, 1)
  const text: Record<string, unknown> = {}
  for (const wording of children(node, 'text')) {
    const lang = wording.attrs.lang?.trim()
    if (!lang) continue
    text[lang] = {
      body: wording.text,
      fromRev: number(wording.attrs.fromRev, rev),
      at: wording.attrs.at ?? '',
      by: wording.attrs.by ?? '',
      origin: wording.attrs.origin === 'machine' ? 'machine' : 'human',
      // Only an explicit false unreviews, as in the note reader: a wording that says
      // nothing about it was written before the attribute existed.
      reviewed: wording.attrs.reviewed !== 'false'
    }
  }
  record.text = text

  const links = child(node, 'links')
  if (links) {
    record.links = children(links, 'link').map((link) => ({
      kind: link.attrs.kind ?? '',
      to: link.attrs.to ?? '',
      ...(link.attrs.suspect === 'true' ? { suspect: true } : {})
    }))
  }
  const history = child(node, 'history')
  if (history) {
    record.history = children(history, 'revision').map((revision) => ({
      rev: number(revision.attrs.rev, 1),
      at: revision.attrs.at ?? '',
      by: revision.attrs.by ?? '',
      lang: revision.attrs.lang ?? '',
      was: textOfChild(revision, 'was') ?? '',
      note: textOfChild(revision, 'note') ?? ''
    }))
  }
  return record
}

/**
 * The same file, read back into the shape every import plan reads.
 *
 * A file this did not write — a ReqIF someone saved as .xml is the likely one — is named
 * for what it is rather than read as an empty library: "no requirements" and "not this
 * format" are different mornings.
 */
export function readReqXml(source: string): ReqJsonRead {
  let root: XmlNode
  try {
    root = parseXml(source)
  } catch (error) {
    return { requirements: [], problems: [error instanceof XmlError ? error.message : String(error)] }
  }
  if (root.name !== 'requirements') return { requirements: [], problems: [`root: <${root.name}>`] }
  const problems: string[] = []
  if (root.attrs.xmlns !== undefined && root.attrs.xmlns !== REQ_XML_NAMESPACE) {
    problems.push(`xmlns: ${root.attrs.xmlns}`)
  }

  const requirements: Requirement[] = []
  children(root, 'requirement').forEach((node, at) => {
    const id = node.attrs.id?.trim()
    if (!id) {
      problems.push(`requirement[${at}]: no identifier`)
      return
    }
    requirements.push(hydrateRequirement(recordOf(node), ''))
  })
  return { requirements, problems }
}
