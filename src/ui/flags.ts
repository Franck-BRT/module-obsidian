/**
 * Flags for the languages a document can be in, drawn — not the flag emojis, which Windows
 * shows as two letters. Simplified, at the size of a letter: the colours and the shapes
 * that tell them apart, not the coats of arms.
 */

type Shape =
  | { rect: [number, number, number, number]; fill: string }
  | { line: [number, number, number, number]; stroke: string; width: number }
  | { circle: [number, number, number]; fill: string }

const UK: Shape[] = [
  { rect: [0, 0, 30, 20], fill: '#012169' },
  { line: [0, 0, 30, 20], stroke: '#FFFFFF', width: 4 },
  { line: [30, 0, 0, 20], stroke: '#FFFFFF', width: 4 },
  { line: [0, 0, 30, 20], stroke: '#C8102E', width: 1.5 },
  { line: [30, 0, 0, 20], stroke: '#C8102E', width: 1.5 },
  { rect: [12.5, 0, 5, 20], fill: '#FFFFFF' },
  { rect: [0, 7.5, 30, 5], fill: '#FFFFFF' },
  { rect: [13.5, 0, 3, 20], fill: '#C8102E' },
  { rect: [0, 8.5, 30, 3], fill: '#C8102E' }
]

const vertical = (a: string, b: string, c: string): Shape[] => [
  { rect: [0, 0, 10, 20], fill: a },
  { rect: [10, 0, 10, 20], fill: b },
  { rect: [20, 0, 10, 20], fill: c }
]

const horizontal = (a: string, b: string, c: string): Shape[] => [
  { rect: [0, 0, 30, 6.67], fill: a },
  { rect: [0, 6.67, 30, 6.66], fill: b },
  { rect: [0, 13.33, 30, 6.67], fill: c }
]

const FLAGS: Record<string, Shape[]> = {
  fr: vertical('#0055A4', '#FFFFFF', '#EF4135'),
  en: UK,
  de: horizontal('#000000', '#DD0000', '#FFCE00'),
  es: [
    { rect: [0, 0, 30, 20], fill: '#AA151B' },
    { rect: [0, 5, 30, 10], fill: '#F1BF00' }
  ],
  it: vertical('#009246', '#FFFFFF', '#CE2B37'),
  pt: [
    { rect: [0, 0, 12, 20], fill: '#006600' },
    { rect: [12, 0, 18, 20], fill: '#FF0000' },
    { circle: [12, 10, 3.5], fill: '#FFCC00' }
  ],
  nl: horizontal('#AE1C28', '#FFFFFF', '#21468B'),
  pl: [
    { rect: [0, 0, 30, 10], fill: '#FFFFFF' },
    { rect: [0, 10, 30, 10], fill: '#DC143C' }
  ],
  ru: horizontal('#FFFFFF', '#0039A6', '#D52B1E'),
  sv: [
    { rect: [0, 0, 30, 20], fill: '#006AA7' },
    { rect: [9, 0, 4, 20], fill: '#FECC00' },
    { rect: [0, 8, 30, 4], fill: '#FECC00' }
  ],
  ja: [
    { rect: [0, 0, 30, 20], fill: '#FFFFFF' },
    { circle: [15, 10, 6], fill: '#BC002D' }
  ],
  zh: [
    { rect: [0, 0, 30, 20], fill: '#DE2910' },
    { circle: [6, 6, 3], fill: '#FFDE00' }
  ]
}

/** A language's code reduced to what has a flag: `fr-CA` is French, `EN` is English. */
export function flagCode(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0]
}

export function hasFlag(code: string): boolean {
  return flagCode(code) in FLAGS
}

const SVG = 'http://www.w3.org/2000/svg'

/** The flag drawn in an element, or the language's letters where it has none. */
export function renderFlag(parent: HTMLElement, code: string): HTMLElement {
  const shapes = FLAGS[flagCode(code)]
  const holder = parent.createSpan({ cls: 'pm-flag' })
  if (!shapes) {
    holder.addClass('is-letters')
    holder.setText(flagCode(code).toUpperCase())
    return holder
  }
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 30 20')
  svg.setAttribute('width', '18')
  svg.setAttribute('height', '12')
  svg.setAttribute('aria-hidden', 'true')
  for (const shape of shapes) {
    let el: SVGElement
    if ('rect' in shape) {
      el = document.createElementNS(SVG, 'rect')
      const [x, y, w, h] = shape.rect
      el.setAttribute('x', String(x))
      el.setAttribute('y', String(y))
      el.setAttribute('width', String(w))
      el.setAttribute('height', String(h))
      el.setAttribute('fill', shape.fill)
    } else if ('line' in shape) {
      el = document.createElementNS(SVG, 'line')
      const [x1, y1, x2, y2] = shape.line
      el.setAttribute('x1', String(x1))
      el.setAttribute('y1', String(y1))
      el.setAttribute('x2', String(x2))
      el.setAttribute('y2', String(y2))
      el.setAttribute('stroke', shape.stroke)
      el.setAttribute('stroke-width', String(shape.width))
    } else {
      el = document.createElementNS(SVG, 'circle')
      const [cx, cy, r] = shape.circle
      el.setAttribute('cx', String(cx))
      el.setAttribute('cy', String(cy))
      el.setAttribute('r', String(r))
      el.setAttribute('fill', shape.fill)
    }
    svg.appendChild(el)
  }
  holder.appendChild(svg)
  return holder
}
