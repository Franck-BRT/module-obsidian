import { MarkdownRenderChild, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { Requirement } from '../../store/requirements/Requirement'
import {
  isEmptySpec,
  parseReqBlock,
  quotedWording,
  REQ_BLOCK_LANGUAGE,
  resolveBlockFields,
  selectRequirements,
  type ReqBlockField,
  type ReqBlockSpec
} from '../../store/requirements/reqBlock'
import { Chip } from '../../ui/primitives/Chip'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'
import { openRequirementModal } from './RequirementModal'
import { renderStars } from './reqStars'
import { reqHeadLines, type ReqHeadPart } from './reqBlockHead'

/**
 * Requirements quoted inside a document.
 *
 * A specification that pastes its requirements is right on the day it is written and
 * wrong from the next revision onward, with nothing on the page to say which. A block
 * that cites the library is never out of date — and, more to the point, can say out loud
 * that the wording it is showing has fallen behind the source it was translated from,
 * which a pasted paragraph can never do.
 */
export function registerReqBlock(plugin: PMPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor(REQ_BLOCK_LANGUAGE, (source, el, ctx) => {
    ctx.addChild(new ReqBlockChild(plugin, source, el))
  })
}

/**
 * The block, kept current.
 *
 * "A citation is never out of date" is only true if the citation is redrawn when the
 * library moves; a block rendered once and left alone is a paste with extra steps. The
 * render child is what gives it a lifetime — Obsidian unloads it with the note, so the
 * subscription goes with it instead of piling up one per document ever opened.
 */
class ReqBlockChild extends MarkdownRenderChild {
  private timer: number | null = null

  constructor(
    private plugin: PMPlugin,
    private source: string,
    container: HTMLElement
  ) {
    super(container)
  }

  onload(): void {
    this.draw()
    // Coalesced: one edit anywhere in the vault can report several changes, and a
    // document holding twenty blocks would redraw all of them for each.
    this.register(
      this.plugin.index.onChange(() => {
        if (this.timer !== null) window.clearTimeout(this.timer)
        this.timer = window.setTimeout(() => {
          this.timer = null
          this.draw()
        }, 250)
      })
    )
  }

  onunload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }

  private draw(): void {
    this.containerEl.empty()
    renderReqBlock(this.plugin, this.source, this.containerEl)
  }
}

function renderReqBlock(plugin: PMPlugin, source: string, el: HTMLElement): void {
  const spec = parseReqBlock(source)
  const root = el.createDiv('pm-reqblock')

  // Said before anything is drawn: a key nobody recognised means the block is showing
  // something other than what its author asked for.
  if (spec.unknown.length) {
    notice(root, 'triangle-alert', t('req.block.unknownKeys', { list: spec.unknown.join(', ') }), 'warn')
  }
  if (isEmptySpec(spec)) {
    notice(root, 'help-circle', t('req.block.empty'), 'hint')
    return
  }

  const { rows, missing } = selectRequirements(spec, plugin.index.requirementRefs())
  const fields = resolveBlockFields(spec.fields, plugin.settings.requirements.blockFields)
  for (const requirement of rows) renderRow(plugin, root, requirement, spec, fields)
  // A requirement deleted under a document leaves a hole in the document, said in the
  // place the requirement used to be. Silence here would be the document quietly
  // getting shorter.
  for (const id of missing) notice(root, 'circle-slash', t('req.block.missing', { id }), 'warn')
  if (!rows.length && !missing.length) notice(root, 'circle-slash', t('req.block.none'), 'hint')
}

function notice(root: HTMLElement, icon: string, text: string, kind: 'warn' | 'hint'): void {
  const line = root.createDiv(`pm-reqblock-notice pm-reqblock-notice--${kind}`)
  setIcon(line.createSpan({ cls: 'pm-glyph-icon' }), icon)
  line.createSpan({ text })
}

function renderRow(
  plugin: PMPlugin,
  root: HTMLElement,
  requirement: Requirement,
  spec: ReqBlockSpec,
  fields: ReqBlockField[]
): void {
  const row = root.createDiv('pm-reqblock-row')

  // One pass, in the order asked for, identifier and title included. Drawing either of
  // them ahead of the loop — which is what this did until somebody put the rating first
  // and watched it come out third — makes the order a suggestion.
  for (const line of reqHeadLines(requirement, fields, plugin.settings)) {
    const head = row.createDiv('pm-reqblock-head')
    for (const part of line) drawPart(plugin, head, requirement, part)
  }

  if (!fields.includes('text')) return
  const quoted = quotedWording(requirement, spec.lang)
  if (!quoted) {
    row.createDiv({ cls: 'pm-reqblock-text pm-reqblock-text--absent', text: t('req.noWording') })
    return
  }
  row.createDiv({ cls: 'pm-reqblock-text', text: quoted.body })

  // The state of the wording travels with the words. A specification embedding a
  // translation that has fallen behind is the failure the whole library exists to stop.
  const marks = row.createDiv('pm-reqblock-marks')
  if (quoted.fallback) mark(marks, 'languages', t('req.fallbackFrom', { lang: quoted.lang.toUpperCase() }), 'stale')
  if (quoted.stale) mark(marks, 'history', t('req.flag.stale'), 'stale')
  if (quoted.unreviewed) mark(marks, 'bot', t('req.machineWording'), 'machine')
  if (!marks.hasChildNodes()) marks.remove()
}

function drawPart(plugin: PMPlugin, head: HTMLElement, requirement: Requirement, part: ReqHeadPart): void {
  switch (part.kind) {
    case 'id': {
      // A link, because the point of quoting rather than pasting is being able to go and
      // see the requirement itself.
      const id = head.createEl('a', { cls: 'pm-req-id pm-reqblock-id', text: part.id, href: '#' })
      id.addEventListener(
        'click',
        safeAsync(async (event: MouseEvent) => {
          event.preventDefault()
          await openRequirementModal(plugin, requirement.filePath ?? '')
        })
      )
      break
    }
    case 'title':
      head.createSpan({ cls: 'pm-reqblock-title', text: part.text })
      break
    case 'chip':
      chip(head, part.glyph)
      break
    case 'rating':
      // The stars, with the percentage on the tooltip for whoever wants the number
      // behind them.
      renderStars(head, part.stars, 'pm-req-stars--small').title = t('req.ratingOf', { score: part.score })
      break
  }
}

function chip(parent: HTMLElement, glyph: { label: string; color: string; icon: string }): void {
  if (!glyph.label) return
  const built = new Chip(parent).setLabel(glyph.label).setLeadingIcon(glyph.icon).setVariant('outline')
  if (glyph.color) built.setColor(glyph.color)
}

function mark(parent: HTMLElement, icon: string, text: string, kind: 'stale' | 'machine'): void {
  const el = parent.createSpan({ cls: `pm-req-state pm-req-state--${kind}` })
  setIcon(el.createSpan({ cls: 'pm-glyph-icon' }), icon)
  el.createSpan({ text })
}
