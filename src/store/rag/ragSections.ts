import { citedSections, headedSections, searchTerms, sectionRefs, sectionText } from '../chat/libraryRetrieval'
import type { RagEntry } from './RagIndex'
import type { FoundInVault, FoundPassage } from './ragSearch'

/**
 * The vault search's passages completed by whole sections, as the library's search does:
 * the section a question names by its number, the one whose heading says what it asks,
 * the one a passage found sends its reader to — each given whole, first, rather than the
 * passage of a thousand characters that happened to hold its heading.
 */

/** A source's text as it was read, put back together from its passages, their headings as lines. */
export function entryText(entry: RagEntry): string {
  const out: string[] = []
  let last = ''
  for (const passage of entry.passages) {
    const heading = passage.heading.split(' › ').pop() ?? ''
    if (heading && heading !== last) out.push(`#### ${heading}`)
    last = heading
    out.push(passage.text)
  }
  return out.join('\n\n')
}

/** Sections from other sources than those found: only for a number the question names, and a few. */
const OTHERS = 2
/** Sections a source's found passages send to, at most. */
const CITED = 2

export function withSections(found: FoundInVault[], all: RagEntry[], query: string, budget: number): FoundInVault[] {
  const refs = sectionRefs(query)
  const words = searchTerms(query).filter((term) => !refs.includes(term))
  const texts = new Map<RagEntry, string>()
  const textOf = (entry: RagEntry): string => {
    let text = texts.get(entry)
    if (text === undefined) {
      text = entryText(entry)
      texts.set(entry, text)
    }
    return text
  }
  const sections = new Map<RagEntry, string[]>()
  const give = (entry: RagEntry, ref: string): boolean => {
    const text = sectionText(textOf(entry), ref)
    if (!text || text.length <= ref.length + 20) return false
    const list = sections.get(entry) ?? []
    if (list.includes(text)) return false
    sections.set(entry, [...list, text])
    return true
  }
  for (const { entry, passages } of found) {
    for (const ref of refs) give(entry, ref)
    if (words.length >= 2) for (const ref of headedSections(textOf(entry), words)) give(entry, ref)
    const cited = passages.flatMap((passage) => citedSections(passage.text))
    let added = 0
    for (const ref of cited) if (added < CITED && give(entry, ref)) added++
  }
  // A number the question names, in a document the search did not bring: looked for there too.
  const named: RagEntry[] = []
  for (const entry of refs.length ? all : []) {
    if (named.length >= OTHERS) break
    if (found.some((one) => one.entry === entry) || entry.kind !== 'document') continue
    if (refs.some((ref) => give(entry, ref))) named.push(entry)
  }
  if (!sections.size) return found

  const result: FoundInVault[] = [...named.map((entry) => ({ entry, passages: [] as FoundPassage[] })), ...found].map(
    ({ entry, passages }) => {
      const whole = sections.get(entry) ?? []
      const given: FoundPassage[] = whole.map((text, at) => ({
        at: -whole.length + at - 1,
        heading: '',
        text,
        around: false
      }))
      // A passage the section given whole holds already is not given twice.
      const rest = passages.filter((passage) => !whole.some((text) => text.includes(passage.text.slice(0, 120))))
      return { entry, passages: [...given, ...rest] }
    }
  )
  // Those with a section named first; then within the room, the passages around others let go first.
  result.sort((a, b) => Number(sections.has(b.entry)) - Number(sections.has(a.entry)))
  let spent = result.reduce(
    (sum, one) => sum + one.passages.reduce((total, passage) => total + passage.text.length, 0),
    0
  )
  for (let one = result.length - 1; one >= 0 && spent > budget; one--) {
    const passages = result[one].passages
    for (let at = passages.length - 1; at >= 0 && spent > budget; at--) {
      if (!passages[at].around) continue
      spent -= passages[at].text.length
      passages.splice(at, 1)
    }
  }
  return result.filter((one) => one.passages.length)
}
