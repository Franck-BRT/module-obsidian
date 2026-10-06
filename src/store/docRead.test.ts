import { describe, expect, it } from 'vitest'
import { cleanWordText, readDoc } from './docRead'
import { isRtf, readRtf } from './rtfRead'
import { fileText } from './chat/chatFile'
import { bytesOf, footnote, simpleTable, word6 } from '../../test/docFixtures'

const FIXTURES: Record<string, string> = {
  'simple-table.doc': simpleTable,
  'Word6.doc': word6,
  'footnote.doc': footnote
}

/** Word 6's file, marked as protected by a password, as Word marks one: a bit of its header. */
function locked(): Uint8Array {
  const bytes = bytesOf(word6).slice()
  for (let at = 0; at < bytes.length - 12; at++) {
    if (bytes[at] === 0xdc && bytes[at + 1] === 0xa5 && bytes[at + 2] === 0x65 && bytes[at + 3] === 0x00) {
      bytes[at + 0x0b] |= 0x01
      break
    }
  }
  return bytes
}

const fixture = (name: string): Uint8Array => (name === 'locked' ? locked() : bytesOf(FIXTURES[name]))

describe('readDoc, on files Word wrote', () => {
  it('reads a Word 97 document, its table as rows of cells', () => {
    expect(readDoc(fixture('simple-table.doc'))).toBe(
      [
        'This is a Word document that was created using Word 97 – SR2.  It contains a paragraph, a table consisting of 2 rows and 3 columns and a final paragraph.',
        '| Cell 1,1 | Cell 1,2 | Cell 1,3 |',
        '| Cell 2,1 | Cell 2,2 | Cell 2,3 |',
        'This text is below the table.'
      ].join('\n')
    )
  })

  it('reads a Word 6 document', () => {
    expect(readDoc(fixture('Word6.doc'))).toBe('The quick brown fox jumps over the lazy dog')
  })

  it('reads the footnotes and the endnotes after the body', () => {
    expect(readDoc(fixture('footnote.doc'))).toBe('Test text\n\nTestFootnote\n\nTestEndnote')
  })

  it('refuses one protected by a password, saying so', () => {
    expect(() => readDoc(fixture('locked'))).toThrow(/password/)
  })

  it('says a file is not one', () => {
    expect(() => readDoc(new TextEncoder().encode('pas un document'))).toThrow(/not a Word/)
  })
})

describe('cleanWordText', () => {
  it('keeps what a field shows, not its code, and drops the marks that are not text', () => {
    const raw =
      'Voir \u0013 HYPERLINK "https://x" \u0014le site\u0015 ici\u0001.\rPage \u0013 PAGE \u0015\u0002suite\u001fment\u001e1 kg\r'
    expect(cleanWordText(raw)).toBe('Voir le site ici.\nPage suitement-1 kg')
  })
})

describe('readRtf', () => {
  const rtf = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0))

  it('reads paragraphs, accents by byte and by number, and leaves the tables of fonts out', () => {
    const doc = rtf(
      '{\\rtf1\\ansi\\ansicpg1252{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}' +
        "{\\*\\generator Writer;}\\f0 Sp\\'e9cification du lot\\par " +
        'Co\\u251?t : 1\\~200 \\u8364? \\endash  fin.\\par}'
    )
    expect(isRtf(doc)).toBe(true)
    expect(readRtf(doc)).toBe('Spécification du lot\nCoût : 1 200 € – fin.')
  })

  it('reads a table as rows of cells, and a field by what it shows', () => {
    const doc = rtf(
      '{\\rtf1\\ansi Avant\\par\\trowd\\intbl A\\cell B\\cell\\row\\intbl C\\cell D\\cell\\row ' +
        '{\\field{\\*\\fldinst HYPERLINK "https://x"}{\\fldrslt le site}}\\par}'
    )
    expect(readRtf(doc)).toBe('Avant\n| A | B |\n| C | D |\nle site')
  })
})

describe('fileText, on an old Word document', () => {
  it('reads a .doc by what it is: Word 97, RTF, or plain text', async () => {
    expect(await fileText('doc', fixture('Word6.doc'))).toBe('The quick brown fox jumps over the lazy dog')
    expect(await fileText('doc', new TextEncoder().encode('{\\rtf1\\ansi Bonjour\\par}'))).toBe('Bonjour')
    expect(await fileText('DOC', new TextEncoder().encode('Texte brut'))).toBe('Texte brut')
    await expect(fileText('doc', fixture('locked'))).rejects.toThrow('unreadable')
  })
})
