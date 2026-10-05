import { fold, type LibraryDoc } from '../library/libraryDoc'
import type { NoteEntry } from '../notes/NoteLibrary'

/**
 * A question asked of the whole library: the passages of its documents and notes that
 * answer it best, found without the reader choosing any, sent with the question so the
 * reply stands on them and says where each thing comes from.
 *
 * What each says is cut into passages of a few paragraphs; each is scored by how often it
 * holds the question's words, the rarer words counting for more (BM25), and a source whose
 * title or description holds them counts for more too. The best passages are taken, a few
 * a source, until the room given is spent.
 */

export interface LibrarySource {
  /** The file a link to it opens: a document's file, a note. */
  path: string
  title: string
  kind: 'document' | 'note'
  /** What else is known of it, on one line: its category, projects, date. */
  detail: string
  /** What it says; '' when it has not been read — a scan — and only its title can match. */
  text: string
}

export interface FoundSource {
  source: LibrarySource
  /** Its passages taken, in the order they come in it. */
  passages: string[]
}

export interface RetrievalOptions {
  /** Characters of passages, all sources together. */
  budget: number
  /** Passages taken from one source at most. */
  perSource: number
  /** Sources taken at most. */
  maxSources: number
}

export const RETRIEVAL_DEFAULTS: RetrievalOptions = { budget: 36000, perSource: 3, maxSources: 10 }

/** The size a passage is cut to, in characters, give or take a paragraph's end. */
const PASSAGE = 1000

/** Words a question asks with that say nothing of what it is about. */
const STOP = new Set(
  (
    'les des une aux dans sur pour par avec sans que qui quoi quel quelle quels quelles est sont ont cette ces ' +
    'son ses leur leurs elle ils elles nous vous pas plus moins tout tous toute toutes comme mais donc car ' +
    'dit dire fait faire etre avoir quand comment pourquoi combien peux peut dois doit entre apres avant ' +
    'aussi encore deja tres bien selon chez vers the and for with what which who how when where why does ' +
    'this that these those from are was were have has can about into document documents note notes ' +
    'bibliotheque fichier fichiers dans donne donner resume resumer explique expliquer cherche trouve ' +
    'moi toi paragraphe paragraphes article articles section sections chapitre alinea'
  ).split(' ')
)

/** A word as it is compared: folded, a plural's last « s » taken off. */
function stem(word: string): string {
  return word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word
}

/** Section numbers as written — « 6.3.5 », « 4.2 » —, two levels at least, not a date's. */
const SECTION_REF = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){1,5}(?![\d])/g

/** The section numbers a text cites, once each: « 6.3.5 », « 12.1 ». */
export function sectionRefs(text: string): string[] {
  return [...new Set(text.match(SECTION_REF) ?? [])]
}

/** A text's words as they are compared: folded, stemmed, those of one letter left out — its section numbers whole. */
export function tokens(text: string): string[] {
  const words = fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2)
    .map(stem)
  return [...words, ...(text.match(SECTION_REF) ?? [])]
}

/**
 * What a question is about, as words to find: its words of three letters and more — or
 * with a figure in them, « P3 », « 12 » — without those that only ask.
 */
export function searchTerms(question: string): string[] {
  // A section number is looked for whole: « 6.3.5 », not « 6 », « 3 » and « 5 ».
  const sections = sectionRefs(question)
  const words = fold(question.replace(SECTION_REF, ' '))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => (word.length >= 3 || /\d/.test(word)) && !STOP.has(word))
    .map(stem)
  return [...new Set([...sections, ...words])]
}

/**
 * A text cut into passages of whole paragraphs, about `size` characters each; a
 * paragraph longer than that is cut at a sentence's end, or failing one at a space.
 */
export function passagesOf(text: string, size = PASSAGE): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const out: string[] = []
  let current = ''
  const flush = (): void => {
    if (current) out.push(current)
    current = ''
  }
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > size) flush()
    if (paragraph.length <= size) {
      current = current ? `${current}\n\n${paragraph}` : paragraph
      continue
    }
    flush()
    let rest = paragraph
    while (rest.length > size) {
      const window = rest.slice(0, size)
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'))
      const space = window.lastIndexOf(' ')
      const cut = sentence > size * 0.5 ? sentence + 1 : space > size * 0.5 ? space : size
      out.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    current = rest
  }
  flush()
  return out
}

/**
 * The section number a line heads, when it is a heading: « 6.3.5 Essais », « ### 6.3.5 »,
 * « § 6.3.5 – Essais », « Article 6.3.5 » — a short line, the number at its start.
 */
function headingRef(line: string): string | null {
  const bare = line.replace(/^\s*#{0,6}\s*(?:§|art\.?|article)?\s*/i, '')
  const found = /^(\d{1,3}(?:\.\d{1,3})*)\.?(?=\s|$|[-–—)])/.exec(bare)
  if (!found) return null
  // A long line is a heading only when a title follows its number — the reader of some
  // PDF runs the heading into its first sentence —, not « 7 jours après… ».
  if (bare.length > 160 && !/^[\s\-–—)]*\p{Lu}/u.test(bare.slice(found[0].length))) return null
  return found[1]
}

/** Whether section `a` comes after `b` in a document's order: 6.4 after 6.3.5, 7 after 6.3.5. */
function after(a: string, b: string): boolean {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let at = 0; at < Math.max(x.length, y.length); at++) {
    const left = x[at] ?? -1
    const right = y[at] ?? -1
    if (left !== right) return left > right
  }
  return false
}

/**
 * A numbered section of a text, whole: from its heading to the next heading that is not
 * one of its own subsections — its sibling, its parent's sibling. A numbered list inside
 * it, « 1. », « 2. », does not end it: those come before it in the document's order. Of
 * the lines heading it — a table of contents names it too —, the one with the longest
 * section is it. Null when no line heads it.
 */
export function sectionText(text: string, ref: string, limit = SECTION_LIMIT): string | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let best: string | null = null
  lines.forEach((line, start) => {
    if (headingRef(line) !== ref) return
    let end = lines.length
    for (let at = start + 1; at < lines.length; at++) {
      const other = headingRef(lines[at])
      // Its sibling or what follows ends it; so does its own number or its parent's met
      // again — the contents' line for it ending where the document itself begins.
      if (
        other &&
        !other.startsWith(`${ref}.`) &&
        (after(other, ref) || other === ref || ref.startsWith(`${other}.`))
      ) {
        end = at
        break
      }
    }
    const section = lines.slice(start, end).join('\n').trim()
    if (!best || section.length > best.length) best = section
  })
  if (!best) return null
  const whole: string = best
  return whole.length > limit ? `${whole.slice(0, limit)} […]` : whole
}

/** The most of a section given whole, in characters. */
const SECTION_LIMIT = 8000

interface Candidate {
  source: LibrarySource
  at: number
  text: string
  words: string[]
  score: number
}

/** The passages of the library that answer a question best, by source, the best source first. */
export function retrieve(
  sources: LibrarySource[],
  question: string,
  options: RetrievalOptions = RETRIEVAL_DEFAULTS
): FoundSource[] {
  const terms = searchTerms(question)
  if (!terms.length) return []
  const candidates: Candidate[] = []
  const named = new Map<LibrarySource, Set<string>>()
  for (const source of sources) {
    const heading = new Set(tokens(`${source.title} ${source.detail} ${source.path}`))
    const folded = fold(source.text)
    // Only what holds one of the words at least is cut and scored: a library of thousands
    // of documents is looked through at once.
    const inText = terms.some((term) => folded.includes(term))
    const inHeading = terms.some((term) => heading.has(term))
    if (!inText && !inHeading) continue
    named.set(source, heading)
    const passages = source.text.trim() ? passagesOf(source.text) : [[source.title, source.detail].join(' — ')]
    passages.forEach((text, at) => candidates.push({ source, at, text, words: tokens(text), score: 0 }))
  }
  // A section the question names, given whole and first: what it asks is all in it.
  const refs = sectionRefs(question)
  const sections: Candidate[] = []
  for (const source of refs.length ? named.keys() : []) {
    for (const ref of refs) {
      const text = source.text ? sectionText(source.text, ref) : null
      if (text && text.length > ref.length + 20) {
        sections.push({ source, at: -1, text, words: [], score: Number.MAX_VALUE })
      }
    }
  }
  if (!candidates.length) return []

  // BM25 over the passages looked at, with a source's title counting for each of its passages.
  const count = candidates.length
  const average = candidates.reduce((sum, each) => sum + each.words.length, 0) / count || 1
  const idf = new Map<string, number>()
  for (const term of terms) {
    const holding = candidates.filter((each) => each.words.includes(term)).length
    idf.set(term, Math.log(1 + (count - holding + 0.5) / (holding + 0.5)))
  }
  for (const candidate of candidates) {
    const frequencies = new Map<string, number>()
    for (const word of candidate.words) frequencies.set(word, (frequencies.get(word) ?? 0) + 1)
    let score = 0
    let matched = 0
    for (const term of terms) {
      const weight = idf.get(term) ?? 0
      const frequency = frequencies.get(term) ?? 0
      const titled = named.get(candidate.source)?.has(term) ?? false
      if (frequency || titled) matched++
      if (frequency) {
        score += (weight * frequency * 2.2) / (frequency + 1.2 * (0.25 + (0.75 * candidate.words.length) / average))
      }
      if (titled) score += weight
    }
    // A passage holding more of the question's words is worth more than one saying one of
    // them often: what it holds of the question, squared, weighs on it.
    candidate.score = score * (matched / terms.length) ** 2
  }

  const ranked = [
    ...sections,
    ...candidates.filter((each) => each.score > 0).sort((a, b) => b.score - a.score || a.at - b.at)
  ]
  const taken = new Map<LibrarySource, Candidate[]>()
  let spent = 0
  for (const candidate of ranked) {
    const already = taken.get(candidate.source)
    // A passage the section given whole holds already is not given twice.
    if (candidate.at >= 0 && already?.some((one) => one.at < 0 && one.text.includes(candidate.text.slice(0, 120)))) {
      continue
    }
    if (!already && taken.size >= options.maxSources) continue
    if (already && already.length >= options.perSource) continue
    if (spent + candidate.text.length > options.budget) {
      if (spent) continue
    }
    spent += candidate.text.length
    if (already) already.push(candidate)
    else taken.set(candidate.source, [candidate])
  }
  return [...taken].map(([source, passages]) => ({
    source,
    passages: passages.sort((a, b) => a.at - b.at).map((each) => each.text)
  }))
}

export interface RetrievalWords {
  /** What the passages are and how they are to be used. */
  intro: string
  /** Said when nothing was found. */
  none: string
  /** A source's heading, with its number to cite it by. */
  heading: (index: number, title: string) => string
}

/** The link a reply cites a source by: its path, named by its title. */
export function sourceLink(source: LibrarySource): string {
  const title = source.title.replace(/[[\]|]/g, ' ').trim()
  return `[[${source.path}|${title || source.path}]]`
}

/** The passages found, as the model is given them: each source with its link and what is known of it. */
export function retrievalContext(found: FoundSource[], words: RetrievalWords): string {
  if (!found.length) return words.none
  const blocks = found.map(({ source, passages }, index) => {
    const quoted = passages.map((passage) =>
      passage
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    )
    return [
      `### ${words.heading(index + 1, source.title)}`,
      [source.detail, sourceLink(source)].filter(Boolean).join(' · '),
      ...quoted.flatMap((block, at) => (at ? ['>', '> …', '>', block] : [block]))
    ].join('\n')
  })
  return [words.intro, ...blocks].join('\n\n')
}

export interface SourceWords {
  document: string
  note: string
  issuedBy: (issuer: string) => string
  addedOn: (date: string) => string
}

/** A document of the library as a source: its file, its title, how it is filed, what it says. */
export function documentSource(
  doc: LibraryDoc,
  text: string,
  projectTitle: (path: string) => string,
  words: SourceWords
): LibrarySource {
  return {
    path: doc.file,
    title: doc.title,
    kind: 'document',
    detail: [
      words.document,
      doc.category,
      doc.lot,
      doc.issuer ? words.issuedBy(doc.issuer) : '',
      ...doc.projects.map(projectTitle),
      doc.added ? words.addedOn(doc.added) : ''
    ]
      .filter(Boolean)
      .join(' · '),
    text
  }
}

/** A note of the notes library as a source: its folder, projects and tags said with it. */
export function noteSource(
  entry: NoteEntry,
  text: string,
  projectTitle: (path: string) => string,
  words: SourceWords
): LibrarySource {
  return {
    path: entry.path,
    title: entry.title,
    kind: 'note',
    detail: [words.note, entry.subfolder, ...entry.projects.map(projectTitle), ...entry.tags.map((tag) => `#${tag}`)]
      .filter(Boolean)
      .join(' · '),
    text
  }
}

/**
 * The passages answering the last of the questions asked; a question too short to find
 * anything by — « et pour le lot 3 ? » — is looked up with the one before it.
 */
export function lookUp(
  sources: LibrarySource[],
  questions: string[],
  options: RetrievalOptions = RETRIEVAL_DEFAULTS
): FoundSource[] {
  const last = questions[questions.length - 1] ?? ''
  const found = retrieve(sources, last, options)
  if (found.length || questions.length < 2) return found
  return retrieve(sources, `${questions[questions.length - 2]}\n${last}`, options)
}
