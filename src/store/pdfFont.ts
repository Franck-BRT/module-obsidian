/**
 * How wide a line of text will be.
 *
 * A Word file hands the paragraph to Word and lets it break the lines. A PDF has no such
 * luxury: the file says where every line starts, so whoever writes it has to know how
 * wide the words are. Which means carrying the widths of the font being used.
 *
 * The font is Helvetica, one of the fourteen every PDF reader is required to have. So no
 * font is embedded, the file stays small, and it opens the same everywhere — at the price
 * of the characters Helvetica does not hold, which are replaced rather than dropped.
 */

/**
 * Adobe's Helvetica widths, in thousandths of the point size, for the printable ASCII
 * range. Every reader draws the text at exactly these widths, so a line measured with
 * them is a line that will fit.
 */
const ASCII: readonly number[] = [
  278,
  278,
  355,
  556,
  556,
  889,
  667,
  191,
  333,
  333,
  389,
  584,
  278,
  333,
  278,
  278, // 32-47
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  556,
  278,
  278,
  584,
  584,
  584,
  556, // 48-63
  1015,
  667,
  667,
  722,
  722,
  667,
  611,
  778,
  722,
  278,
  500,
  667,
  556,
  833,
  722,
  778, // 64-79
  667,
  778,
  722,
  667,
  611,
  722,
  667,
  944,
  667,
  667,
  611,
  278,
  278,
  278,
  469,
  556, // 80-95
  333,
  556,
  556,
  500,
  556,
  556,
  278,
  556,
  556,
  222,
  222,
  500,
  222,
  833,
  556,
  556, // 96-111
  556,
  556,
  333,
  500,
  278,
  556,
  500,
  722,
  500,
  500,
  500,
  334,
  260,
  334,
  584 //        112-126
]

/** The width of what Helvetica has beyond ASCII, where it is not simply the base letter's. */
const WIDE: Readonly<Record<string, number>> = {
  '€': 556,
  '…': 1000,
  '‘': 222,
  '’': 222,
  '“': 333,
  '”': 333,
  '•': 350,
  '–': 556,
  '—': 1000,
  '¡': 333,
  '¢': 556,
  '£': 556,
  '¤': 556,
  '¥': 556,
  '§': 556,
  '©': 737,
  ª: 370,
  '«': 556,
  '®': 737,
  '°': 400,
  '±': 584,
  '²': 333,
  '³': 333,
  µ: 556,
  '¶': 537,
  '·': 278,
  '¹': 333,
  º: 365,
  '»': 556,
  '¼': 834,
  '½': 834,
  '¾': 834,
  '¿': 611,
  '×': 584,
  '÷': 584,
  Æ: 1000,
  Ø: 778,
  Þ: 667,
  ß: 611,
  æ: 889,
  ø: 611,
  þ: 556,
  Œ: 1000,
  œ: 944,
  Š: 667,
  š: 500,
  Ÿ: 667,
  Ž: 611,
  ž: 500,
  ƒ: 556,
  '†': 556,
  '‡': 556,
  '‰': 1000,
  '‹': 333,
  '›': 333,
  ˆ: 333,
  '˜': 333,
  '¯': 333,
  '´': 333,
  '¨': 333,
  '¸': 333,
  '¬': 584,
  '¦': 260,
  '¤ ': 556
}

/**
 * An accented letter as the letter it is built on.
 *
 * Helvetica gives É exactly the width of E — an accent takes no room of its own — so a
 * table of every accented form would be a table of numbers already known.
 */
const BASE: Readonly<Record<string, string>> = {
  À: 'A',
  Á: 'A',
  Â: 'A',
  Ã: 'A',
  Ä: 'A',
  Å: 'A',
  Ç: 'C',
  È: 'E',
  É: 'E',
  Ê: 'E',
  Ë: 'E',
  Ì: 'I',
  Í: 'I',
  Î: 'I',
  Ï: 'I',
  Ð: 'D',
  Ñ: 'N',
  Ò: 'O',
  Ó: 'O',
  Ô: 'O',
  Õ: 'O',
  Ö: 'O',
  Ù: 'U',
  Ú: 'U',
  Û: 'U',
  Ü: 'U',
  Ý: 'Y',
  à: 'a',
  á: 'a',
  â: 'a',
  ã: 'a',
  ä: 'a',
  å: 'a',
  ç: 'c',
  è: 'e',
  é: 'e',
  ê: 'e',
  ë: 'e',
  ì: 'i',
  í: 'i',
  î: 'i',
  ï: 'i',
  ð: 'o',
  ñ: 'n',
  ò: 'o',
  ó: 'o',
  ô: 'o',
  õ: 'o',
  ö: 'o',
  ù: 'u',
  ú: 'u',
  û: 'u',
  ü: 'u',
  ý: 'y',
  ÿ: 'y'
}

/** The width of one character, in thousandths. Anything unknown is given the common width. */
export function charWidth(char: string): number {
  const code = char.charCodeAt(0)
  if (code >= 32 && code <= 126) return ASCII[code - 32]
  const based = BASE[char]
  if (based) return ASCII[based.charCodeAt(0) - 32]
  return WIDE[char] ?? 556
}

/** The width of a string at a given size, in points. */
export function textWidth(text: string, size: number): number {
  let total = 0
  for (const char of text) total += charWidth(char)
  return (total * size) / 1000
}

/**
 * A paragraph broken into lines that fit.
 *
 * Broken at spaces, and inside a word only when the word alone is wider than the column —
 * an identifier like REQ-THERM-0001 in a narrow cell has to go somewhere, and a line
 * running out past the margin is worse than one broken mid-word.
 *
 * Returns at least one line, so a caller measuring a paragraph's height never measures
 * nothing for text that is there.
 */
export function wrapText(text: string, size: number, width: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (textWidth(candidate, size) <= width || !line) {
        if (textWidth(candidate, size) <= width) {
          line = candidate
          continue
        }
        // The word is alone on its line and still too wide: cut it where it stops fitting.
        let rest = candidate
        while (textWidth(rest, size) > width && rest.length > 1) {
          let cut = rest.length - 1
          while (cut > 1 && textWidth(rest.slice(0, cut), size) > width) cut -= 1
          out.push(rest.slice(0, cut))
          rest = rest.slice(cut)
        }
        line = rest
        continue
      }
      out.push(line)
      line = word
    }
    out.push(line)
  }
  return out
}
