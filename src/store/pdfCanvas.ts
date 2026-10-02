import { fontName, PAGE, pdfString, round, writePdf } from './pdf'
import { textWidth, wrapText } from './pdfFont'

/**
 * A page to draw on, for a PDF that is more than running text: a report with its tiles,
 * its bars and its curve. Coordinates are from the top-left corner, in points, the way
 * a layout thinks; they are turned over to PDF's bottom-left only when written.
 *
 * Drawn in the fonts every reader has — Helvetica, upright and bold —, so nothing is
 * embedded: the same file opens the same everywhere.
 */

export type Rgb = [number, number, number]

/** A colour from `#rgb` or `#rrggbb`; grey when it is anything else — a theme's variable, a name. */
export function rgb(hex: string, fallback: Rgb = [0.55, 0.55, 0.58]): Rgb {
  const clean = hex.trim().replace(/^#/, '')
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean
  if (!/^[0-9a-f]{6}$/i.test(full)) return fallback
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255) as Rgb
}

/** A colour washed towards white: 0 keeps it, 1 is white. */
export function tint(color: Rgb, amount: number): Rgb {
  return color.map((value) => value + (1 - value) * amount) as Rgb
}

export const BLACK: Rgb = [0.1, 0.1, 0.12]
export const GREY: Rgb = [0.42, 0.43, 0.47]
export const LIGHT: Rgb = [0.88, 0.89, 0.91]
export const WHITE: Rgb = [1, 1, 1]

export interface TextStyle {
  size?: number
  bold?: boolean
  italic?: boolean
  color?: Rgb
  align?: 'left' | 'center' | 'right'
}

const color = (value: Rgb): string => value.map((one) => round(one)).join(' ')

/** The width a text takes; bold is a little wider than the upright metrics say. */
export function measure(text: string, size: number, bold = false): number {
  return textWidth(text, size) * (bold ? 1.06 : 1)
}

/** A text cut to a width, with an ellipsis when it had to be. */
export function fit(text: string, size: number, width: number, bold = false): string {
  if (measure(text, size, bold) <= width) return text
  let out = text
  while (out.length > 1 && measure(`${out}…`, size, bold) > width) out = out.slice(0, -1)
  return `${out.trimEnd()}…`
}

export class PdfCanvas {
  readonly width = PAGE.width
  readonly height = PAGE.height
  readonly margin: number
  /** Where the next block goes, from the top of the page. */
  y: number
  private pages: string[][] = [[]]
  /** Drawn at the top of every page after the first, and at the foot of each. */
  constructor(
    margin = 40,
    private chrome: { header?: (canvas: PdfCanvas) => void; footer?: (page: number, pages: number) => string } = {}
  ) {
    this.margin = margin
    this.y = margin
  }

  get contentWidth(): number {
    return this.width - 2 * this.margin
  }

  get pageCount(): number {
    return this.pages.length
  }

  private get ops(): string[] {
    return this.pages[this.pages.length - 1]
  }

  /** The room left on the page, above the footer. */
  room(): number {
    return this.height - this.margin - 18 - this.y
  }

  /** A new page, its header drawn. */
  newPage(): void {
    this.pages.push([])
    this.y = this.margin
    this.chrome.header?.(this)
  }

  /** Room for `height` points, or a new page. */
  need(height: number): void {
    if (this.room() < height) this.newPage()
  }

  private flip(y: number): number {
    return this.height - y
  }

  rect(x: number, y: number, width: number, height: number, style: { fill?: Rgb; stroke?: Rgb; line?: number }): void {
    const box = `${round(x)} ${round(this.flip(y + height))} ${round(width)} ${round(height)} re`
    const parts = [`${round(style.line ?? 0.6)} w`]
    if (style.fill) parts.push(`${color(style.fill)} rg`)
    if (style.stroke) parts.push(`${color(style.stroke)} RG`)
    parts.push(`${box} ${style.fill && style.stroke ? 'B' : style.fill ? 'f' : 'S'}`)
    this.ops.push(parts.join(' '))
  }

  /** A shape by its corners, closed, filled and or stroked. */
  polygon(points: [number, number][], style: { fill?: Rgb; stroke?: Rgb; line?: number }): void {
    if (points.length < 3) return
    const path = points
      .map(([x, y], at) => `${round(x)} ${round(this.flip(y))} ${at ? 'l' : 'm'}`)
      .concat('h')
      .join(' ')
    const parts = [`${round(style.line ?? 0.6)} w`]
    if (style.fill) parts.push(`${color(style.fill)} rg`)
    if (style.stroke) parts.push(`${color(style.stroke)} RG`)
    parts.push(`${path} ${style.fill && style.stroke ? 'B' : style.fill ? 'f' : 'S'}`)
    this.ops.push(parts.join(' '))
  }

  /** A line through points, dashed when asked. */
  line(points: [number, number][], style: { stroke: Rgb; line?: number; dash?: number[] }): void {
    if (points.length < 2) return
    const path = points.map(([x, y], at) => `${round(x)} ${round(this.flip(y))} ${at ? 'l' : 'm'}`).join(' ')
    const dash = style.dash?.length ? `[${style.dash.map(round).join(' ')}] 0 d` : '[] 0 d'
    this.ops.push(`${round(style.line ?? 0.8)} w ${dash} 1 J 1 j ${color(style.stroke)} RG ${path} S [] 0 d`)
  }

  /** One line of text; `y` is the top of the line. Its width comes back. */
  text(x: number, y: number, text: string, style: TextStyle = {}): number {
    const size = style.size ?? 9.5
    const width = measure(text, size, style.bold)
    const left = style.align === 'center' ? x - width / 2 : style.align === 'right' ? x - width : x
    const baseline = this.flip(y + size * 0.8)
    this.ops.push(
      `${color(style.color ?? BLACK)} rg BT ${fontName(!!style.bold, !!style.italic)} ${round(size)} Tf ${round(left)} ${round(baseline)} Td ${pdfString(text)} Tj ET`
    )
    return width
  }

  /** A text wrapped to a width, line after line from `y`; the height it took comes back. */
  paragraph(x: number, y: number, width: number, text: string, style: TextStyle = {}, maxLines = Infinity): number {
    const size = style.size ?? 9.5
    const leading = size * 1.3
    let lines = wrapText(text, size * (style.bold ? 1.06 : 1), width)
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines)
      lines[maxLines - 1] = fit(`${lines[maxLines - 1]}…`, size, width, style.bold)
    }
    lines.forEach((one, at) => this.text(x, y + at * leading, one, style))
    return lines.length * leading
  }

  /** The text's height once wrapped, without drawing it. */
  paragraphHeight(width: number, text: string, size = 9.5, bold = false, maxLines = Infinity): number {
    return Math.min(maxLines, wrapText(text, size * (bold ? 1.06 : 1), width).length) * size * 1.3
  }

  /** The file: every page with its footer. */
  build(title: string, at = new Date()): Uint8Array {
    const total = this.pages.length
    const streams = this.pages.map((ops, index) => {
      const footer = this.chrome.footer?.(index + 1, total)
      if (!footer) return ops.join('\n')
      const y = this.height - this.margin + 4
      const line = `0.5 w ${color(LIGHT)} RG ${round(this.margin)} ${round(this.flip(y))} m ${round(this.width - this.margin)} ${round(this.flip(y))} l S`
      const size = 7.5
      const text = `${color(GREY)} rg BT /F1 ${size} Tf ${round(this.margin)} ${round(this.flip(y + 6 + size))} Td ${pdfString(footer)} Tj ET`
      const page = `${index + 1} / ${total}`
      const right = `${color(GREY)} rg BT /F1 ${size} Tf ${round(this.width - this.margin - measure(page, size))} ${round(this.flip(y + 6 + size))} Td ${pdfString(page)} Tj ET`
      return [...ops, line, text, right].join('\n')
    })
    return writePdf(streams, title, at)
  }
}
