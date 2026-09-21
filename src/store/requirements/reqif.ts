import type { Requirement } from './Requirement'

/**
 * ReqIF, the format requirements tools exchange through.
 *
 * Written out rather than generated from a schema, because what a plugin needs to emit is
 * a tiny, fixed corner of a large standard: the datatypes, one spec type, one spec object
 * per requirement, one specification listing them, and the relations between them. A
 * library would bring the whole of ReqIF and its dependencies for that.
 *
 * Export only, and deliberately. Reading ReqIF back means dealing with every tool's own
 * profile, embedded XHTML, attachments and tool extensions, and a half-done importer
 * silently loses requirements — which is the one failure a requirements tool must never
 * have. A CSV round trip is honest about what it carries; a ReqIF importer that drops a
 * SPEC-OBJECT is not.
 */

export const REQIF_NAMESPACE = 'http://www.omg.org/spec/ReqIF/20110401/reqif.xsd'
export const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

/** The attributes a requirement is exported with, in the order they are declared. */
export const REQIF_ATTRIBUTES = [
  { id: 'ATT-ID', name: 'ReqIF.ForeignID', type: 'string' },
  // The names this requirement also answers to. Exported because this is the file that
  // leaves the building: the far end is often the very project whose numbering they are.
  { id: 'ATT-ALIASES', name: 'Aliases', type: 'string' },
  { id: 'ATT-TITLE', name: 'ReqIF.Name', type: 'string' },
  { id: 'ATT-TEXT', name: 'ReqIF.Text', type: 'xhtml' },
  { id: 'ATT-CATEGORY', name: 'Category', type: 'string' },
  { id: 'ATT-TYPE', name: 'Type', type: 'string' },
  { id: 'ATT-STATUS', name: 'Status', type: 'string' },
  { id: 'ATT-CRITICALITY', name: 'Criticality', type: 'string' },
  { id: 'ATT-VERIFICATION', name: 'Verification', type: 'string' },
  { id: 'ATT-SOURCE', name: 'Source', type: 'string' },
  { id: 'ATT-RATIONALE', name: 'Rationale', type: 'string' },
  { id: 'ATT-REV', name: 'Revision', type: 'integer' }
] as const

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * A wording as XHTML, which is what ReqIF.Text is.
 *
 * Paragraph per blank-line-separated block, line breaks kept: a requirement written on
 * three lines means something by being on three lines, and a tool that receives it as one
 * run-on sentence has been handed a different requirement.
 */
export function toXhtml(body: string): string {
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== '')
  if (!blocks.length) return `<xhtml:p/>`
  return blocks.map((block) => `<xhtml:p>${escapeXml(block).replace(/\n/g, '<xhtml:br/>')}</xhtml:p>`).join('')
}

/** Identifiers ReqIF will accept: it wants an XML name, and a requirement id is not one. */
export function reqifId(prefix: string, raw: string): string {
  return `${prefix}-${raw.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

function attributeValue(attribute: (typeof REQIF_ATTRIBUTES)[number], value: string): string {
  if (value === '') return ''
  if (attribute.type === 'integer') {
    return `<ATTRIBUTE-VALUE-INTEGER THE-VALUE="${escapeXml(value)}"><DEFINITION><ATTRIBUTE-DEFINITION-INTEGER-REF>${attribute.id}</ATTRIBUTE-DEFINITION-INTEGER-REF></DEFINITION></ATTRIBUTE-VALUE-INTEGER>`
  }
  if (attribute.type === 'xhtml') {
    return `<ATTRIBUTE-VALUE-XHTML><DEFINITION><ATTRIBUTE-DEFINITION-XHTML-REF>${attribute.id}</ATTRIBUTE-DEFINITION-XHTML-REF></DEFINITION><THE-VALUE>${toXhtml(value)}</THE-VALUE></ATTRIBUTE-VALUE-XHTML>`
  }
  return `<ATTRIBUTE-VALUE-STRING THE-VALUE="${escapeXml(value)}"><DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>${attribute.id}</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION></ATTRIBUTE-VALUE-STRING>`
}

function definitions(): string {
  return REQIF_ATTRIBUTES.map((attribute) => {
    if (attribute.type === 'integer') {
      return `<ATTRIBUTE-DEFINITION-INTEGER IDENTIFIER="${attribute.id}" LONG-NAME="${attribute.name}"><TYPE><DATATYPE-DEFINITION-INTEGER-REF>DT-INTEGER</DATATYPE-DEFINITION-INTEGER-REF></TYPE></ATTRIBUTE-DEFINITION-INTEGER>`
    }
    if (attribute.type === 'xhtml') {
      return `<ATTRIBUTE-DEFINITION-XHTML IDENTIFIER="${attribute.id}" LONG-NAME="${attribute.name}"><TYPE><DATATYPE-DEFINITION-XHTML-REF>DT-XHTML</DATATYPE-DEFINITION-XHTML-REF></TYPE></ATTRIBUTE-DEFINITION-XHTML>`
    }
    return `<ATTRIBUTE-DEFINITION-STRING IDENTIFIER="${attribute.id}" LONG-NAME="${attribute.name}"><TYPE><DATATYPE-DEFINITION-STRING-REF>DT-STRING</DATATYPE-DEFINITION-STRING-REF></TYPE></ATTRIBUTE-DEFINITION-STRING>`
  }).join('')
}

/**
 * The wording a ReqIF.Text carries.
 *
 * One language, because ReqIF.Text is one field and a tool reading it will show whatever
 * is in it. Which language is the caller's decision and is recorded in the header, so the
 * file says what it holds rather than leaving the far end to guess.
 */
function textOfLang(requirement: Requirement, lang: string): string {
  return requirement.text[lang]?.body ?? requirement.text[requirement.sourceLang]?.body ?? ''
}

function specObject(requirement: Requirement, lang: string): string {
  const values = REQIF_ATTRIBUTES.map((attribute) => {
    switch (attribute.id) {
      case 'ATT-ID':
        return attributeValue(attribute, requirement.id)
      case 'ATT-ALIASES':
        return attributeValue(attribute, requirement.aliases.join('; '))
      case 'ATT-TITLE':
        return attributeValue(attribute, requirement.title)
      case 'ATT-TEXT':
        return attributeValue(attribute, textOfLang(requirement, lang))
      case 'ATT-CATEGORY':
        return attributeValue(attribute, requirement.category)
      case 'ATT-TYPE':
        return attributeValue(attribute, requirement.type)
      case 'ATT-STATUS':
        return attributeValue(attribute, requirement.status)
      case 'ATT-CRITICALITY':
        return attributeValue(attribute, requirement.criticality)
      case 'ATT-VERIFICATION':
        return attributeValue(attribute, requirement.verification)
      case 'ATT-SOURCE':
        return attributeValue(attribute, requirement.source)
      case 'ATT-RATIONALE':
        return attributeValue(attribute, requirement.rationale)
      default:
        return attributeValue(attribute, String(requirement.rev))
    }
  }).join('')
  return `<SPEC-OBJECT IDENTIFIER="${reqifId('SO', requirement.id)}" LAST-CHANGE="${escapeXml(requirement.updatedAt)}" LONG-NAME="${escapeXml(requirement.id)}"><VALUES>${values}</VALUES><TYPE><SPEC-OBJECT-TYPE-REF>SOT-REQUIREMENT</SPEC-OBJECT-TYPE-REF></TYPE></SPEC-OBJECT>`
}

function relations(requirements: Requirement[]): string {
  const known = new Set(requirements.map((requirement) => requirement.id.toUpperCase()))
  const out: string[] = []
  for (const requirement of requirements) {
    for (const link of requirement.links) {
      // Only between objects that are both in the file: a relation to something the far
      // end has never heard of makes the document invalid rather than informative.
      if (!known.has(link.to.toUpperCase())) continue
      out.push(
        `<SPEC-RELATION IDENTIFIER="${reqifId('SR', `${requirement.id}-${link.kind}-${link.to}`)}" LAST-CHANGE="${escapeXml(requirement.updatedAt)}"><TYPE><SPEC-RELATION-TYPE-REF>${reqifId('SRT', link.kind)}</SPEC-RELATION-TYPE-REF></TYPE><SOURCE><SPEC-OBJECT-REF>${reqifId('SO', requirement.id)}</SPEC-OBJECT-REF></SOURCE><TARGET><SPEC-OBJECT-REF>${reqifId('SO', link.to)}</SPEC-OBJECT-REF></TARGET></SPEC-RELATION>`
      )
    }
  }
  return out.join('')
}

function relationTypes(requirements: Requirement[]): string {
  const kinds = new Set<string>()
  for (const requirement of requirements) {
    for (const link of requirement.links) kinds.add(link.kind)
  }
  return [...kinds]
    .sort((a, b) => a.localeCompare(b))
    .map(
      (kind) =>
        `<SPEC-RELATION-TYPE IDENTIFIER="${reqifId('SRT', kind)}" LONG-NAME="${escapeXml(kind)}" LAST-CHANGE="${'1970-01-01T00:00:00Z'}"/>`
    )
    .join('')
}

export interface ReqifOptions {
  /** Which wording goes into ReqIF.Text. Recorded in the header so the file says so. */
  lang: string
  title: string
  at?: string
  tool?: string
}

export function toReqif(requirements: Requirement[], options: ReqifOptions): string {
  const at = options.at ?? new Date().toISOString()
  const sorted = [...requirements].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  const hierarchy = sorted
    .map(
      (requirement) =>
        `<SPEC-HIERARCHY IDENTIFIER="${reqifId('SH', requirement.id)}" LAST-CHANGE="${escapeXml(requirement.updatedAt)}"><OBJECT><SPEC-OBJECT-REF>${reqifId('SO', requirement.id)}</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>`
    )
    .join('')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<REQ-IF xmlns="${REQIF_NAMESPACE}" xmlns:xhtml="${XHTML_NAMESPACE}">`,
    `<THE-HEADER><REQ-IF-HEADER IDENTIFIER="HEADER-1"><COMMENT>${escapeXml(`Language: ${options.lang}`)}</COMMENT><CREATION-TIME>${escapeXml(at)}</CREATION-TIME><REQ-IF-TOOL-ID>${escapeXml(options.tool ?? 'Black Projects')}</REQ-IF-TOOL-ID><REQ-IF-VERSION>1.0</REQ-IF-VERSION><SOURCE-TOOL-ID>${escapeXml(options.tool ?? 'Black Projects')}</SOURCE-TOOL-ID><TITLE>${escapeXml(options.title)}</TITLE></REQ-IF-HEADER></THE-HEADER>`,
    '<CORE-CONTENT><REQ-IF-CONTENT>',
    `<DATATYPES><DATATYPE-DEFINITION-STRING IDENTIFIER="DT-STRING" LONG-NAME="String" MAX-LENGTH="32000" LAST-CHANGE="${escapeXml(at)}"/><DATATYPE-DEFINITION-INTEGER IDENTIFIER="DT-INTEGER" LONG-NAME="Integer" MIN="0" MAX="2147483647" LAST-CHANGE="${escapeXml(at)}"/><DATATYPE-DEFINITION-XHTML IDENTIFIER="DT-XHTML" LONG-NAME="Text" LAST-CHANGE="${escapeXml(at)}"/></DATATYPES>`,
    `<SPEC-TYPES><SPEC-OBJECT-TYPE IDENTIFIER="SOT-REQUIREMENT" LONG-NAME="Requirement" LAST-CHANGE="${escapeXml(at)}"><SPEC-ATTRIBUTES>${definitions()}</SPEC-ATTRIBUTES></SPEC-OBJECT-TYPE><SPECIFICATION-TYPE IDENTIFIER="ST-LIBRARY" LONG-NAME="Requirements" LAST-CHANGE="${escapeXml(at)}"/>${relationTypes(sorted)}</SPEC-TYPES>`,
    `<SPEC-OBJECTS>${sorted.map((requirement) => specObject(requirement, options.lang)).join('')}</SPEC-OBJECTS>`,
    `<SPEC-RELATIONS>${relations(sorted)}</SPEC-RELATIONS>`,
    `<SPECIFICATIONS><SPECIFICATION IDENTIFIER="SPEC-LIBRARY" LONG-NAME="${escapeXml(options.title)}" LAST-CHANGE="${escapeXml(at)}"><TYPE><SPECIFICATION-TYPE-REF>ST-LIBRARY</SPECIFICATION-TYPE-REF></TYPE><CHILDREN>${hierarchy}</CHILDREN></SPECIFICATION></SPECIFICATIONS>`,
    '</REQ-IF-CONTENT></CORE-CONTENT>',
    '</REQ-IF>',
    ''
  ].join('\n')
}
