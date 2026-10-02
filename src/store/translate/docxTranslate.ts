import { unzip } from '../unzip'
import { escapeXml } from '../xml'
import { utf8, zip, type ZipEntry } from '../zip'

/**
 * A Word document translated in place: each paragraph's text replaced by its translation
 * inside the document itself, everything else — styles, numbering, tables, images,
 * headers, footers, page setup — left exactly as it was. The text of a paragraph is
 * gathered from its runs, translated whole — a sentence split over three runs is one
 * sentence —, and written back into the run that held most of it; the others are
 * emptied. Its tabs and line breaks travel with the text. A field's result — a table of
 * contents, a page number, a cross-reference — is left for Word to update.
 */

/** A piece of a paragraph's text, where it stands in the part's XML. */
interface Piece {
  start: number
  end: number
  kind: 'text' | 'tab' | 'break'
  text: string
}

export interface DocxParagraph {
  pieces: Piece[]
}

/** The parts of a document that hold text a reader reads. */
export function isTextPart(name: string): boolean {
  return /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })
}

const TAG = /<(\/?)([\w.-]+:[\w.-]+|[\w.-]+)((?:\s[^>]*?)?)(\/?)>/g

function attribute(attributes: string, name: string): string {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(attributes)?.[1] ?? ''
}

/**
 * The paragraphs of a part, each with the pieces of its own text — a paragraph inside a
 * text box is one of its own —, in the order they close.
 */
export function scanParagraphs(xml: string): DocxParagraph[] {
  const out: DocxParagraph[] = []
  const open: DocxParagraph[] = []
  /** The fields open: their code, then their result — neither is text to translate. */
  const fields: ('code' | 'result')[] = []
  let runs = 0
  let tabStops = 0
  let text: { start: number; from: number } | null = null
  for (const found of xml.matchAll(TAG)) {
    const [whole, closing, name, attributes, selfClosing] = found
    const at = found.index ?? 0
    const paragraph = open[open.length - 1]
    const collecting = !!paragraph && runs > 0 && !fields.length
    switch (name) {
      case 'w:p':
        if (selfClosing) break
        if (closing) {
          const done = open.pop()
          if (done) out.push(done)
        } else open.push({ pieces: [] })
        break
      case 'w:r':
        if (selfClosing) break
        runs += closing ? -1 : 1
        if (runs < 0) runs = 0
        break
      case 'w:tabs':
        if (!selfClosing) tabStops += closing ? -1 : 1
        break
      case 'w:fldChar': {
        const type = attribute(attributes, 'w:fldCharType')
        if (type === 'begin') fields.push('code')
        else if (type === 'separate' && fields.length) fields[fields.length - 1] = 'result'
        else if (type === 'end') fields.pop()
        break
      }
      case 'w:fldSimple':
        if (selfClosing) break
        if (closing) fields.pop()
        else fields.push('result')
        break
      case 'w:t':
        if (selfClosing) break
        if (!closing) text = { start: at, from: at + whole.length }
        else if (text) {
          if (collecting) {
            paragraph.pieces.push({
              start: text.start,
              end: at + whole.length,
              kind: 'text',
              text: decodeXml(xml.slice(text.from, at))
            })
          }
          text = null
        }
        break
      case 'w:tab':
        if (collecting && !tabStops && selfClosing) {
          paragraph.pieces.push({ start: at, end: at + whole.length, kind: 'tab', text: '\t' })
        }
        break
      case 'w:br': {
        const type = attribute(attributes, 'w:type')
        if (collecting && selfClosing && (!type || type === 'textWrapping')) {
          paragraph.pieces.push({ start: at, end: at + whole.length, kind: 'break', text: '\n' })
        }
        break
      }
      case 'w:cr':
        if (collecting && selfClosing) {
          paragraph.pieces.push({ start: at, end: at + whole.length, kind: 'break', text: '\n' })
        }
        break
    }
  }
  return out.filter((paragraph) => paragraph.pieces.some((piece) => piece.kind === 'text'))
}

/** A paragraph's text as it reads, its tabs and line breaks kept. */
export function paragraphText(paragraph: DocxParagraph): string {
  return paragraph.pieces.map((piece) => piece.text).join('')
}

/** Whether a text says something to translate: a letter in it, not only figures and marks. */
export function worthTranslating(text: string): boolean {
  return /\p{L}{2,}/u.test(text)
}

/** A translation as runs' content: text, tabs and line breaks. */
function runContent(text: string): string {
  return text
    .split(/(\t|\n)/)
    .map((part) => {
      if (part === '\t') return '<w:tab/>'
      if (part === '\n') return '<w:br/>'
      return part ? `<w:t xml:space="preserve">${escapeXml(part)}</w:t>` : ''
    })
    .join('')
}

/**
 * The part with its paragraphs translated: for each, the translation `translated` gives
 * for its text — none, and it stays as it is.
 */
export function rewriteParagraphs(
  xml: string,
  paragraphs: DocxParagraph[],
  translated: (text: string) => string | undefined
): string {
  const edits: { start: number; end: number; text: string }[] = []
  for (const paragraph of paragraphs) {
    const source = paragraphText(paragraph)
    const core = source.trim()
    const translation = core ? translated(core) : undefined
    if (translation === undefined || translation === core) continue
    const lead = source.slice(0, source.length - source.trimStart().length)
    const tail = source.slice(source.trimEnd().length)
    const texts = paragraph.pieces.filter((piece) => piece.kind === 'text')
    // The run that held most of the text takes all of it: its look is the paragraph's.
    const target = texts.reduce((best, piece) => (piece.text.length > best.text.length ? piece : best), texts[0])
    for (const piece of paragraph.pieces) {
      edits.push({
        start: piece.start,
        end: piece.end,
        text: piece === target ? runContent(lead + translation + tail) : ''
      })
    }
  }
  edits.sort((a, b) => b.start - a.start)
  let out = xml
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  return out
}

/** Word's name for a language: `fr` is `fr-FR`. */
export function wordLanguage(code: string): string {
  const key = code.trim().toLowerCase()
  const region: Record<string, string> = {
    fr: 'fr-FR',
    en: 'en-GB',
    de: 'de-DE',
    es: 'es-ES',
    it: 'it-IT',
    pt: 'pt-PT',
    nl: 'nl-NL',
    pl: 'pl-PL'
  }
  return region[key] ?? (key.includes('-') ? code.trim() : key)
}

/** The proofing language set to `language`, where the part names one: Word then checks it as such. */
export function setProofingLanguage(xml: string, language: string): string {
  return xml.replace(/(<w:lang\b[^>]*?\sw:val=")([^"]*)(")/g, `$1${language}$3`)
}

export interface DocxTranslation {
  /** The texts to translate, each once, in the order they come. */
  texts: string[]
  /** The document rebuilt, each text replaced by what `translated` gives for it. */
  build: (translated: (text: string) => string | undefined) => Uint8Array
}

/** A Word document opened for translation: what it says, and how to write it back translated. */
export async function openDocxForTranslation(bytes: Uint8Array, language: string): Promise<DocxTranslation> {
  const entries = await unzip(bytes)
  if (!entries.some((entry) => entry.name === 'word/document.xml')) throw new Error('not a Word document')
  const decoder = new TextDecoder()
  const parts = entries
    .filter((entry) => isTextPart(entry.name))
    .map((entry) => {
      const xml = decoder.decode(entry.data)
      return { name: entry.name, xml, paragraphs: scanParagraphs(xml) }
    })
  const texts: string[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    for (const paragraph of part.paragraphs) {
      const text = paragraphText(paragraph).trim()
      if (!text || !worthTranslating(text) || seen.has(text)) continue
      seen.add(text)
      texts.push(text)
    }
  }
  const word = wordLanguage(language)
  return {
    texts,
    build: (translated) => {
      const rewritten = new Map(
        parts.map((part) => [
          part.name,
          setProofingLanguage(rewriteParagraphs(part.xml, part.paragraphs, translated), word)
        ])
      )
      const out: ZipEntry[] = entries.map((entry) => {
        const xml = rewritten.get(entry.name)
        if (xml !== undefined) return { name: entry.name, data: utf8(xml) }
        if (entry.name === 'word/styles.xml') {
          return { name: entry.name, data: utf8(setProofingLanguage(decoder.decode(entry.data), word)) }
        }
        return entry
      })
      return zip(out)
    }
  }
}

/** The name a translation is given: the source's, with the language after it. */
export function translatedName(file: string, language: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  return `${base} (${language.toUpperCase()})${ext}`
}
