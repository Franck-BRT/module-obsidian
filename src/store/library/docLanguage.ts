import { fold } from './libraryDoc'

/**
 * The language a document is written in, guessed from what it says: by the small words
 * every sentence of a language is full of — articles, prepositions, auxiliaries —, each
 * language's own as far as can be. A text too short, or too evenly shared between two
 * languages, is not guessed at.
 */

const WORDS: Record<string, string[]> = {
  fr: [
    'le',
    'les',
    'des',
    'et',
    'est',
    'une',
    'du',
    'dans',
    'pour',
    'qui',
    'sur',
    'pas',
    'au',
    'avec',
    'sont',
    'ce',
    'cette',
    'aux',
    'nous',
    'ou',
    'etre',
    'doit'
  ],
  en: [
    'the',
    'and',
    'of',
    'to',
    'is',
    'that',
    'for',
    'are',
    'with',
    'as',
    'on',
    'be',
    'this',
    'by',
    'it',
    'not',
    'from',
    'which',
    'shall',
    'an'
  ],
  de: [
    'der',
    'die',
    'das',
    'und',
    'ist',
    'nicht',
    'zu',
    'den',
    'mit',
    'von',
    'dem',
    'ein',
    'eine',
    'fur',
    'auf',
    'sich',
    'auch',
    'wird',
    'werden',
    'oder'
  ],
  es: [
    'el',
    'los',
    'las',
    'y',
    'es',
    'por',
    'para',
    'con',
    'del',
    'se',
    'al',
    'como',
    'mas',
    'pero',
    'su',
    'sus',
    'esta',
    'lo',
    'entre',
    'debe'
  ],
  it: [
    'il',
    'di',
    'che',
    'e',
    'per',
    'non',
    'sono',
    'della',
    'gli',
    'delle',
    'nel',
    'alla',
    'anche',
    'questo',
    'essere',
    'dei',
    'ha',
    'deve',
    'degli',
    'nella'
  ],
  pt: [
    'o',
    'os',
    'do',
    'da',
    'em',
    'um',
    'uma',
    'com',
    'nao',
    'dos',
    'das',
    'na',
    'no',
    'ao',
    'pelo',
    'pela',
    'sao',
    'mais',
    'deve',
    'sera'
  ],
  nl: [
    'het',
    'een',
    'en',
    'van',
    'is',
    'dat',
    'op',
    'te',
    'niet',
    'voor',
    'met',
    'zijn',
    'worden',
    'wordt',
    'ook',
    'bij',
    'aan',
    'deze',
    'naar',
    'moet'
  ]
}

const SETS = Object.entries(WORDS).map(([code, words]) => [code, new Set(words)] as const)

/** The text looked at: enough to tell, not so much that a long document takes long. */
const SAMPLE = 20_000

/** The language's code — fr, en, de, es, it, pt, nl —, or '' when it cannot be told. */
export function detectLanguage(text: string): string {
  const words = fold(text.slice(0, SAMPLE)).split(/[^a-z]+/)
  const scores = SETS.map(
    ([code, set]) => [code, words.reduce((sum, word) => sum + (set.has(word) ? 1 : 0), 0)] as const
  )
  scores.sort((a, b) => b[1] - a[1])
  const [best, next] = scores
  if (!best || best[1] < 8) return ''
  return best[1] >= next[1] * 1.4 ? best[0] : ''
}
