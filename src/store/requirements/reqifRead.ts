import { REQ_LINK_KINDS, VERIFICATION_METHODS, type Requirement } from './Requirement'
import { planCsvImport, type CsvPlanRow } from './reqCsv'
import { childLocal, childrenLocal, localName, parseXml, XmlError, type XmlNode } from '../xmlParse'
import { unzip, ZipError } from '../unzip'

/**
 * Reading a ReqIF file: what DOORS, Polarion, Jama or this plugin hand over.
 *
 * Into the rows a CSV import reads, deliberately. ReqIF carries one wording and a handful
 * of fields; it does not carry the other languages, the history, the review state of a
 * translation. So an existing requirement is updated field by field, the way a
 * spreadsheet updates it, and never replaced by the thinner copy — the plan, the preview
 * and the writing are the CSV import's, already trusted.
 *
 * What made reading ReqIF worth refusing for so long was the importer that silently
 * drops what it does not understand. So nothing here is dropped silently: an attribute
 * with no column is named, a relation of a kind the library does not have is named, an
 * object with no words — a chapter heading — is counted. The reader is told before
 * anything is written.
 */

export interface ReqifRead {
  /** One per spec object, keyed like CSV columns: `id`, `title`, `text.<lang>`, `links`… */
  rows: Record<string, string>[]
  /** The language the wordings are read as: the file's own, or the one it was given. */
  lang: string
  /** Whether the file said which language it holds. */
  langFromFile: boolean
  /** Attributes carried by the file that have no place in a requirement, by name. */
  ignored: string[]
  /** Relation types the library has no kind for, by name. */
  ignoredRelations: string[]
  /** Objects with neither an identifier nor a wording: headings, mostly. */
  headings: number
  /** Set when the file could not be read at all. */
  error?: string
}

/**
 * Attribute names, as tools write them, to the column they fill.
 *
 * The `ReqIF.*` names are the standard's, the plain ones are this plugin's own export,
 * and the rest are what the common tools and a French-speaking team call the same thing.
 * Matched without case or surrounding space.
 */
const COLUMN_OF: Record<string, string> = {
  'reqif.foreignid': 'id',
  foreignid: 'id',
  id: 'id',
  identifier: 'id',
  identifiant: 'id',
  'reqif.name': 'title',
  name: 'title',
  title: 'title',
  titre: 'title',
  'reqif.text': 'text',
  text: 'text',
  texte: 'text',
  'object text': 'text',
  'reqif.description': 'text',
  description: 'text',
  aliases: 'aliases',
  alias: 'aliases',
  category: 'category',
  catégorie: 'category',
  type: 'type',
  status: 'status',
  statut: 'status',
  criticality: 'criticality',
  criticité: 'criticality',
  verification: 'verification',
  vérification: 'verification',
  source: 'source',
  rationale: 'rationale',
  justification: 'rationale',
  owner: 'owner',
  propriétaire: 'owner',
  tags: 'tags',
  étiquettes: 'tags',
  // Per object, the language its text is in, where the file says so: this plugin's own
  // export does, because a requirement with no wording in the file's language goes out in
  // its source one.
  language: 'lang',
  langue: 'lang'
}

/**
 * Names recognised and left alone on purpose, so they are not reported as lost: the
 * revision is this library's to count, and a chapter name belongs to the document the
 * requirements were laid out in, not to any requirement.
 */
const DELIBERATELY_UNREAD = new Set(['revision', 'révision', 'reqif.chaptername', 'reqif.prefix'])

const local = localName
const kids = childrenLocal
const kid = childLocal

/** Every descendant of that name, wherever it sits. */
function all(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const each of node.children) {
    if (local(each) === name) out.push(each)
    all(each, name, out)
  }
  return out
}

/** The text of the single `*-REF` child of a node, whatever kind of reference it is. */
function refOf(node: XmlNode | null): string {
  const ref = node?.children.find((each) => local(each).endsWith('-REF'))
  return ref?.text.trim() ?? ''
}

const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'tr', 'blockquote', 'pre'])

function xhtmlInto(node: XmlNode, out: string[]): void {
  for (const part of node.content) {
    if (typeof part === 'string') {
      // Whitespace in XHTML is layout, not content: the indentation between tags is not
      // part of anybody's requirement.
      out.push(part.replace(/\s+/g, ' '))
      continue
    }
    const name = local(part).toLowerCase()
    if (name === 'br') out.push('\n')
    else if (name === 'li') {
      // One line per item, whatever the tool wrapped it in: `<li><p>…</p></li>` is common.
      const item: string[] = []
      xhtmlInto(part, item)
      out.push(
        `\n- ${item
          .join('')
          .trim()
          .replace(/\s*\n\s*/g, ' ')}`
      )
    } else if (name === 'td' || name === 'th') {
      xhtmlInto(part, out)
      out.push(' | ')
    } else if (BLOCKS.has(name)) {
      out.push('\n\n')
      xhtmlInto(part, out)
      out.push('\n\n')
    } else xhtmlInto(part, out)
  }
}

/**
 * A ReqIF.Text back into the words a requirement holds.
 *
 * Paragraphs become blank-line-separated blocks and line breaks stay line breaks — the
 * inverse of what the export writes, so a round trip reads back the same wording. Lists
 * come back as `- ` lines; formatting beyond that has no place in a requirement's text.
 */
export function xhtmlText(value: XmlNode): string {
  const out: string[] = []
  xhtmlInto(value, out)
  return out
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalName(raw: string): string {
  return raw.trim().toLowerCase()
}

/** A relation type's name as a link kind: "Derives From" and `derives_from` are `derives-from`. */
function linkKindOf(name: string): string | undefined {
  const kind = normalName(name).replace(/[\s_]+/g, '-')
  return (REQ_LINK_KINDS as readonly string[]).includes(kind) ? kind : undefined
}

function languageOf(header: XmlNode | null): string {
  const comment = kid(header, 'COMMENT')?.text ?? ''
  return /language:\s*([a-z]{2,3}(?:-[a-z0-9]+)?)/i.exec(comment)?.[1].toLowerCase() ?? ''
}

function failed(lang: string, error: string): ReqifRead {
  return { rows: [], lang, langFromFile: false, ignored: [], ignoredRelations: [], headings: 0, error }
}

/**
 * The file, read into rows.
 *
 * `fallbackLang` is what the wordings are taken to be when the file does not say — ReqIF
 * has no place for a language, and this plugin's own export writes it in the header
 * comment for exactly that reason.
 */
export function readReqif(source: string, fallbackLang: string): ReqifRead {
  let root: XmlNode
  try {
    root = parseXml(source)
  } catch (error) {
    return failed(fallbackLang, error instanceof XmlError ? error.message : String(error))
  }
  if (local(root) !== 'REQ-IF') return failed(fallbackLang, `root: <${root.name}>`)

  const header = kid(kid(root, 'THE-HEADER'), 'REQ-IF-HEADER')
  const fromFile = languageOf(header)
  const lang = fromFile || fallbackLang
  const content = kid(kid(root, 'CORE-CONTENT'), 'REQ-IF-CONTENT')
  if (!content) return failed(lang, 'no REQ-IF-CONTENT')

  // Enumeration values are referenced by identifier; what a reader wants is their name.
  const enumName = new Map<string, string>()
  for (const value of all(content, 'ENUM-VALUE')) {
    enumName.set(value.attrs.IDENTIFIER ?? '', value.attrs['LONG-NAME'] ?? value.attrs.IDENTIFIER ?? '')
  }
  // Attribute definitions, by identifier, to their name — and from the name, a column.
  const definitionName = new Map<string, string>()
  for (const definition of all(kid(content, 'SPEC-TYPES') ?? content, 'SPEC-ATTRIBUTES').flatMap(
    (list) => list.children
  )) {
    if (!local(definition).startsWith('ATTRIBUTE-DEFINITION-')) continue
    definitionName.set(
      definition.attrs.IDENTIFIER ?? '',
      definition.attrs['LONG-NAME'] ?? definition.attrs.IDENTIFIER ?? ''
    )
  }

  const ignored = new Set<string>()
  const rows: Record<string, string>[] = []
  const rowOfObject = new Map<string, Record<string, string>>()
  let headings = 0

  for (const object of kids(kid(content, 'SPEC-OBJECTS'), 'SPEC-OBJECT')) {
    const row: Record<string, string> = {}
    let text = ''
    let objectLang = ''
    for (const value of kid(object, 'VALUES')?.children ?? []) {
      const kind = local(value)
      if (!kind.startsWith('ATTRIBUTE-VALUE-')) continue
      const name = definitionName.get(refOf(kid(value, 'DEFINITION'))) ?? refOf(kid(value, 'DEFINITION'))
      const key = normalName(name)
      const column = COLUMN_OF[key]
      if (!column) {
        if (!DELIBERATELY_UNREAD.has(key) && name) ignored.add(name)
        continue
      }

      let raw: string
      if (kind === 'ATTRIBUTE-VALUE-XHTML') {
        const held = kid(value, 'THE-VALUE')
        raw = held ? xhtmlText(held) : ''
      } else if (kind === 'ATTRIBUTE-VALUE-ENUMERATION') {
        raw = kids(kid(value, 'VALUES'), 'ENUM-VALUE-REF')
          .map((ref) => enumName.get(ref.text.trim()) ?? ref.text.trim())
          .join(', ')
      } else raw = (value.attrs['THE-VALUE'] ?? '').trim()
      if (raw === '') continue

      if (column === 'verification') {
        const method = raw.toLowerCase()
        raw = (VERIFICATION_METHODS as readonly string[]).includes(method) ? method : raw
      }
      // Two attributes landing in one column — `ReqIF.Text` and a `Description` — keep
      // the first that says something, which is the one the standard names first.
      if (column === 'text') text ||= raw
      else if (column === 'lang') objectLang ||= raw.toLowerCase()
      else row[column] ??= raw
    }
    if (text) row[`text.${objectLang || lang}`] = text

    if (!row.id && !text) {
      headings += 1
      continue
    }
    rows.push(row)
    rowOfObject.set(object.attrs.IDENTIFIER ?? '', row)
  }

  // Relation types by identifier, to the link kind they are — or to their name, to report.
  const relationName = new Map<string, string>()
  for (const type of all(kid(content, 'SPEC-TYPES') ?? content, 'SPEC-RELATION-TYPE')) {
    relationName.set(type.attrs.IDENTIFIER ?? '', type.attrs['LONG-NAME'] ?? type.attrs.IDENTIFIER ?? '')
  }
  const ignoredRelations = new Set<string>()
  const links = new Map<Record<string, string>, string[]>()
  for (const relation of kids(kid(content, 'SPEC-RELATIONS'), 'SPEC-RELATION')) {
    const typeId = refOf(kid(relation, 'TYPE'))
    const name = relationName.get(typeId) ?? typeId
    const kind = linkKindOf(name)
    const from = rowOfObject.get(refOf(kid(relation, 'SOURCE')))
    const to = rowOfObject.get(refOf(kid(relation, 'TARGET')))
    if (!kind) {
      ignoredRelations.add(name)
      continue
    }
    // Between two requirements that both have a name; a link to a heading, or to an
    // object without an identifier, has nothing to point at.
    if (!from || !to?.id) continue
    links.set(from, [...(links.get(from) ?? []), `${kind}: ${to.id}`])
  }
  for (const [row, held] of links) row.links = held.join('; ')

  return {
    rows,
    lang,
    langFromFile: fromFile !== '',
    ignored: [...ignored].sort((a, b) => a.localeCompare(b)),
    ignoredRelations: [...ignoredRelations].sort((a, b) => a.localeCompare(b)),
    headings
  }
}

/** Whether a file's name says it is ReqIF, compressed or not. */
export function isReqifName(name: string): boolean {
  return /\.reqifz?$/i.test(name)
}

/**
 * What a ReqIF would do to the library: the CSV plan, with one thing only this format needs.
 *
 * A requirement the file creates is authored in the language the file was read as. Left
 * to the default, a French library importing an English ReqIF would create requirements
 * whose source wording does not exist. An existing one keeps its own: an English export
 * of a French requirement, read back, is a translation coming home, not a change of source.
 */
export function planReqifImport(read: ReqifRead, library: Requirement[]): CsvPlanRow[] {
  return planCsvImport(read.rows, library).map((row) =>
    row.action === 'create' && row.values.sourceLang === undefined
      ? { ...row, values: { ...row.values, sourceLang: Object.keys(row.values.text)[0] ?? read.lang } }
      : row
  )
}

/**
 * The ReqIF inside a `.reqifz`, as text.
 *
 * The archive may carry attachments beside it; only the `.reqif` is unpacked. More than
 * one is refused rather than guessed between, since picking the wrong one would import a
 * library nobody chose.
 */
export async function reqifFromArchive(bytes: Uint8Array): Promise<string> {
  const found = await unzip(bytes, (name) => /\.reqif$/i.test(name))
  if (found.length !== 1) {
    throw new ZipError(found.length ? 'several .reqif files in the archive' : 'no .reqif file in the archive')
  }
  return new TextDecoder().decode(found[0].data)
}
