import { MarkdownRenderChild, Modal, TFile, type App } from 'obsidian'
import type PMPlugin from '../../main'
import { branchCount, conversationTree, type ConversationTree } from '../../store/chat/chatBranches'
import { BRANCHES_LANGUAGE, localStamp, readChatNote } from '../../store/chat/chatNote'
import { t } from '../../i18n'
import { safeAsync } from '../../utils'

/**
 * A conversation's branches, drawn the way a history of versions is: a dot a question,
 * a lane a branch, a curve where a question was asked again. The thread the conversation
 * goes on from is drawn in full; the branches left behind are drawn faint, and each of
 * their questions can be picked to go back to it.
 */

/** Height of a row, width of a lane, in pixels. */
const ROW = 30
const LANE = 18
const PAD = 11

/** One colour a lane, from the theme's own, so the drawing reads in light and dark alike. */
const LANE_COLORS = [
  'var(--color-blue)',
  'var(--color-purple)',
  'var(--color-green)',
  'var(--color-orange)',
  'var(--color-pink)',
  'var(--color-cyan)',
  'var(--color-yellow)',
  'var(--color-red)'
]

const laneColor = (lane: number): string => LANE_COLORS[lane % LANE_COLORS.length]

/** A question on one line: its first words. */
function excerpt(text: string): string {
  const line = text.split('\n')[0].replace(/\s+/g, ' ').trim()
  return line.length > 70 ? `${line.slice(0, 68).trimEnd()}…` : line
}

export interface GraphOptions {
  /** Picked: the exchange the reader wants to go back to. */
  onPick?: (index: number) => void
}

export function renderBranchGraph(parent: HTMLElement, tree: ConversationTree, options: GraphOptions = {}): void {
  const graph = parent.createDiv('pm-branches')
  const rows = tree.exchanges.length
  const width = PAD * 2 + Math.max(0, tree.lanes - 1) * LANE
  graph.style.setProperty('--pm-branches-gutter', `${width + 6}px`)
  graph.style.setProperty('--pm-branches-row', `${ROW}px`)
  const x = (lane: number): number => PAD + lane * LANE
  const y = (row: number): number => row * ROW + ROW / 2

  const svg = graph.createSvg('svg', {
    cls: 'pm-branches-lines',
    attr: { width, height: rows * ROW, viewBox: `0 0 ${width} ${rows * ROW}`, 'aria-hidden': 'true' }
  })
  for (const exchange of tree.exchanges) {
    if (exchange.parent === null) continue
    const from = tree.exchanges[exchange.parent]
    const x1 = x(from.lane)
    const y1 = y(from.index)
    const x2 = x(exchange.lane)
    const y2 = y(exchange.index)
    // Along its lane when it carries on; off to the right in a curve when it branches.
    const d =
      x1 === x2
        ? `M ${x1} ${y1} L ${x2} ${y2}`
        : `M ${x1} ${y1} C ${x1} ${y1 + ROW * 0.6}, ${x2} ${y1 + ROW * 0.4}, ${x2} ${y1 + ROW} L ${x2} ${y2}`
    svg.createSvg('path', {
      cls: `pm-branches-edge${exchange.current ? ' is-current' : ''}`,
      attr: { d, stroke: laneColor(exchange.lane), fill: 'none' }
    })
  }
  for (const exchange of tree.exchanges) {
    svg.createSvg('circle', {
      cls: `pm-branches-dot${exchange.current ? ' is-current' : ''}`,
      attr: {
        cx: x(exchange.lane),
        cy: y(exchange.index),
        r: exchange.current ? 5 : 4,
        stroke: laneColor(exchange.lane),
        fill: exchange.current ? laneColor(exchange.lane) : 'var(--background-primary)'
      }
    })
  }

  const list = graph.createDiv('pm-branches-rows')
  for (const exchange of tree.exchanges) {
    const row = list.createDiv(`pm-branches-row${exchange.current ? ' is-current' : ''}`)
    row.createSpan({ cls: 'pm-branches-when', text: localStamp(exchange.question.at).slice(11) })
    if (exchange.question.retakes) {
      row.createSpan({ cls: 'pm-branches-mark', text: '↻', attr: { title: t('chat.branchRetake') } })
    } else if (exchange.question.follows) {
      row.createSpan({ cls: 'pm-branches-mark', text: '↪', attr: { title: t('chat.branchFollows') } })
    }
    row.createSpan({ cls: 'pm-branches-question', text: excerpt(exchange.question.content) })
    row.setAttr('title', exchange.question.content.slice(0, 400))
    const pick = options.onPick
    if (pick) {
      row.addClass('is-pickable')
      row.setAttr('role', 'button')
      row.setAttr('tabindex', '0')
      row.addEventListener('click', () => pick(exchange.index))
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') pick(exchange.index)
      })
    }
  }
}

/** The legend over a graph: how many branches, and what a pick does. */
function renderLegend(parent: HTMLElement, tree: ConversationTree, pickable: boolean): void {
  const legend = parent.createDiv('pm-branches-legend')
  legend.createSpan({ text: t('chat.branchCount', { count: branchCount(tree) }) })
  if (pickable) legend.createSpan({ cls: 'pm-branches-hint', text: t('chat.branchHint') })
}

/**
 * The block in a conversation's note: its branches, drawn from the note itself and drawn
 * again whenever the note changes. A question picked opens the chat on that branch.
 */
export function registerBranchBlock(plugin: PMPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor(BRANCHES_LANGUAGE, (_source, el, ctx) => {
    ctx.addChild(new BranchBlock(plugin, el, ctx.sourcePath))
  })
}

class BranchBlock extends MarkdownRenderChild {
  constructor(
    private plugin: PMPlugin,
    container: HTMLElement,
    private path: string
  ) {
    super(container)
  }

  onload(): void {
    void this.draw()
    this.registerEvent(
      this.plugin.app.vault.on('modify', (file) => {
        if (file.path === this.path) void this.draw()
      })
    )
  }

  private async draw(): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(this.path)
    if (!(file instanceof TFile)) return
    const tree = conversationTree(readChatNote(await this.plugin.app.vault.cachedRead(file)).all)
    this.containerEl.empty()
    const box = this.containerEl.createDiv('pm-branches-box')
    renderLegend(box, tree, true)
    renderBranchGraph(box, tree, {
      onPick: safeAsync((index: number) => this.plugin.chatOnBranch(this.path, index))
    })
  }
}

/** The same drawing in a window, from the chat panel. */
export class BranchModal extends Modal {
  constructor(
    app: App,
    private tree: ConversationTree,
    private onPick: (index: number) => void
  ) {
    super(app)
  }

  onOpen(): void {
    this.setTitle(t('chat.branches'))
    this.modalEl.addClass('pm-branches-modal')
    renderLegend(this.contentEl, this.tree, true)
    renderBranchGraph(this.contentEl, this.tree, {
      onPick: (index) => {
        this.close()
        this.onPick(index)
      }
    })
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
