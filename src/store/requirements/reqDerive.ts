import type { ReqLinkKind, ReqText, Requirement } from './Requirement'

/**
 * A new requirement started from one that already exists.
 *
 * The everyday case in a requirements library: a system requirement is broken down into
 * the three that implement it, and each of the three starts as the parent said, then
 * says less and says it more precisely. Typing that out again is how a derived
 * requirement ends up saying something subtly different from the one it derives from.
 *
 * What is carried over is what the two requirements genuinely share — where it sits, how
 * it will be verified, who owns it, and the words to start from. What is not carried over
 * is everything that belongs to the original *as a thing that exists*: its identifier,
 * the names other documents know it by, the revisions it has been through, and its
 * standing.
 */

export interface DeriveOptions {
  /** Where the new one is filed, which decides the identifier it is minted. */
  category: string
  title: string
  /** How the new one relates to the one it came from. The link is written on the new one. */
  kind: ReqLinkKind
  /** Whose hand this is. Recorded on every wording, as a typed one would be. */
  by: string
  /**
   * What a brand new requirement's standing is — draft, normally.
   *
   * Never the original's. A requirement derived from an approved one has been approved by
   * nobody: copying the word across would put something in the library that says it was
   * agreed when it has not been read.
   */
  status: string
  at?: string
}

/** The wording, as the same words freshly written rather than as a record carried over. */
function restated(held: ReqText, by: string, at: string): ReqText {
  return {
    body: held.body,
    // The new requirement is at revision 1, so its wordings are written from revision 1.
    // Carrying the original's number over would leave a translation claiming to come
    // from a revision this requirement has never had.
    fromRev: 1,
    at,
    by,
    // Kept as they were: a translation a machine wrote and nobody read is still exactly
    // that once it has been copied, and saying otherwise here would launder it.
    origin: held.origin,
    reviewed: held.reviewed
  }
}

export function derivedFrom(source: Requirement, options: DeriveOptions): Partial<Requirement> {
  const at = options.at ?? new Date().toISOString()
  return {
    title: options.title,
    category: options.category,
    type: source.type,
    status: options.status,
    criticality: source.criticality,
    verification: source.verification,
    source: source.source,
    rationale: source.rationale,
    owner: source.owner,
    // A copy, never the original array: two requirements sharing one list of tags would
    // edit each other.
    tags: [...source.tags],
    // None. An alias is a name a document knows the *original* by, and handing it to the
    // copy would point every citation of it at the wrong requirement.
    aliases: [],
    sourceLang: source.sourceLang,
    rev: 1,
    text: Object.fromEntries(Object.entries(source.text).map(([lang, held]) => [lang, restated(held, options.by, at)])),
    // The one link, on the new requirement and pointing back: the far end needs no edit,
    // because what derives from what is read from this end in both directions.
    links: [{ kind: options.kind, to: source.id }],
    history: []
  }
}

/**
 * The relations that can hold between a new requirement and the one it came from.
 *
 * `satisfied-by` is left out: it points at a ticket in a plan, not at a requirement, and
 * a requirement satisfied by another requirement is not a thing.
 */
export const DERIVE_KINDS: ReqLinkKind[] = ['derives-from', 'refines', 'duplicates', 'conflicts-with']
