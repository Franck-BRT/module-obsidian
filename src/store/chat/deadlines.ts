import { fold } from '../library/libraryDoc'

/**
 * The dates a document sets — a delivery, a meeting, a start, a reception — found in its
 * text by the plugin, with the sentence each stands in, before the model reads it: a date
 * missed by the model, or one it makes up, is a milestone wrong in the plan. Relative
 * delays — « sous 15 jours », « dans un délai de 4 semaines » — are found too, to be
 * placed only when the document says from when.
 */

export interface FoundDate {
  /** YYYY-MM-DD. */
  date: string
  /** As the document wrote it. */
  written: string
  /** The sentence it stands in, shortened. */
  sentence: string
  /** Its year was not written: taken from the document's other dates, or this year. */
  guessedYear: boolean
}

export interface FoundDelay {
  /** As the document wrote it: « sous 15 jours ». */
  written: string
  sentence: string
}

const MONTHS: Record<string, number> = {
  janvier: 1,
  janv: 1,
  jan: 1,
  january: 1,
  fevrier: 2,
  fevr: 2,
  fev: 2,
  feb: 2,
  february: 2,
  mars: 3,
  mar: 3,
  march: 3,
  avril: 4,
  avr: 4,
  apr: 4,
  april: 4,
  mai: 5,
  may: 5,
  juin: 6,
  jun: 6,
  june: 6,
  juillet: 7,
  juil: 7,
  jul: 7,
  july: 7,
  aout: 8,
  aug: 8,
  august: 8,
  septembre: 9,
  sept: 9,
  sep: 9,
  september: 9,
  octobre: 10,
  oct: 10,
  october: 10,
  novembre: 11,
  nov: 11,
  november: 11,
  decembre: 12,
  dec: 12,
  december: 12
}

/** A date that exists, as YYYY-MM-DD; null for « 31/02 ». */
function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null
  const at = new Date(Date.UTC(year, month - 1, day))
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null
  return at.toISOString().slice(0, 10)
}

function fullYear(written: string): number {
  const year = Number(written)
  return written.length === 2 ? 2000 + year : year
}

/**
 * The text cut into sentences — at a full stop, a question or exclamation mark or a
 * semicolon followed by a space, or a line's end —, each with where it starts. « 30.06.2027 »
 * and « 2.3.1 » are no ends.
 */
function sentences(text: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = []
  let start = 0
  for (let at = 0; at <= text.length; at++) {
    const char = text[at] ?? ''
    const stop = '.!?;'.includes(char) && char !== '' && (at + 1 >= text.length || /\s/.test(text[at + 1]))
    if (at < text.length && char !== '\n' && !stop) continue
    const piece = text.slice(start, stop ? at + 1 : at)
    const value = piece.replace(/\s+/g, ' ').trim()
    if (value) out.push({ at: start + (piece.length - piece.trimStart().length), text: value })
    start = at + 1
  }
  return out
}

/** Longer than this, a sentence is cut around its date. */
const SENTENCE = 220

/** A table's row — two bars or more —: the whole row is what a date in it is about. */
function tableRow(line: string): string | null {
  if ((line.match(/\|/g) ?? []).length < 2) return null
  return line
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(' | ')
}

function around(text: string, at: number): string {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1
  const lineEnd = text.indexOf('\n', at)
  const row = tableRow(text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd))
  let found = row ?? ''
  if (!row) {
    for (const one of sentences(text)) {
      if (one.at > at) break
      found = one.text
    }
  }
  return found.length > SENTENCE ? `${found.slice(0, SENTENCE - 1)}…` : found
}

const MONTH_WORDS = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|')

/** « 14/10/2026 », « 30.06.2027 », « 14-10-2026 », « 14/10/26 »: one separator throughout, a sentence's full stop after it allowed. */
const NUMERIC = /(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\d/-]|\.\d)/g
const ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g
/** « 2 novembre 2026 », « 1er février », « 12 oct. 2026 » — on folded text. */
const WORDED = new RegExp(
  `(?<![\\p{L}\\d])(\\d{1,2})(?:er|re)?\\s+(${MONTH_WORDS})\\.?(?:\\s+(\\d{4}))?(?![\\p{L}])`,
  'gu'
)
/** « October 12, 2026 ». */
const ENGLISH = new RegExp(`(?<![\\p{L}])(${MONTH_WORDS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, 'gu')
/** « sous 15 jours », « dans un délai de 4 semaines », « within 30 days ». */
const DELAY =
  /(?:sous|dans un delai de|delai de|dans les|au plus tard|within|in)\s+(\d{1,3})\s+(?:jours?(?: ouvres| calendaires| ouvrables)?|semaines?|mois|days?|weeks?|months?)(?:\s+(?:a compter|apres|avant|suivant|from|after|before)[^.;\n]{0,60})?/g

/** At most this many: past them, the document is a planning, read as such by the model. */
const LIMIT = 80

/**
 * The dates of a text, in the order they come, each once by date and sentence; a day and
 * month without a year take the year the document writes most, or `year`.
 */
export function findDates(text: string, year = new Date().getFullYear()): FoundDate[] {
  // Folded for the month names, same length as the text: accents are one letter each.
  const folded = fold(text.normalize('NFC')).normalize('NFC')
  const same = folded.length === text.length ? folded : null
  const source = same ?? fold(text)
  const hits: { at: number; date: string; written: string; guessed: boolean }[] = []
  for (const found of source.matchAll(ISO)) {
    const date = iso(Number(found[1]), Number(found[2]), Number(found[3]))
    if (date) hits.push({ at: found.index ?? 0, date, written: found[0], guessed: false })
  }
  for (const found of source.matchAll(NUMERIC)) {
    // Two figures of year only after slashes: « 1.5.10 » is a version.
    if (found[4].length === 2 && found[2] !== '/') continue
    const date = iso(fullYear(found[4]), Number(found[3]), Number(found[1]))
    if (date) hits.push({ at: found.index ?? 0, date, written: found[0], guessed: false })
  }
  for (const found of source.matchAll(ENGLISH)) {
    const date = iso(Number(found[3]), MONTHS[found[1]], Number(found[2]))
    if (date) hits.push({ at: found.index ?? 0, date, written: found[0], guessed: false })
  }
  const years = new Map<number, number>()
  for (const hit of hits) {
    const own = Number(hit.date.slice(0, 4))
    years.set(own, (years.get(own) ?? 0) + 1)
  }
  for (const found of source.matchAll(WORDED)) {
    const given = found[3] !== undefined
    if (given) years.set(Number(found[3]), (years.get(Number(found[3])) ?? 0) + 1)
    hits.push({ at: found.index ?? 0, date: '', written: found[0], guessed: !given })
  }
  const usual = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? year
  const out: FoundDate[] = []
  const seen = new Set<string>()
  for (const hit of hits.sort((a, b) => a.at - b.at)) {
    let date = hit.date
    if (!date) {
      const found = new RegExp(WORDED.source, 'u').exec(hit.written)
      if (!found) continue
      date = iso(found[3] !== undefined ? Number(found[3]) : usual, MONTHS[found[2]], Number(found[1])) ?? ''
      if (!date) continue
    }
    const written = text.slice(hit.at, hit.at + hit.written.length) || hit.written
    const sentence = around(text, hit.at)
    const key = `${date}|${sentence}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ date, written: written.trim(), sentence, guessedYear: hit.guessed })
    if (out.length >= LIMIT) break
  }
  return out
}

/** The relative delays of a text: « sous 15 jours à compter de la notification ». */
export function findDelays(text: string): FoundDelay[] {
  const source = fold(text)
  const out: FoundDelay[] = []
  const seen = new Set<string>()
  for (const found of source.matchAll(DELAY)) {
    const at = found.index ?? 0
    const written = text.slice(at, at + found[0].length).trim()
    const sentence = around(text, at)
    if (seen.has(sentence)) continue
    seen.add(sentence)
    out.push({ written, sentence })
    if (out.length >= LIMIT / 2) break
  }
  return out
}

export interface DeadlineWords {
  intro: string
  file: (name: string) => string
  guessed: string
  delays: string
  none: string
}

/** The dates and delays found in each file, as the model is given them: a line each, with its sentence. */
export function deadlinesBlock(files: { name: string; text: string }[], words: DeadlineWords, year?: number): string {
  const parts = [words.intro]
  for (const file of files) {
    const dates = findDates(file.text, year)
    const delays = findDelays(file.text)
    parts.push(`### ${words.file(file.name)}`)
    if (!dates.length && !delays.length) parts.push(words.none)
    for (const one of dates) {
      parts.push(`- ${one.date}${one.guessedYear ? ` (${words.guessed})` : ''} — « ${one.written} » — ${one.sentence}`)
    }
    if (delays.length) {
      parts.push(words.delays)
      for (const one of delays) parts.push(`- « ${one.written} » — ${one.sentence}`)
    }
  }
  return parts.join('\n')
}

/** Whether a question asks for a document's deadlines, in either language. */
export function asksForDeadlines(question: string): boolean {
  return /echeance|date limite|dates? cles?|jalons?|delais?|calendrier|deadline|due date|milestone|key dates/.test(
    fold(question)
  )
}
