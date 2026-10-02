import { unzip } from '../unzip'
import { escapeXml } from '../xml'
import { utf8, zip, type ZipEntry } from '../zip'

/**
 * An Office document translated in place — a Word document or a PowerPoint deck —: each
 * paragraph's text replaced by its translation inside the file itself, everything else —
 * styles, numbering, tables, images, layouts, headers, footers, notes — left exactly as
 * it was. The text of a paragraph is gathered from its runs, translated whole — a
 * sentence split over three runs is one sentence —, and written back into the run that
 * held most of it; the others are emptied. Its tabs and line breaks travel with the
 * text. A field's result — a table of contents, a page or slide number, a
 * cross-reference — is left for Word or PowerPoint to update.
 *
 * Word writes its text as WordprocessingML (`w:p`, `w:r`, `w:t`), PowerPoint as
 * DrawingML (`a:p`, `a:r`, `a:t`): the same shape, told apart by a dialect. In DrawingML
 * a run must hold its text and a line break stands between runs, so the run that takes
 * the translation is written again whole, and the runs emptied are taken out.
 *
 * Excel keeps a cell's text as SpreadsheetML: a shared string (`si`), an inline string
 * (`is`) or a comment's text (`text`), made of runs (`r`) or of a text alone (`t`), its
 * line breaks in the text itself. A text a formula, a validation list or a conditional
 * format names between quotes is left as it is: translated, the formula would no longer
 * find it — unless asked for, and then it is translated in the formula too, the same.
 * A table's column names stay: its header cells must keep them.
 */

export type Dialect = 'word' | 'drawing' | 'sheet'

/** A piece of a paragraph's text, where it stands in the part's XML. */
interface Piece {
  start: number
  end: number
  kind: 'text' | 'tab' | 'break'
  text: string
  /** DrawingML: the run holding it — its bounds, and what opens it up to its text. */
  run?: { start: number; end: number; head: string }
}

export interface DocxParagraph {
  pieces: Piece[]
}

/** The parts of a Word document that hold text a reader reads. */
export function isTextPart(name: string): boolean {
  return /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)
}

/** The parts of an Excel workbook that hold text a reader reads, and how each writes it. */
export function workbookPart(name: string): Dialect | null {
  if (/^xl\/(sharedStrings|worksheets\/sheet\d+|comments\d+|comments\/comment\d+)\.xml$/.test(name)) return 'sheet'
  if (/^xl\/(drawings\/drawing\d+|charts\/chart\d+)\.xml$/.test(name)) return 'drawing'
  return null
}

/** The parts of a PowerPoint deck that hold text a reader reads: slides, notes, diagrams, charts. */
export function isSlidePart(name: string): boolean {
  return /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+|diagrams\/(data|drawing)\d+|charts\/chart\d+)\.xml$/.test(
    name
  )
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

/** The element names of a dialect. */
const NAMES = {
  word: { p: 'w:p', r: 'w:r', t: 'w:t' },
  drawing: { p: 'a:p', r: 'a:r', t: 'a:t' },
  sheet: { p: 'si', r: 'r', t: 't' }
}

/** SpreadsheetML's paragraphs: a shared string, an inline string, a comment's text. */
const SHEET_PARAGRAPHS = new Set(['si', 'is', 'text'])

/**
 * The paragraphs of a part, each with the pieces of its own text — a paragraph inside a
 * text box is one of its own —, in the order they close.
 */
export function scanParagraphs(xml: string, dialect: Dialect = 'word'): DocxParagraph[] {
  const names = NAMES[dialect]
  const out: DocxParagraph[] = []
  const open: DocxParagraph[] = []
  /** The fields open: their code, then their result — neither is text to translate. */
  const fields: ('code' | 'result')[] = []
  let runs = 0
  let tabStops = 0
  let text: { start: number; from: number } | null = null
  let run: { start: number; pieces: Piece[] } | null = null
  let lineBreak: { start: number } | null = null
  /** SpreadsheetML: inside a phonetic reading, which is no text of the cell's. */
  let phonetic = 0
  for (const found of xml.matchAll(TAG)) {
    const [whole, closing, rawName, attributes, selfClosing] = found
    const at = found.index ?? 0
    const paragraph = open[open.length - 1]
    // A cell's text may stand alone, outside any run.
    const collecting = !!paragraph && (runs > 0 || dialect === 'sheet') && !fields.length && !phonetic
    const name = dialect === 'sheet' && SHEET_PARAGRAPHS.has(rawName) ? names.p : rawName
    if (dialect === 'sheet' && name === 'rPh' && !selfClosing) {
      phonetic += closing ? -1 : 1
      continue
    }
    switch (name) {
      case names.p:
        if (selfClosing) break
        if (closing) {
          const done = open.pop()
          if (done) out.push(done)
        } else open.push({ pieces: [] })
        break
      case names.r:
        if (selfClosing) break
        runs += closing ? -1 : 1
        if (runs < 0) runs = 0
        if (dialect === 'drawing') {
          if (!closing) run = { start: at, pieces: [] }
          else if (run) {
            const bounds = { start: run.start, end: at + whole.length }
            for (const piece of run.pieces) piece.run = { ...bounds, head: xml.slice(run.start, piece.start) }
            run = null
          }
        }
        break
      case names.t:
        if (selfClosing) break
        if (!closing) text = { start: at, from: at + whole.length }
        else if (text) {
          if (collecting) {
            const piece: Piece = {
              start: text.start,
              end: at + whole.length,
              kind: 'text',
              text: decodeXml(xml.slice(text.from, at))
            }
            paragraph.pieces.push(piece)
            run?.pieces.push(piece)
          }
          text = null
        }
        break
      // WordprocessingML
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
      case 'a:fld':
        if (selfClosing) break
        if (closing) fields.pop()
        else fields.push('result')
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
      // DrawingML: a line break stands between runs, and may hold the look of the line.
      case 'a:br':
        if (!paragraph || fields.length) break
        if (selfClosing) paragraph.pieces.push({ start: at, end: at + whole.length, kind: 'break', text: '\n' })
        else if (!closing) lineBreak = { start: at }
        else if (lineBreak) {
          paragraph.pieces.push({ start: lineBreak.start, end: at + whole.length, kind: 'break', text: '\n' })
          lineBreak = null
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

/** A translation as a Word run's content: text, tabs and line breaks. */
function wordRunContent(text: string): string {
  return text
    .split(/(\t|\n)/)
    .map((part) => {
      if (part === '\t') return '<w:tab/>'
      if (part === '\n') return '<w:br/>'
      return part ? `<w:t xml:space="preserve">${escapeXml(part)}</w:t>` : ''
    })
    .join('')
}

/** A translation as DrawingML runs, each like the one given, line breaks between them; tabs stay in the text. */
function drawingRuns(text: string, head: string): string {
  return text
    .split('\n')
    .map((line) => `${head}<a:t>${escapeXml(line)}</a:t></a:r>`)
    .join('<a:br/>')
}

/**
 * The part with its paragraphs translated: for each, the translation `translated` gives
 * for its text — none, and it stays as it is.
 */
export function rewriteParagraphs(
  xml: string,
  paragraphs: DocxParagraph[],
  translated: (text: string) => string | undefined,
  dialect: Dialect = 'word'
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
    const whole = lead + translation + tail
    for (const piece of paragraph.pieces) {
      if (dialect === 'sheet') {
        // A run must keep a text: the others are emptied, not taken out.
        edits.push({
          start: piece.start,
          end: piece.end,
          text: piece === target ? `<t xml:space="preserve">${escapeXml(whole)}</t>` : '<t/>'
        })
        continue
      }
      if (dialect === 'word') {
        edits.push({ start: piece.start, end: piece.end, text: piece === target ? wordRunContent(whole) : '' })
        continue
      }
      // DrawingML: a text's whole run goes, or takes the translation; a break goes.
      const bounds = piece.kind === 'text' && piece.run ? piece.run : piece
      edits.push({
        start: bounds.start,
        end: bounds.end,
        text: piece === target && piece.run ? drawingRuns(whole, piece.run.head) : ''
      })
    }
  }
  edits.sort((a, b) => b.start - a.start)
  let out = xml
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  return out
}

/** Office's name for a language: `fr` is `fr-FR`. */
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

/** The proofing language set to `language`, where a Word part names one: Word then checks it as such. */
export function setProofingLanguage(xml: string, language: string): string {
  return xml.replace(/(<w:lang\b[^>]*?\sw:val=")([^"]*)(")/g, `$1${language}$3`)
}

/** The proofing language set to `language`, where a DrawingML part names one on its text. */
export function setDrawingLanguage(xml: string, language: string): string {
  return xml.replace(/(<a:(?:rPr|endParaRPr|defRPr)\b[^>]*?\slang=")([^"]*)(")/g, `$1${language}$3`)
}

/** A formula in a worksheet: a cell's, a validation's, a conditional format's — its text only, with no element inside. */
interface FormulaSpot {
  /** Where its text stands in the part's XML. */
  start: number
  end: number
  formula: string
  /** A validation list: its choices between quotes, separated by commas. */
  list: boolean
}

function formulaSpots(xml: string): FormulaSpot[] {
  const out: FormulaSpot[] = []
  for (const found of xml.matchAll(/<((?:[\w.-]+:)?(f|formula|formula1|formula2))(\s[^>]*)?>([^<]*)<\/\1>/g)) {
    const at = found.index ?? 0
    const start = at + found[0].length - found[4].length - found[1].length - 3
    const formula = decodeXml(found[4])
    // A validation's list — as itself, or as an extension writes it, a formula inside its « formula1 ».
    const inList = found[2] === 'formula1' || /<(?:[\w.-]+:)?formula1>\s*$/.test(xml.slice(Math.max(0, at - 40), at))
    out.push({ start, end: start + found[4].length, formula, list: inList && /^\s*"(?:[^"]|"")*"\s*$/.test(formula) })
  }
  return out
}

/** A text between quotes in a formula: where, its value, and the function it is given to. */
interface FormulaLiteral {
  start: number
  end: number
  value: string
  call: string
}

/** The texts between quotes in a formula — a sheet's name between apostrophes, a table's column between brackets, are not. */
export function literalsOf(formula: string): FormulaLiteral[] {
  const out: FormulaLiteral[] = []
  const calls: string[] = []
  let at = 0
  while (at < formula.length) {
    const char = formula[at]
    if (char === '"' || char === "'") {
      let end = at + 1
      while (end < formula.length) {
        if (formula[end] === char) {
          if (formula[end + 1] === char) end += 2
          else break
        } else end++
      }
      if (char === '"') {
        out.push({
          start: at,
          end: end + 1,
          value: formula.slice(at + 1, end).replace(/""/g, '"'),
          call: calls[calls.length - 1] ?? ''
        })
      }
      at = end + 1
      continue
    }
    if (char === '[') {
      let depth = 0
      let end = at
      for (; end < formula.length; end++) {
        if (formula[end] === '[') depth++
        else if (formula[end] === ']' && --depth === 0) break
      }
      at = end + 1
      continue
    }
    if (char === '(') {
      const name = /[A-Za-z_][\w.]*$/.exec(formula.slice(0, at))?.[0] ?? ''
      calls.push(name.slice(name.lastIndexOf('.') + 1).toUpperCase())
    } else if (char === ')') calls.pop()
    at++
  }
  return out
}

/**
 * The functions whose texts are not words: a number's format, a cell's address, a sheet's
 * name, a web address, a pattern. Translated, the formula would break.
 */
const CODE_CALLS = new Set([
  'TEXT',
  'INDIRECT',
  'ADDRESS',
  'CELL',
  'INFO',
  'HYPERLINK',
  'DATEVALUE',
  'TIMEVALUE',
  'VALUE',
  'NUMBERVALUE',
  'CONVERT',
  'DATEDIF',
  'GETPIVOTDATA',
  'CUBEMEMBER',
  'CUBEVALUE',
  'CUBESET',
  'CUBEMEMBERPROPERTY',
  'CUBERANKEDMEMBER',
  'CUBEKPIMEMBER',
  'CUBESETCOUNT',
  'RTD',
  'WEBSERVICE',
  'FILTERXML',
  'ENCODEURL',
  'IMAGE',
  'REGEXTEST',
  'REGEXEXTRACT',
  'REGEXREPLACE',
  'EVALUATE',
  'CALL'
])

/** A criterion's comparison — « <>Done », « *late* » —, apart from the words it compares with. */
function criterion(value: string): { lead: string; core: string; tail: string } {
  const lead = /^(?:<>|<=|>=|=|<|>)?[*?]*\s*/.exec(value)?.[0] ?? ''
  const rest = value.slice(lead.length)
  const tail = /\s*[*?]*$/.exec(rest)?.[0] ?? ''
  return { lead, core: rest.slice(0, rest.length - tail.length), tail }
}

/** Whether a formula's text is words a reader reads, not a code. */
function wordsOf(literal: FormulaLiteral): string | null {
  if (CODE_CALLS.has(literal.call)) return null
  const { core } = criterion(literal.value)
  if (!worthTranslating(core) || core.includes('!') || /^(?:[a-z][a-z0-9+.-]*:|#|www\.)|\\/i.test(core)) return null
  return core
}

/** A validation list's choices. */
function choicesOf(value: string): string[] {
  return value
    .split(',')
    .map((choice) => choice.trim())
    .filter(Boolean)
}

/**
 * The texts a workbook's formulas, validation lists and conditional formats name between
 * quotes: those cells' values are compared with, and must keep.
 */
export function formulaLiterals(xml: string): Set<string> {
  const out = new Set<string>()
  for (const spot of formulaSpots(xml)) {
    for (const literal of literalsOf(spot.formula)) {
      out.add(literal.value.trim())
      // A validation list: « "Yes,No,Maybe" », each choice a value of its own.
      if (spot.list) for (const choice of choicesOf(literal.value)) out.add(choice)
    }
  }
  for (const found of xml.matchAll(/<(?:[\w.-]+:)?cfRule\b[^>]*?\stext="([^"]*)"/g)) out.add(decodeXml(found[1]).trim())
  out.delete('')
  return out
}

/**
 * The words a worksheet's formulas, validation lists and conditional formats use, to be
 * translated with its cells: each choice of a list apart.
 */
export function formulaWords(xml: string): { words: Set<string>; choices: Set<string> } {
  const words = new Set<string>()
  const choices = new Set<string>()
  for (const spot of formulaSpots(xml)) {
    for (const literal of literalsOf(spot.formula)) {
      if (spot.list) {
        for (const choice of choicesOf(literal.value)) {
          if (!worthTranslating(choice)) continue
          words.add(choice)
          choices.add(choice)
        }
        continue
      }
      const core = wordsOf(literal)
      if (core) words.add(core)
    }
  }
  for (const found of xml.matchAll(/<(?:[\w.-]+:)?cfRule\b[^>]*?\stext="([^"]*)"/g)) {
    const text = decodeXml(found[1]).trim()
    if (worthTranslating(text)) words.add(text)
  }
  return { words, choices }
}

/**
 * A worksheet with its formulas' words translated as its cells are: the texts between
 * quotes, a validation list's choices, a conditional format's text, and what a formula
 * last gave when it was one of them — so the workbook shows it right before it reckons.
 */
export function rewriteFormulas(xml: string, translated: (text: string) => string | undefined): string {
  const edits: { start: number; end: number; text: string }[] = []
  const quoted = (value: string): string => `"${value.replace(/"/g, '""')}"`
  for (const spot of formulaSpots(xml)) {
    let formula = spot.formula
    for (const literal of literalsOf(spot.formula).reverse()) {
      let value: string | undefined
      if (spot.list) {
        const choices = literal.value.split(',').map((choice) => translated(choice.trim()) ?? choice)
        value = choices.join(',')
      } else {
        const core = wordsOf(literal)
        const translation = core ? translated(core) : undefined
        if (core && translation !== undefined) {
          const { lead, tail } = criterion(literal.value)
          value = lead + translation + tail
        }
      }
      if (value === undefined || value === literal.value) continue
      formula = formula.slice(0, literal.start) + quoted(value) + formula.slice(literal.end)
    }
    if (formula !== spot.formula) edits.push({ start: spot.start, end: spot.end, text: escapeXml(formula) })
  }
  for (const found of xml.matchAll(/(<(?:[\w.-]+:)?cfRule\b[^>]*?\stext=")([^"]*)"/g)) {
    const text = decodeXml(found[2]).trim()
    const translation = text ? translated(text) : undefined
    if (translation === undefined) continue
    const start = (found.index ?? 0) + found[1].length
    edits.push({ start, end: start + found[2].length, text: escapeXml(translation) })
  }
  // A formula's last result, kept as text in its cell.
  for (const found of xml.matchAll(/<c\b[^>]*\st="str"[^>]*>[\s\S]*?<\/c>/g)) {
    const value = /<v>([^<]*)<\/v>/.exec(found[0])
    if (!value) continue
    const text = decodeXml(value[1]).trim()
    const translation = text ? translated(text) : undefined
    if (translation === undefined) continue
    const start = (found.index ?? 0) + (value.index ?? 0) + 3
    edits.push({ start, end: start + value[1].length, text: escapeXml(translation) })
  }
  edits.sort((a, b) => b.start - a.start)
  let out = xml
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  return out
}

/** The workbook told to reckon its formulas again when it opens: their results follow the words translated. */
export function recalculateOnLoad(xml: string): string {
  if (/<calcPr\b[^>]*\sfullCalcOnLoad="(?:1|true)"/.test(xml)) return xml
  if (/<calcPr\b/.test(xml)) {
    return xml.replace(/<calcPr\b([^>]*?)(\s*\/?)>/, (_whole, attributes: string, end: string) => {
      const rest = attributes.replace(/\sfullCalcOnLoad="[^"]*"/, '')
      return `<calcPr${rest} fullCalcOnLoad="1"${end}>`
    })
  }
  // Where it stands: after the sheets, the external references and the names.
  let after = -1
  for (const found of xml.matchAll(
    /<\/sheets>|<\/functionGroups>|<functionGroups\b[^>]*\/>|<\/externalReferences>|<\/definedNames>|<definedNames\s*\/>/g
  )) {
    after = Math.max(after, (found.index ?? 0) + found[0].length)
  }
  if (after < 0) return xml
  return `${xml.slice(0, after)}<calcPr fullCalcOnLoad="1"/>${xml.slice(after)}`
}

/** A table's column names: its header cells must keep them, or Excel repairs the workbook. */
export function tableColumns(xml: string): string[] {
  return [...xml.matchAll(/<(?:[\w.-]+:)?tableColumn\b[^>]*?\sname="([^"]*)"/g)].map((found) =>
    decodeXml(found[1]).trim()
  )
}

export interface DocxTranslation {
  /** The texts to translate, each once, in the order they come. */
  texts: string[]
  /** A workbook's cell texts its formulas compare with, left as they are. */
  kept: string[]
  /** The document rebuilt, each text replaced by what `translated` gives for it. */
  build: (translated: (text: string) => string | undefined) => Uint8Array
}

export interface TranslationOptions {
  /**
   * A workbook's texts its formulas, validation lists and conditional formats use,
   * translated too, and the same in them; otherwise left as they are.
   */
  formulaTexts?: boolean
}

/**
 * An Office document opened for translation — a Word document, a PowerPoint deck or an
 * Excel workbook —:
 * what it says, and how to write it back translated.
 */
export async function openDocxForTranslation(
  bytes: Uint8Array,
  language: string,
  options: TranslationOptions = {}
): Promise<DocxTranslation> {
  const entries = await unzip(bytes)
  const has = (name: string): boolean => entries.some((entry) => entry.name === name)
  const kind = has('word/document.xml')
    ? 'word'
    : has('ppt/presentation.xml')
      ? 'deck'
      : has('xl/workbook.xml')
        ? 'book'
        : null
  if (!kind) throw new Error('not a Word document, a PowerPoint deck nor an Excel workbook')
  const dialectOf = (name: string): Dialect | null => {
    if (kind === 'word') return isTextPart(name) ? 'word' : null
    if (kind === 'deck') return isSlidePart(name) ? 'drawing' : null
    return workbookPart(name)
  }
  const decoder = new TextDecoder()
  const parts = entries.flatMap((entry) => {
    const dialect = dialectOf(entry.name)
    if (!dialect) return []
    const xml = decoder.decode(entry.data)
    return [{ name: entry.name, xml, dialect, paragraphs: scanParagraphs(xml, dialect) }]
  })
  const isSheet = (name: string): boolean => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  const withFormulas = kind === 'book' && !!options.formulaTexts
  // A workbook's texts its formulas compare with stay as they are — unless they are
  // translated in the formulas too —, and a table's column names always.
  const kept = new Set<string>()
  const formulaTexts = new Set<string>()
  const choices = new Set<string>()
  if (kind === 'book') {
    for (const entry of entries) {
      if (isSheet(entry.name)) {
        const xml = decoder.decode(entry.data)
        if (withFormulas) {
          const found = formulaWords(xml)
          for (const word of found.words) formulaTexts.add(word)
          for (const choice of found.choices) choices.add(choice)
        } else for (const literal of formulaLiterals(xml)) kept.add(literal)
      }
      if (/^xl\/tables\/table\d+\.xml$/.test(entry.name)) {
        for (const column of tableColumns(decoder.decode(entry.data))) kept.add(column)
      }
    }
  }
  const texts: string[] = []
  const held: string[] = []
  const seen = new Set<string>()
  const add = (text: string): void => {
    if (!text || !worthTranslating(text) || seen.has(text)) return
    seen.add(text)
    if (kept.has(text)) held.push(text)
    else texts.push(text)
  }
  for (const part of parts) for (const paragraph of part.paragraphs) add(paragraphText(paragraph).trim())
  // The formulas' own words — a result they give, a text they look for — after the cells'.
  for (const word of formulaTexts) add(word)
  const tag = wordLanguage(language)
  return {
    texts,
    kept: held,
    build: (translated) => {
      const keep = (text: string): string | undefined => {
        if (kept.has(text)) return undefined
        const translation = translated(text)
        // A list's choice, in its cells as in the list: with no comma, which would split it.
        return translation !== undefined && choices.has(text)
          ? translation.replace(/\s*,\s*/g, ' ').trim() || undefined
          : translation
      }
      const rewritten = new Map(
        parts.map((part) => {
          let xml = rewriteParagraphs(part.xml, part.paragraphs, keep, part.dialect)
          if (withFormulas && isSheet(part.name)) xml = rewriteFormulas(xml, keep)
          const language =
            part.dialect === 'word'
              ? setProofingLanguage(xml, tag)
              : part.dialect === 'drawing'
                ? setDrawingLanguage(xml, tag)
                : xml
          return [part.name, language]
        })
      )
      const out: ZipEntry[] = entries.map((entry) => {
        const xml = rewritten.get(entry.name)
        if (xml !== undefined) return { name: entry.name, data: utf8(xml) }
        if (kind === 'word' && entry.name === 'word/styles.xml') {
          return { name: entry.name, data: utf8(setProofingLanguage(decoder.decode(entry.data), tag)) }
        }
        if (withFormulas && entry.name === 'xl/workbook.xml') {
          return { name: entry.name, data: utf8(recalculateOnLoad(decoder.decode(entry.data))) }
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
