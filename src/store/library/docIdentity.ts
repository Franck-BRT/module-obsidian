import { baseNameOf } from './libraryDoc'

/**
 * A document's reference, edition and revision, as it says them — on its cover page, in its
 * header — or, failing that, as its file's name does: « Réf. : DLA-NM-0000000-01-PSP »,
 * « Édition 2 », « Révision 15 », « Indice B », « Version 2.1 », « Spec_ed2_rev15.pdf ».
 *
 * Read from the start of the text only, where documents say who they are; what is found
 * further down is as likely to be another document's reference, quoted.
 */

export interface DocIdentity {
  reference?: string
  edition?: string
  revision?: string
}

/** Where a document says who it is: its first pages. */
const HEAD = 6000

/** A number written with its zeros — « 02 » — said as people say it; a letter as it is. */
function value(raw: string): string {
  const clean = raw.trim()
  return /^\d+$/.test(clean) ? String(Number(clean)) : clean.toUpperCase()
}

const EDITION =
  /(?:^|[^\p{L}])(?:[ée]dition|issue|ed\.|[ée]d\.)\s*(?:n\s*[°o]\s*)?[:.]?\s*(\d{1,3}|[a-z])(?![\p{L}\d])/iu
const REVISION =
  /(?:^|[^\p{L}])(?:r[ée]vision|rev\.?|r[ée]v\.?)\s*(?:n\s*[°o]\s*)?[:.]?\s*(\d{1,3}|[a-z])(?![\p{L}\d])/iu
const INDEX = /(?:^|[^\p{L}])(?:indice|ind\.)\s*[:.]?\s*([a-z]\d?|\d{1,2})(?![\p{L}\d])/iu
const VERSION = /(?:^|[^\p{L}])version\s*[:.]?\s*(\d{1,3})(?:\.(\d{1,3}))?(?![\p{L}\d])/iu
const REFERENCE =
  /(?:^|[^\p{L}])(?:r[ée]f(?:[ée]rence)?|reference|doc(?:ument)?\.?\s*(?:n[°o]|no\.?|number|ref\.?))\s*\.?\s*(?:du document\s*)?[:.]?\s*([A-Z0-9][A-Z0-9][A-Z0-9_./-]*(?:\s?[-_/.]\s?[A-Z0-9]+)*)/iu

/** A reference worth the name: letters and figures mixed, separated, not a word nor a date. */
function plausibleReference(raw: string): string | undefined {
  const ref = raw.replace(/\s+/g, '').replace(/[-_./]+$/, '')
  if (ref.length < 5 || ref.length > 60) return undefined
  if (!/\d/.test(ref) || !/[A-Za-z]/.test(ref)) return undefined
  if (!/[-_./]/.test(ref)) return undefined
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(ref)) return undefined
  return ref
}

/** What the text and the file's name say of a document's reference, edition and revision. */
export function guessIdentity(text: string, fileName: string): DocIdentity {
  const head = text.slice(0, HEAD)
  const out: DocIdentity = {}
  const reference = REFERENCE.exec(head)?.[1]
  const ref = reference ? plausibleReference(reference) : undefined
  if (ref) out.reference = ref
  const edition = EDITION.exec(head)?.[1]
  const revision = REVISION.exec(head)?.[1] ?? INDEX.exec(head)?.[1]
  if (edition) out.edition = value(edition)
  if (revision) out.revision = value(revision)
  if (!out.edition && !out.revision) {
    const version = VERSION.exec(head)
    if (version) {
      out.edition = value(version[1])
      if (version[2]) out.revision = value(version[2])
    }
  }
  // The file's name, for what the text did not say: its first word when it is a code of
  // several parts — « ECSS-E-AS-11C » —, and « _ed2_rev15 », « indB », « v2.1 ».
  const name = ` ${baseNameOf(fileName).replace(/[_]+/g, ' ')} `
  if (!out.reference) {
    const first = name.trim().split(/\s+/)[0] ?? ''
    const code = plausibleReference(first)
    if (code && (code.match(/-/g) ?? []).length >= 2 && /^[A-Z0-9.-]+$/.test(code)) out.reference = code
  }
  if (!out.edition) {
    const found = /[\s-](?:ed|[ée]d|edition|[ée]dition)\s*[.-]?\s*(\d{1,3})(?=[\s-])/iu.exec(name)
    if (found) out.edition = value(found[1])
  }
  if (!out.revision) {
    const found = /[\s-](?:rev|r[ée]v|revision|r[ée]vision|ind|indice)\s*[.-]?\s*(\d{1,3}|[a-z])(?=[\s-])/iu.exec(name)
    if (found) out.revision = value(found[1])
  }
  if (!out.edition && !out.revision) {
    const found = /[\s-]v(\d{1,3})(?:\.(\d{1,3}))?(?=[\s-])/iu.exec(name)
    if (found) {
      out.edition = value(found[1])
      if (found[2]) out.revision = value(found[2])
    }
  }
  return out
}
