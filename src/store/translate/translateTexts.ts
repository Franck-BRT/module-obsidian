import type { ChatRequest } from '../llm'
import { parseJsonContent } from '../llm/protocol'
import { fold } from '../library/libraryDoc'
import { languageName } from '../requirements/translate'

/**
 * A document's texts translated by the model, a batch of paragraphs at a time — numbered,
 * in order, so it reads them as the passage they are and gives each back under its
 * number —, with the reader's glossary: the terms that must come out a given way, or
 * stay as they are. A batch answered wrong is asked again a paragraph at a time.
 */

export interface GlossaryEntry {
  source: string
  /** The same as the source for a term to keep as it is. */
  target: string
  /** The language it is for, as a code; '' for every one. */
  language: string
}

const LANGUAGE_WORDS: Record<string, string> = {
  francais: 'fr',
  french: 'fr',
  anglais: 'en',
  english: 'en',
  allemand: 'de',
  german: 'de',
  deutsch: 'de',
  espagnol: 'es',
  spanish: 'es',
  italien: 'it',
  italian: 'it',
  portugais: 'pt',
  portuguese: 'pt',
  neerlandais: 'nl',
  dutch: 'nl'
}

/** The language a heading names — « Français », « ## fr », « Vers l’anglais » —; '' for none. */
function headingLanguage(heading: string): string {
  const folded = fold(heading).trim()
  // A code alone — « ## fr », « ## en-GB » —, never a word that happens to be one: « de ».
  const code = /^([a-z]{2})(?:[-_][a-z]{2})?$/.exec(folded)?.[1]
  if (code && languageName(code) !== code.toUpperCase()) return code
  for (const word of folded.split(/[^a-z]+/)) if (LANGUAGE_WORDS[word]) return LANGUAGE_WORDS[word]
  return ''
}

/**
 * The glossary a note writes: under a heading naming a language, the terms for it; before
 * any, for every one. A term is a table's row — source, then target —, or a line
 * « source → target », « source -> target », « source = target », « - source : target »;
 * a list item with one term is a term to keep as it is.
 */
export function parseGlossary(text: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = []
  let language = ''
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let inFront = lines[0]?.trim() === '---'
  for (const [at, raw] of lines.entries()) {
    const line = raw.trim()
    if (inFront) {
      if (at > 0 && line === '---') inFront = false
      continue
    }
    if (!line || line.startsWith('%%') || line.startsWith('>')) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      language = headingLanguage(heading[1])
      continue
    }
    const add = (source: string, target: string): void => {
      const s = source.trim().replace(/^\*\*|\*\*$/g, '')
      const t = target.trim().replace(/^\*\*|\*\*$/g, '')
      if (s) out.push({ source: s, target: t || s, language })
    }
    if (line.startsWith('|')) {
      const cells = line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim())
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
      // A table's first row is its heading.
      const next = lines[at + 1]?.trim() ?? ''
      if (/^\|?\s*:?-{2,}/.test(next)) continue
      if (cells[0]) add(cells[0], cells[1] ?? '')
      continue
    }
    const item = line.replace(/^[-*+]\s+/, '')
    const isItem = item !== line
    const arrow = /^(.+?)\s*(?:→|->|=>|=)\s*(.+)$/.exec(item)
    if (arrow) {
      add(arrow[1], arrow[2])
      continue
    }
    if (isItem) {
      const colon = /^(.+?)\s+:\s+(.+)$/.exec(item)
      if (colon) add(colon[1], colon[2])
      else add(item, item)
    }
  }
  return out
}

/** The glossary's terms for a language that a text uses, accents and case aside. */
export function glossaryFor(entries: GlossaryEntry[], language: string, text: string): GlossaryEntry[] {
  const folded = fold(text)
  const code = language.trim().toLowerCase().split(/[-_]/)[0]
  return entries.filter((entry) => (!entry.language || entry.language === code) && folded.includes(fold(entry.source)))
}

/** The texts gathered into batches: no more than `items` nor, but for one alone, `chars`. */
export function batches(texts: string[], chars = 3000, items = 30): string[][] {
  const out: string[][] = []
  let current: string[] = []
  let size = 0
  for (const text of texts) {
    if (current.length && (size + text.length > chars || current.length >= items)) {
      out.push(current)
      current = []
      size = 0
    }
    current.push(text)
    size += text.length
  }
  if (current.length) out.push(current)
  return out
}

function glossaryLines(entries: GlossaryEntry[]): string {
  if (!entries.length) return ''
  return [
    'Glossary — these terms must be translated exactly so (a term given as itself stays as it is):',
    ...entries.map((entry) => `- ${entry.source} → ${entry.target}`)
  ].join('\n')
}

/** The instruction for a document's paragraphs. */
export function translationInstruction(to: string, glossary: GlossaryEntry[]): string {
  return [
    `You translate the paragraphs of a technical document into ${languageName(to)}.`,
    'The paragraphs follow each other in the document: read them as one text, and translate each one faithfully and completely, in the register of the source.',
    'Keep every number, unit, reference, identifier, article or clause number, standard, acronym and product name exactly as written; change only the decimal separator to the target convention.',
    'An obligation stays an obligation and a recommendation a recommendation: never soften nor strengthen.',
    'Keep tab characters and line breaks where they are. Never merge, split, drop or reorder paragraphs.',
    `A paragraph already in ${languageName(to)}, or that is only a code, a name or a figure, is given back unchanged.`,
    glossaryLines(glossary),
    'You are given a JSON object whose keys number the paragraphs. Answer with a JSON object holding the same keys, each with its translation, and nothing else.'
  ]
    .filter(Boolean)
    .join('\n')
}

export function batchRequest(model: string, texts: string[], to: string, glossary: GlossaryEntry[]): ChatRequest {
  const numbered: Record<string, string> = {}
  for (const [at, text] of texts.entries()) numbered[String(at + 1)] = text
  return {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: translationInstruction(to, glossary) },
      { role: 'user', content: JSON.stringify(numbered, null, 1) }
    ]
  }
}

/** One paragraph alone, its translation answered as plain text. */
export function singleRequest(model: string, text: string, to: string, glossary: GlossaryEntry[]): ChatRequest {
  return {
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: [
          `Translate the text you are given into ${languageName(to)}, faithfully and completely.`,
          'Keep numbers, units, references, identifiers, acronyms and names as written; keep tabs and line breaks.',
          glossaryLines(glossary),
          'Answer with the translation only: no preamble, no quotes, no comment.'
        ]
          .filter(Boolean)
          .join('\n')
      },
      { role: 'user', content: text }
    ]
  }
}

/** The translations a batch's reply gives, in order; null when one is missing or not text. */
export function readBatch(reply: string, count: number): string[] | null {
  let parsed: unknown
  try {
    parsed = parseJsonContent<unknown>(reply)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const row = parsed as Record<string, unknown>
  const out: string[] = []
  for (let at = 1; at <= count; at++) {
    const value = row[String(at)]
    if (typeof value !== 'string' || !value.trim()) return null
    out.push(value)
  }
  return out
}

/** A plain reply cleaned: a fence or quotes the model wrapped it in taken off. */
export function readSingle(reply: string): string {
  return reply
    .trim()
    .replace(/^```\w*\n?|\n?```$/g, '')
    .replace(/^["«“]\s*|\s*["»”]$/g, '')
    .trim()
}

export class TranslationStopped extends Error {}

export interface TextTranslator {
  chat: (request: ChatRequest) => Promise<string>
}

/**
 * Every text translated, by its source: the batches one after another, `progress` told
 * how many texts are done; `stopped` asked between batches.
 */
export async function translateTexts(
  client: TextTranslator,
  texts: string[],
  options: { model: string; to: string; glossary: GlossaryEntry[] },
  progress: (done: number, total: number) => void = () => {},
  stopped: () => boolean = () => false
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let done = 0
  progress(0, texts.length)
  for (const batch of batches(texts)) {
    if (stopped()) throw new TranslationStopped()
    const terms = glossaryFor(options.glossary, options.to, batch.join('\n'))
    const reply = await client.chat(batchRequest(options.model, batch, options.to, terms))
    const read = readBatch(reply, batch.length)
    if (read) {
      for (const [at, text] of batch.entries()) out.set(text, read[at])
    } else {
      // Answered wrong as a batch: each paragraph asked alone.
      for (const text of batch) {
        if (stopped()) throw new TranslationStopped()
        const own = glossaryFor(options.glossary, options.to, text)
        const single = readSingle(await client.chat(singleRequest(options.model, text, options.to, own)))
        if (single) out.set(text, single)
        progress(++done, texts.length)
      }
      continue
    }
    done += batch.length
    progress(done, texts.length)
  }
  return out
}
