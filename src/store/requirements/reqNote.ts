import type { Requirement } from './Requirement'
import { requirementFrontmatter } from './reqYaml'
import { appendYaml } from '../YamlParser'
import { stringifyYaml } from 'obsidian'

/**
 * A requirement as a note somebody can read.
 *
 * The frontmatter is the record; the body is the courtesy. A requirement opened in plain
 * Obsidian, by someone who does not have this plugin, should still show the wording
 * rather than a wall of YAML — so every wording is echoed as a section, in a fixed order,
 * with the source language first because that is the one that governs.
 */

/** Source language first, then the rest alphabetically: a stable order, so saves don't churn. */
export function orderedLanguages(requirement: Requirement): string[] {
  const rest = Object.keys(requirement.text)
    .filter((lang) => lang !== requirement.sourceLang)
    .sort((a, b) => a.localeCompare(b))
  return Object.hasOwn(requirement.text, requirement.sourceLang) ? [requirement.sourceLang, ...rest] : rest
}

function generatedBody(requirement: Requirement): string {
  const lines: string[] = [`# ${requirement.id} — ${requirement.title}`.trimEnd(), '']
  for (const lang of orderedLanguages(requirement)) {
    lines.push(`## ${lang.toUpperCase()}`, '', requirement.text[lang].body.trim(), '')
  }
  return lines.join('\n')
}

/**
 * What is left of a note's body once this plugin's own output is taken out.
 *
 * Matched exactly, like the project notes: anything we did not write ourselves falls
 * through and is written back. The worst case is a paragraph kept twice, never one lost.
 */
export function requirementBodyRemainder(body: string, requirement: Requirement): string {
  const generated = generatedBody(requirement).trim()
  const rest = body.trim()
  return generated && rest.startsWith(generated) ? rest.slice(generated.length).trim() : rest
}

export function serializeRequirement(
  requirement: Requirement,
  foreign: Record<string, unknown> = {},
  extraBody = ''
): string {
  const lines: string[] = ['---']
  appendYaml(lines, requirementFrontmatter(requirement), 0)
  if (Object.keys(foreign).length) lines.push(stringifyYaml(foreign).trimEnd())
  lines.push('---', '')
  lines.push(generatedBody(requirement))
  if (extraBody.trim()) lines.push(extraBody.trim(), '')
  return lines.join('\n')
}
