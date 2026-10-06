/**
 * The text of an RTF document — what WordPad writes, what many tools still export, and
 * what not a few `.doc` files really are.
 *
 * RTF is text: groups in braces, control words after a backslash. The text is what is
 * left once the groups that are not text — the font and colour tables, the styles, the
 * pictures, the document's properties, the codes of its fields — are passed over and the
 * control words that stand for characters — a paragraph's end, a tab, a cell's, an accent
 * written as its byte or its Unicode number — are made the characters they stand for.
 */

/** Groups that hold no text of the document's. */
const SKIPPED = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'objdata',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'xmlnstbl',
  'mmathPr',
  'fldinst',
  'filetbl',
  'revtbl',
  'pgdsctbl',
  'shppict',
  'nonshppict',
  'bkmkstart',
  'bkmkend'
])

const CHARACTERS: Record<string, string> = {
  tab: '\t',
  emdash: '—',
  endash: '–',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' '
}

const LINE_ENDS = new Set(['par', 'line', 'sect', 'page', 'column'])

function decoderFor(page: number): TextDecoder {
  try {
    return new TextDecoder(page === 65001 ? 'utf-8' : `windows-${page}`)
  } catch {
    return new TextDecoder('windows-1252')
  }
}

export function isRtf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '{\\rtf'
}

export function readRtf(bytes: Uint8Array): string {
  // One character a byte: what is not plain ASCII comes as \'hh or \uN.
  let src = ''
  for (let at = 0; at < bytes.length; at += 0x8000) src += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  let decoder = decoderFor(1252)
  const stack: { skip: boolean; uc: number }[] = []
  let state = { skip: false, uc: 1 }
  const lines: string[] = []
  let line = ''
  let cells: string[] = []
  let pending: number[] = []
  // Characters still to pass over after a \u, its stand-in for readers without Unicode.
  let fallback = 0
  const flush = (): void => {
    if (pending.length) {
      if (!state.skip) line += decoder.decode(Uint8Array.from(pending))
      pending = []
    }
  }
  const put = (text: string): void => {
    flush()
    if (!state.skip) line += text
  }
  for (let at = 0; at < src.length; at++) {
    const char = src[at]
    if (char === '{') {
      flush()
      stack.push(state)
      state = { ...state }
      fallback = 0
    } else if (char === '}') {
      flush()
      state = stack.pop() ?? { skip: false, uc: 1 }
      fallback = 0
    } else if (char === '\\') {
      const next = src[at + 1]
      if (next === undefined) break
      if (/[a-zA-Z]/.test(next)) {
        let end = at + 1
        while (end < src.length && /[a-zA-Z]/.test(src[end])) end++
        const word = src.slice(at + 1, end)
        let digits = ''
        if (src[end] === '-' || /\d/.test(src[end] ?? '')) {
          let stop = end + (src[end] === '-' ? 1 : 0)
          while (stop < src.length && /\d/.test(src[stop])) stop++
          digits = src.slice(end, stop)
          end = stop
        }
        if (src[end] === ' ') end++
        at = end - 1
        const param = digits ? Number(digits) : null
        if (word === 'u' && param !== null) {
          put(String.fromCharCode(param < 0 ? param + 65536 : param))
          fallback = state.uc
          continue
        }
        if (word === 'bin' && param) {
          at += param
          continue
        }
        if (word !== "'") flush()
        if (SKIPPED.has(word)) state.skip = true
        else if (word === 'uc' && param !== null) state.uc = param
        else if (word === 'ansicpg' && param) decoder = decoderFor(param)
        else if (LINE_ENDS.has(word)) {
          if (!state.skip) {
            lines.push(line)
            line = ''
          }
        } else if (word === 'cell' || word === 'nestcell') {
          if (!state.skip) {
            cells.push(line.trim())
            line = ''
          }
        } else if (word === 'row' || word === 'nestrow') {
          if (!state.skip && cells.length) {
            lines.push(`| ${cells.map((cell) => cell.replace(/\|/g, '/')).join(' | ')} |`)
            cells = []
            line = ''
          }
        } else if (CHARACTERS[word]) put(CHARACTERS[word])
        continue
      }
      at++
      if (next === "'") {
        const hex = src.slice(at + 1, at + 3)
        at += 2
        if (fallback > 0) {
          fallback--
          continue
        }
        if (/^[0-9a-fA-F]{2}$/.test(hex)) pending.push(Number.parseInt(hex, 16))
      } else if (next === '*') {
        flush()
        state.skip = true
      } else if (next === '~') put(' ')
      else if (next === '_') put('-')
      else if (next === '\n' || next === '\r') {
        flush()
        if (!state.skip) {
          lines.push(line)
          line = ''
        }
      } else if (next !== '-') put(next)
    } else if (char === '\r' || char === '\n') {
      // Line breaks in the source are not the document's.
    } else if (fallback > 0) fallback--
    else put(char)
  }
  flush()
  if (cells.length) lines.push(`| ${cells.join(' | ')} |`)
  lines.push(line)
  return lines
    .map((one) => one.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
