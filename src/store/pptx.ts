import { wrapText } from './pdfFont'
import { escapeXml } from './xml'
import { utf8, zip, type ZipEntry } from './zip'

/**
 * A slide deck, written by hand.
 *
 * The fourth format that is a ZIP of XML, and the fourth without a dependency. A
 * requirements review is walked through one requirement at a time, in a room, with the
 * words on the wall — which is a deck, and which nobody should have to build by pasting
 * four hundred rows into slides.
 *
 * Every shape carries its own position and its own font size. Nothing is inherited from a
 * placeholder: a layout this file does not control is a layout that can put the text
 * somewhere else, and a deck that reads correctly in one program and not in another is
 * worse than a plain one that reads the same everywhere.
 */

/** English Metric Units: what PresentationML measures in. 12 700 to the point. */
const EMU = 12700
const pt = (value: number): number => Math.round(value * EMU)

/** 16:9, in points. The shape of every screen a review is shown on. */
export const SLIDE = { width: 960, height: 540 }
const FRAME = { left: 60, right: 60, top: 48 }
const BODY = { top: 150, height: 300 }

export interface PptxLine {
  text: string
  bullet?: boolean
  /** Said quieter: a rationale under a requirement, a source under a title. */
  quiet?: boolean
}

export interface PptxSlide {
  title: string
  /** A word or two above the title: the category, the section, what this is one of. */
  eyebrow?: string
  body: PptxLine[]
  /** One line along the bottom, for what a reviewer needs at a glance. */
  footer?: string
}

export interface PptxDeck {
  title: string
  slides: PptxSlide[]
}

const TITLE_SIZE = 26
const BODY_SIZE = 18
const SMALLEST = 11

/**
 * The body's font size, chosen here rather than left to the program.
 *
 * PowerPoint can shrink overflowing text on its own, but only once somebody has opened
 * the box and edited it: a deck shown straight from the file would have the end of a
 * requirement hanging off the bottom of the slide. So the size is worked out with the
 * same measurements the PDF export uses, and written into the file.
 */
export function bodySize(lines: PptxLine[]): number {
  const width = SLIDE.width - FRAME.left - FRAME.right
  for (let size = BODY_SIZE; size > SMALLEST; size -= 1) {
    let used = 0
    for (const line of lines) {
      const at = line.quiet ? size - 3 : size
      used += wrapText(line.text, at, width - (line.bullet ? 18 : 0)).length * at * 1.35 + at * 0.4
    }
    if (used <= BODY.height) return size
  }
  return SMALLEST
}

/** How many lines a title takes at the size it is drawn, so the body can start below it. */
function titleLines(title: string): number {
  return wrapText(title, TITLE_SIZE, SLIDE.width - FRAME.left - FRAME.right).length
}

function runXml(text: string, size: number, bold: boolean, grey: boolean): string {
  return (
    `<a:r><a:rPr lang="fr-FR" sz="${Math.round(size * 100)}"${bold ? ' b="1"' : ''} dirty="0">` +
    `<a:solidFill><a:srgbClr val="${grey ? '6E6E6E' : '1A1A1A'}"/></a:solidFill></a:rPr>` +
    `<a:t>${escapeXml(text)}</a:t></a:r>`
  )
}

function paraXml(line: PptxLine, size: number): string {
  const at = line.quiet ? size - 3 : size
  const marker = line.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buNone/>'
  const indent = line.bullet ? ' marL="228600" indent="-228600"' : ' marL="0" indent="0"'
  return (
    `<a:p><a:pPr${indent} algn="l">${marker}<a:lnSpc><a:spcPct val="135000"/></a:lnSpc>` +
    `<a:spcBef><a:spcPct val="40000"/></a:spcBef></a:pPr>` +
    `${runXml(line.text, at, false, line.quiet === true)}</a:p>`
  )
}

function shapeXml(id: number, name: string, box: { x: number; y: number; w: number; h: number }, body: string): string {
  return [
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${pt(box.x)}" y="${pt(box.y)}"/>`,
    `<a:ext cx="${pt(box.w)}" cy="${pt(box.h)}"/></a:xfrm>`,
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>',
    '<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr>',
    '<a:lstStyle/>',
    body,
    '</p:txBody></p:sp>'
  ].join('')
}

function slideXml(slide: PptxSlide): string {
  const width = SLIDE.width - FRAME.left - FRAME.right
  const shapes: string[] = []
  let id = 2
  let y = FRAME.top

  if (slide.eyebrow) {
    shapes.push(
      shapeXml(
        id++,
        'Eyebrow',
        { x: FRAME.left, y, w: width, h: 20 },
        `<a:p><a:pPr><a:buNone/></a:pPr>${runXml(slide.eyebrow, 13, true, true)}</a:p>`
      )
    )
    y += 26
  }
  const lines = titleLines(slide.title)
  shapes.push(
    shapeXml(
      id++,
      'Title',
      { x: FRAME.left, y, w: width, h: lines * TITLE_SIZE * 1.25 },
      `<a:p><a:pPr><a:buNone/><a:lnSpc><a:spcPct val="120000"/></a:lnSpc></a:pPr>${runXml(slide.title, TITLE_SIZE, true, false)}</a:p>`
    )
  )

  if (slide.body.length) {
    const size = bodySize(slide.body)
    shapes.push(
      shapeXml(
        id++,
        'Body',
        { x: FRAME.left, y: Math.max(BODY.top, y + lines * TITLE_SIZE * 1.25 + 14), w: width, h: BODY.height },
        slide.body.map((line) => paraXml(line, size)).join('')
      )
    )
  }
  if (slide.footer) {
    shapes.push(
      shapeXml(
        id++,
        'Footer',
        { x: FRAME.left, y: SLIDE.height - 56, w: width, h: 24 },
        `<a:p><a:pPr><a:buNone/></a:pPr>${runXml(slide.footer, 12, false, true)}</a:p>`
      )
    )
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>',
    '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>',
    shapes.join(''),
    // The master's own mapping, which is what every file written by PowerPoint says. An
    // override here would be twelve attributes to get right for no gain.
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
  ].join('')
}

/* ---- The package -------------------------------------------------------------- */

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * The theme, which is not optional.
 *
 * A master without one is a file PowerPoint offers to repair. It is the smallest theme
 * that is still a valid one: two colour schemes, a font scheme, and the three format
 * lists the schema insists on having three of each.
 */
function themeXml(): string {
  const scheme = [
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>',
    '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>',
    '<a:dk2><a:srgbClr val="1A1A1A"/></a:dk2>',
    '<a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>',
    ...['6E62CD', '367794', '06915F', 'B16A08', 'F83E54', '8B8C92'].map(
      (color, at) => `<a:accent${at + 1}><a:srgbClr val="${color}"/></a:accent${at + 1}>`
    ),
    '<a:hlink><a:srgbClr val="367794"/></a:hlink>',
    '<a:folHlink><a:srgbClr val="6E62CD"/></a:folHlink>'
  ].join('')
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  const line =
    '<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
    '<a:prstDash val="solid"/></a:ln>'
  const font = (tag: string): string =>
    `<a:${tag}><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`
  return [
    HEAD,
    `<a:theme xmlns:a="${A}" name="Black Projects">`,
    `<a:themeElements><a:clrScheme name="Black Projects">${scheme}</a:clrScheme>`,
    `<a:fontScheme name="Black Projects">${font('majorFont')}${font('minorFont')}</a:fontScheme>`,
    '<a:fmtScheme name="Black Projects">',
    `<a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst>`,
    `<a:lnStyleLst>${line}${line}${line}</a:lnStyleLst>`,
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>',
    '<a:effectStyle><a:effectLst/></a:effectStyle>',
    '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>',
    `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst>`,
    '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
  ].join('')
}

const EMPTY_TREE =
  '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
  '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>'

const CLR_MAP =
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3"' +
  ' accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'

function masterXml(): string {
  return [
    HEAD,
    `<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">`,
    EMPTY_TREE,
    CLR_MAP,
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>',
    '</p:sldMaster>'
  ].join('')
}

function layoutXml(): string {
  return [
    HEAD,
    `<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="blank" preserve="1">`,
    EMPTY_TREE,
    '</p:sldLayout>'
  ].join('')
}

function presentationXml(count: number): string {
  const slides = Array.from({ length: count }, (_, at) => `<p:sldId id="${256 + at}" r:id="rId${at + 2}"/>`).join('')
  return [
    HEAD,
    `<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">`,
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>',
    `<p:sldIdLst>${slides}</p:sldIdLst>`,
    `<p:sldSz cx="${pt(SLIDE.width)}" cy="${pt(SLIDE.height)}"/>`,
    `<p:notesSz cx="${pt(SLIDE.height)}" cy="${pt(SLIDE.width)}"/>`,
    '</p:presentation>'
  ].join('')
}

function rels(entries: { id: string; type: string; target: string }[]): string {
  return [
    HEAD,
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
    entries
      .map((entry) => `<Relationship Id="${entry.id}" Type="${R}/${entry.type}" Target="${entry.target}"/>`)
      .join(''),
    '</Relationships>'
  ].join('')
}

function contentTypes(count: number): string {
  const kind = (part: string, type: string): string =>
    `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`
  return [
    HEAD,
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    kind('/ppt/presentation.xml', 'presentationml.presentation.main'),
    kind('/ppt/slideMasters/slideMaster1.xml', 'presentationml.slideMaster'),
    kind('/ppt/slideLayouts/slideLayout1.xml', 'presentationml.slideLayout'),
    kind('/ppt/theme/theme1.xml', 'theme'),
    Array.from({ length: count }, (_, at) => kind(`/ppt/slides/slide${at + 1}.xml`, 'presentationml.slide')).join(''),
    '</Types>'
  ].join('')
}

export function pptxParts(deck: PptxDeck): ZipEntry[] {
  const slides = deck.slides.length
  return [
    { name: '[Content_Types].xml', data: utf8(contentTypes(slides)) },
    {
      name: '_rels/.rels',
      data: utf8(rels([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }]))
    },
    { name: 'ppt/presentation.xml', data: utf8(presentationXml(slides)) },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: utf8(
        rels([
          { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
          ...deck.slides.map((_, at) => ({
            id: `rId${at + 2}`,
            type: 'slide',
            target: `slides/slide${at + 1}.xml`
          }))
        ])
      )
    },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: utf8(masterXml()) },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: utf8(
        rels([
          { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
          { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' }
        ])
      )
    },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: utf8(layoutXml()) },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: utf8(rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]))
    },
    { name: 'ppt/theme/theme1.xml', data: utf8(themeXml()) },
    ...deck.slides.flatMap((slide, at) => [
      { name: `ppt/slides/slide${at + 1}.xml`, data: utf8(slideXml(slide)) },
      {
        name: `ppt/slides/_rels/slide${at + 1}.xml.rels`,
        data: utf8(rels([{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }]))
      }
    ])
  ]
}

export function buildPptx(deck: PptxDeck, at = new Date()): Uint8Array {
  return zip(pptxParts(deck), at)
}
