import { makeId } from '../../types'

/**
 * A requirement: one normative statement, in as many languages as it is written in.
 *
 * The identity is the `id`, not the file name and not the text. A requirement whose
 * wording is rewritten is the same requirement — that is the whole premise of traceability
 * — so the id is allocated once, never reused, and nothing else is allowed to carry it.
 */

/** One language's wording of a requirement. */
export interface ReqText {
  body: string
  /**
   * The revision of the source wording this was written from.
   *
   * This one number is the whole staleness mechanism: a translation made from revision 5
   * of a requirement now at revision 7 has not been updated, and nobody has to remember
   * to say so. A flag somebody must set is a flag somebody forgets.
   */
  fromRev: number
  at: string
  by: string
  /** Whether a person wrote it or a machine did. Never guessed: recorded at the source. */
  origin: 'human' | 'machine'
  /** A machine wording a person has read and accepted. Meaningless on a human one. */
  reviewed: boolean
}

export interface ReqRevision {
  rev: number
  at: string
  by: string
  /** Which wording changed. */
  lang: string
  /** What it said before, so a change can be read rather than merely counted. */
  was: string
  note: string
}

export interface ReqLink {
  kind: ReqLinkKind
  /** The id of the other requirement, or of a ticket for the kinds that reach out. */
  to: string
  /**
   * Set when the far end changed after this link was made: the link may no longer hold
   * and nobody has checked. Cleared only by a person saying they have looked.
   */
  suspect?: boolean
}

/**
 * The relations a requirement can carry, in the vocabulary the trade already uses.
 *
 * `satisfied-by` is the one that leaves the library: it points at a ticket in a plan,
 * which is what makes the whole thing worth having inside this plugin rather than beside
 * it.
 */
export const REQ_LINK_KINDS = ['derives-from', 'refines', 'conflicts-with', 'duplicates', 'satisfied-by'] as const
export type ReqLinkKind = (typeof REQ_LINK_KINDS)[number]

/** How a requirement is to be shown to be met. The four of systems engineering. */
export const VERIFICATION_METHODS = ['test', 'analysis', 'inspection', 'demonstration', 'none'] as const
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number]

export interface Requirement {
  id: string
  title: string
  /** The category its id was minted under. Changing it never changes the id. */
  category: string
  type: string
  status: string
  criticality: string
  verification: VerificationMethod
  /** Where it came from: a standard, a client document, a meeting. Free text on purpose. */
  source: string
  rationale: string
  owner: string
  tags: string[]
  /**
   * Other names this same requirement answers to.
   *
   * Not a second identity: one requirement, cited under the numbering a given project or
   * customer uses. The id stays what it is — it is what the counters, the links and the
   * baselines are written in — and an alias is what a document is allowed to call it.
   */
  aliases: string[]
  /** The language the requirement is authored in; every other wording is a translation. */
  sourceLang: string
  /** Bumped whenever the source wording changes. Translations are measured against it. */
  rev: number
  text: Record<string, ReqText>
  links: ReqLink[]
  history: ReqRevision[]
  createdAt: string
  updatedAt: string
  filePath?: string
}

export function makeReqText(over: Partial<ReqText> = {}): ReqText {
  return {
    body: '',
    fromRev: 1,
    at: new Date().toISOString(),
    by: '',
    origin: 'human',
    reviewed: true,
    ...over
  }
}

export function makeRequirement(over: Partial<Requirement> = {}): Requirement {
  const now = new Date().toISOString()
  return {
    id: over.id ?? `req-${makeId().slice(0, 8)}`,
    title: '',
    category: '',
    type: '',
    status: '',
    criticality: '',
    verification: 'none',
    source: '',
    rationale: '',
    owner: '',
    tags: [],
    aliases: [],
    sourceLang: 'fr',
    rev: 1,
    text: {},
    links: [],
    history: [],
    createdAt: now,
    updatedAt: now,
    ...over
  }
}

/** The wording in one language, or null where it has not been written. */
export function textOf(requirement: Requirement, lang: string): ReqText | null {
  return requirement.text[lang] ?? null
}

/** The wording to show: the one asked for, falling back to the language it was written in. */
export function displayText(requirement: Requirement, lang: string): ReqText | null {
  return textOf(requirement, lang) ?? textOf(requirement, requirement.sourceLang)
}

/**
 * Whether a wording has fallen behind the source.
 *
 * The source language is never stale against itself: it *is* the source. Everything else
 * is judged on the revision it was made from.
 */
export function isStale(requirement: Requirement, lang: string): boolean {
  if (lang === requirement.sourceLang) return false
  const held = textOf(requirement, lang)
  return held === null ? false : held.fromRev < requirement.rev
}

/** Every translation that no longer matches the source, in the order given. */
export function staleLanguages(requirement: Requirement, langs: string[]): string[] {
  return langs.filter((lang) => isStale(requirement, lang))
}

/** Languages the reader wants that this requirement does not have at all. */
export function missingLanguages(requirement: Requirement, langs: string[]): string[] {
  return langs.filter((lang) => textOf(requirement, lang) === null)
}

/**
 * Writes one language's wording, and keeps the rest honest about it.
 *
 * Changing the source bumps the revision, which is what makes every translation read as
 * behind without any of them being touched. Changing a translation is not a change to the
 * requirement — it is that translation catching up — so the revision stays put.
 *
 * Writing the same words again changes nothing at all: an editor that saves on every
 * keystroke must not manufacture a revision history out of one edit.
 */
export function setText(
  requirement: Requirement,
  lang: string,
  body: string,
  by: string,
  origin: ReqText['origin'] = 'human'
): Requirement {
  const previous = textOf(requirement, lang)
  if (previous && previous.body === body && previous.origin === origin) return requirement

  const now = new Date().toISOString()
  const isSource = lang === requirement.sourceLang
  const rev = isSource && previous ? requirement.rev + 1 : requirement.rev
  const written = makeReqText({
    body,
    // A translation records the source it was made from; the source records itself.
    fromRev: isSource ? rev : requirement.rev,
    at: now,
    by,
    origin,
    // A machine wording starts unreviewed. A person writing counts as having read it.
    reviewed: origin === 'human'
  })

  const history: ReqRevision[] =
    previous === null
      ? requirement.history
      : [...requirement.history, { rev, at: now, by, lang, was: previous.body, note: '' }]

  return {
    ...requirement,
    rev,
    text: { ...requirement.text, [lang]: written },
    history,
    updatedAt: now,
    // A source that moved puts every link to this requirement in doubt; the far ends are
    // marked by the store, which can see them. What is marked here is what this one holds.
    links: isSource && previous ? requirement.links.map((link) => ({ ...link, suspect: true })) : requirement.links
  }
}

/** A person saying they have read a machine wording. The only way `reviewed` becomes true. */
export function acceptText(requirement: Requirement, lang: string, by: string): Requirement {
  const held = textOf(requirement, lang)
  if (held === null || held.reviewed) return requirement
  return {
    ...requirement,
    text: { ...requirement.text, [lang]: { ...held, reviewed: true, by, at: new Date().toISOString() } },
    updatedAt: new Date().toISOString()
  }
}

/** A wording written by a machine that nobody has read yet. */
export function isUnreviewedMachine(requirement: Requirement, lang: string): boolean {
  const held = textOf(requirement, lang)
  return held !== null && held.origin === 'machine' && !held.reviewed
}

/* ---- Links ---------------------------------------------------------------- */

function sameLink(link: ReqLink, kind: ReqLinkKind, to: string): boolean {
  return link.kind === kind && link.to.toUpperCase() === to.toUpperCase()
}

/**
 * Adds a relation, once.
 *
 * The same pair asserted twice is the same assertion, and a requirement that says it
 * derives from REQ-SYS-0001 three times is a traceability matrix with three cells where
 * there is one fact.
 */
export function addLink(requirement: Requirement, kind: ReqLinkKind, to: string): Requirement {
  const target = to.trim()
  if (!target || target.toUpperCase() === requirement.id.toUpperCase()) return requirement
  if (requirement.links.some((link) => sameLink(link, kind, target))) return requirement
  return {
    ...requirement,
    links: [...requirement.links, { kind, to: target }],
    updatedAt: new Date().toISOString()
  }
}

export function removeLink(requirement: Requirement, kind: ReqLinkKind, to: string): Requirement {
  const links = requirement.links.filter((link) => !sameLink(link, kind, to))
  if (links.length === requirement.links.length) return requirement
  return { ...requirement, links, updatedAt: new Date().toISOString() }
}

/**
 * A person saying they have looked at a link the far end moved under.
 *
 * Only a person can do this. The tool can tell that a relation may no longer hold; it
 * cannot tell that it still does, and clearing the mark on its own would turn the whole
 * mechanism into decoration.
 */
export function clearSuspect(requirement: Requirement, kind: ReqLinkKind, to: string): Requirement {
  if (!requirement.links.some((link) => sameLink(link, kind, to) && link.suspect)) return requirement
  return {
    ...requirement,
    links: requirement.links.map((link) => {
      if (!sameLink(link, kind, to)) return link
      const { suspect: _dropped, ...rest } = link
      return rest
    }),
    updatedAt: new Date().toISOString()
  }
}

/**
 * Marks every link pointing at a requirement that has just moved.
 *
 * This is the direction that matters. A requirement marking its own links when its words
 * change says "what I derive from may have shifted under me"; this says "what I say about
 * that requirement was written against words it no longer has", which is the one a review
 * has to act on.
 */
export function markLinksToward(requirement: Requirement, movedId: string): Requirement {
  if (!requirement.links.some((link) => link.to.toUpperCase() === movedId.toUpperCase() && !link.suspect)) {
    return requirement
  }
  return {
    ...requirement,
    links: requirement.links.map((link) =>
      link.to.toUpperCase() === movedId.toUpperCase() ? { ...link, suspect: true } : link
    ),
    updatedAt: new Date().toISOString()
  }
}

/** The relations of one kind this requirement asserts. */
export function linksOfKind(requirement: Requirement, kind: ReqLinkKind): ReqLink[] {
  return requirement.links.filter((link) => link.kind === kind)
}

export function hasSuspectLinks(requirement: Requirement): boolean {
  return requirement.links.some((link) => link.suspect === true)
}
