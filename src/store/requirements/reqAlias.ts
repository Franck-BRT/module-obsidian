import type { Requirement } from './Requirement'
import { parseReqId } from './reqId'

/**
 * The other names a requirement answers to.
 *
 * One requirement, several names: the library numbers it REQ-SYS-0001 and the project it
 * is delivered under cites it as OMLX-SYS-0001. Not a copy — a copy is right on the day
 * it is made and wrong from the next revision — and not a renaming either, because the
 * id is what every link, counter and baseline in here is written in.
 *
 * So an alias is a way in, never a way of storing anything: everything the plugin decides
 * is decided about the requirement the alias led to.
 *
 * A name is unique across the whole library, ids and aliases together. Two requirements
 * answering to one name would make a citation ambiguous, and a citation that resolves to
 * whichever one was read first is worse than one that fails.
 */

/**
 * An alias as it is stored.
 *
 * Upper case like an identifier, because that is what it stands in for and two spellings
 * of one name are two names. Commas and semicolons come out: a `pm-req` block separates
 * the identifiers it quotes with them, so an alias holding one could never be cited.
 */
export function normalizeAlias(raw: string): string {
  return raw.trim().toUpperCase().replace(/[,;]/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

/**
 * A prefix as it can lead an alias: what a project is called, made citable.
 *
 * Accents are dropped rather than transliterated, for the same reason they are in a
 * category: an identifier is read aloud and typed by hand more often than it is copied.
 */
export function aliasPrefix(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The same identifier under another prefix: REQ-SYS-0001 and OMLX give OMLX-SYS-0001.
 *
 * The category and the number are carried over untouched, which is the whole point — the
 * alias is the same requirement said in another vocabulary, and a number that shifted in
 * translation would be a different requirement.
 */
export function aliasWithPrefix(id: string, prefix: string): string {
  const lead = aliasPrefix(prefix)
  const parsed = parseReqId(id)
  if (!lead || !parsed) return ''
  const rest = id
    .trim()
    .toUpperCase()
    .slice(id.trim().indexOf('-') + 1)
  return `${lead}-${rest}`
}

/** Every name this requirement answers to, its own first. */
export function namesOf(requirement: Requirement): string[] {
  return [requirement.id, ...requirement.aliases]
}

/**
 * The requirement already answering to a name, if any.
 *
 * Asked before an alias is accepted, and asked about identifiers as well as aliases: an
 * alias that shadows another requirement's id is the worst of the two, because the
 * requirement it hides is the one that cannot be renamed out of the way.
 */
export function nameOwner(library: Requirement[], name: string, exceptId = ''): Requirement | null {
  const wanted = normalizeAlias(name)
  if (!wanted) return null
  const skip = exceptId.trim().toUpperCase()
  for (const requirement of library) {
    if (requirement.id.toUpperCase() === skip) continue
    if (namesOf(requirement).some((held) => held.toUpperCase() === wanted)) return requirement
  }
  return null
}

/** The requirement a cited name leads to, by id or by any alias. */
export function findByName(library: Requirement[], name: string): Requirement | null {
  const wanted = name.trim().toUpperCase()
  if (!wanted) return null
  return library.find((requirement) => namesOf(requirement).some((held) => held.toUpperCase() === wanted)) ?? null
}

/**
 * Adds an alias, or says why it cannot be added.
 *
 * Refusing is part of the job: an alias equal to the requirement's own id says nothing,
 * and one already spoken for would make a citation ambiguous. Both come back as the
 * requirement unchanged, so a caller that ignores the reason cannot corrupt anything.
 */
export function addAlias(requirement: Requirement, raw: string): Requirement {
  const alias = normalizeAlias(raw)
  if (!alias || alias === requirement.id.toUpperCase()) return requirement
  if (requirement.aliases.some((held) => held.toUpperCase() === alias)) return requirement
  return { ...requirement, aliases: [...requirement.aliases, alias], updatedAt: new Date().toISOString() }
}

export function removeAlias(requirement: Requirement, raw: string): Requirement {
  const alias = normalizeAlias(raw)
  const aliases = requirement.aliases.filter((held) => held.toUpperCase() !== alias)
  if (aliases.length === requirement.aliases.length) return requirement
  return { ...requirement, aliases, updatedAt: new Date().toISOString() }
}

/** Stored aliases made safe: normalized, without the requirement's own id, each one once. */
export function cleanAliases(raw: unknown, id: string): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>([id.trim().toUpperCase()])
  const kept: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const alias = normalizeAlias(entry)
    if (!alias || seen.has(alias)) continue
    seen.add(alias)
    kept.push(alias)
  }
  return kept
}
