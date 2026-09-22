import type { Requirement } from './Requirement'
import { textOf } from './Requirement'

/**
 * The library written out as a document.
 *
 * Not a `pm-req` block, which is the right thing inside this vault and useless outside
 * it: what leaves the building has to be readable by somebody who has never heard of this
 * plugin. So the words are on the page, once, as prose — a snapshot, and honest about
 * being one. Anything that needs to stay current stays in a block.
 */

export interface MarkdownOptions {
  title: string
  /** Which wording to write out. The source language stands in where it was not written. */
  lang: string
  /** What to head the requirements filed under no category at all. */
  noCategory: string
  at?: string
}

function metaLine(requirement: Requirement): string {
  const bits = [requirement.status, requirement.type, requirement.criticality].filter((bit) => bit !== '')
  if (requirement.verification !== 'none') bits.push(requirement.verification)
  return bits.join(' · ')
}

export function toMarkdownDocument(requirements: Requirement[], options: MarkdownOptions): string {
  const at = options.at ?? new Date().toISOString()
  const lines = [
    '---',
    `title: ${JSON.stringify(options.title)}`,
    `exported: ${JSON.stringify(at)}`,
    `language: ${JSON.stringify(options.lang)}`,
    `count: ${requirements.length}`,
    '---',
    '',
    `# ${options.title}`,
    ''
  ]

  let category = '\u0000'
  for (const requirement of requirements) {
    // Grouped under the category the identifiers were minted from, because that is the
    // grouping the reader already has in the identifiers in front of them.
    if (requirement.category !== category) {
      category = requirement.category
      lines.push(`## ${category || options.noCategory}`, '')
    }
    lines.push(`### ${requirement.id}${requirement.title ? ` — ${requirement.title}` : ''}`)
    const meta = metaLine(requirement)
    if (meta) lines.push('', `*${meta}*`)
    const held = textOf(requirement, options.lang) ?? textOf(requirement, requirement.sourceLang)
    lines.push('', held ? held.body : '*—*', '')
    if (requirement.rationale) lines.push(`> ${requirement.rationale}`, '')
    if (requirement.source) lines.push(`Source : ${requirement.source}`, '')
  }
  return lines.join('\n')
}
