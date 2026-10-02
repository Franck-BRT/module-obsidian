import { fold } from './libraryDoc'

/**
 * The versions of one document, known by their names: « CCTP lot 02 ind A.pdf » and
 * « CCTP lot 02 ind B.pdf », « Plan RDC v1 » and « Plan RDC v2 », « Note rév. 3 » — the
 * same document, issued again. What tells them apart is taken off; what is left names the
 * document.
 */

/** Words that number an issue, and what follows them: « ind B », « indice C », « v2 », « rév. 3 », « édition 2 ». */
const ISSUE =
  /(?:^|[\s_\-(])(?:ind(?:ice)?|rev(?:ision)?|v(?:ersion)?|ed(?:ition)?|issue)\s*[.:°#-]?\s*[a-z]?\d{0,3}[a-z]?(?=$|[\s_\-)])/g

/** An issue letter left alone at the end, or a number after a dash: « Plan RDC B », « Plan RDC - B », « Note_3 » — not « lot 02 ». */
const TRAILING = /(?:\s*[-_]+\s*(?:[a-z]|\d{1,2})|\s+[a-z])$/

/**
 * What a document is called, whatever its issue: its name folded, its extension, its issue
 * and its separators taken off. '' when nothing is left that names it.
 */
export function versionKey(name: string): string {
  let key = fold(name.trim())
    .replace(/\.[a-z0-9]{1,5}$/, '')
    .replace(/\(\d+\)$/, '')
    .trim()
  key = key.replace(ISSUE, ' ').trim()
  key = key.replace(TRAILING, '').trim()
  key = key
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Too short to say which document it is: « Plan », « CR ».
  return key.replace(/\s/g, '').length >= 4 ? key : ''
}

export interface VersionCandidate {
  record: string
  title: string
  file: string
  hash: string
  added: string
  previous?: string
}

/**
 * The version a document newly in the library follows: of the documents already there
 * known by the same name and saying something else, the one no other follows yet — the
 * last of its line —, the latest added when there are several. Null when there is none.
 */
export function previousVersion(doc: VersionCandidate, others: VersionCandidate[]): VersionCandidate | null {
  const keys = (one: VersionCandidate): string[] =>
    [versionKey(one.title), versionKey(one.file.slice(one.file.lastIndexOf('/') + 1))].filter(Boolean)
  const own = new Set(keys(doc))
  if (!own.size) return null
  const same = others.filter(
    (one) => one.record !== doc.record && one.hash !== doc.hash && keys(one).some((key) => own.has(key))
  )
  const followed = new Set(same.map((one) => one.previous).filter(Boolean))
  const heads = same.filter((one) => !followed.has(one.record))
  const pool = heads.length ? heads : same
  return [...pool].sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1 : 0))[0] ?? null
}
