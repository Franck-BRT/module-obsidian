import { App, ButtonComponent, Modal, setIcon, setTooltip } from 'obsidian'
import type PMPlugin from '../main'
import type { DependencyNode } from '../store/DependencyTree'
import { buildDependencyTree, countPickable, filterDependencyTree } from '../store/DependencyTree'
import { reaches } from '../store/Scheduler'
import { Checkbox } from '../ui/primitives/Checkbox'
import { IconButton } from '../ui/primitives/IconButton'
import { t } from '../i18n'

export interface DependencyPickerOpts {
  plugin: PMPlugin
  /** The ticket being given predecessors. */
  taskId: string
  /** Its project, so its own tickets are the first thing offered. */
  homeProject: string | null
  /** What is already chosen. Returned as-is when the picker is cancelled. */
  selected: string[]
  onConfirm: (ids: string[]) => void
}

/**
 * Choosing what a ticket waits on, in a window rather than a drop-down.
 *
 * A vault-wide list of every ticket by title is unusable past a few dozen — the tickets
 * are there, they just cannot be found — so the candidates are shown the way they are
 * organised: project, lot, ticket, foldable, with a search over the lot. What is chosen
 * stands on the right, where it can be read as a list and taken back one by one, rather
 * than being inferred from ticks scattered down a tree.
 *
 * Nothing is written until Confirm: the picker hands back a list and the editor decides
 * what to do with it, which is what keeps the link type and lag of an existing
 * dependency from being lost on the way through.
 */
export class DependencyPickerModal extends Modal {
  private chosen: Set<string>
  private query = ''
  private tree: DependencyNode[] = []
  private expanded = new Set<string>()
  private treeEl!: HTMLElement
  private chosenEl!: HTMLElement
  private countEl!: HTMLElement

  constructor(
    app: App,
    private opts: DependencyPickerOpts
  ) {
    super(app)
    this.chosen = new Set(opts.selected)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('pm-te-surface')
    this.modalEl.addClass('pm-modal', 'pm-modal--deps')

    contentEl.createEl('h2', { text: t('deps.pickTitle'), cls: 'pm-deps-title' })

    const search = contentEl.createDiv('pm-deps-search')
    setIcon(search.createSpan({ cls: 'pm-deps-search-icon' }), 'search')
    const input = search.createEl('input', {
      type: 'text',
      cls: 'pm-deps-search-field',
      attr: { placeholder: t('deps.searchPlaceholder'), spellcheck: 'false' }
    })
    input.addEventListener('input', () => {
      this.query = input.value
      this.renderTree()
    })

    const body = contentEl.createDiv('pm-deps-body')
    const left = body.createDiv('pm-deps-pane pm-deps-pane--tree')
    this.treeEl = left.createDiv('pm-deps-tree')

    const right = body.createDiv('pm-deps-pane pm-deps-pane--chosen')
    this.countEl = right.createDiv('pm-deps-chosen-head')
    this.chosenEl = right.createDiv('pm-deps-chosen-list')

    const foot = contentEl.createDiv('pm-deps-foot')
    new ButtonComponent(foot).setButtonText(t('dialog.cancel')).onClick(() => this.close())
    new ButtonComponent(foot)
      .setButtonText(t('dialog.ok'))
      .setCta()
      .onClick(() => {
        this.opts.onConfirm([...this.chosen])
        this.close()
      })

    this.buildTree()
    this.renderTree()
    this.renderChosen()
    input.focus()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private buildTree(): void {
    const { plugin, taskId } = this.opts
    // Built once per open rather than once per candidate: a chain of predecessors can
    // leave this project and come back, so the whole vault's edges are needed to know
    // which candidates would close a loop.
    const edges = plugin.index.dependentsMap()
    this.tree = buildDependencyTree({
      tasks: plugin.index.allTaskRefs(),
      projectOf: (path) => plugin.index.projectRef(path),
      taskId,
      homeProject: this.opts.homeProject,
      selected: this.opts.selected,
      blocks: (candidate) => !this.chosen.has(candidate) && reaches(edges, taskId, candidate),
      looseLabel: t('collection.orphanGroup')
    })
    // The project being edited starts open; everything else waits to be asked for.
    const home = this.tree[0]
    if (home) this.expanded.add(home.key)
  }

  private renderTree(): void {
    this.treeEl.empty()
    const shown = filterDependencyTree(this.tree, this.query)
    if (!shown.length) {
      this.treeEl.createDiv({ cls: 'pm-deps-empty', text: t('deps.noMatch') })
      return
    }
    // A search says which rows it reached by opening the way to them; without it a match
    // three levels down would sit behind a folded group and look like no match at all.
    const searching = this.query.trim().length > 0
    for (const node of shown) this.renderNode(this.treeEl, node, 0, searching)
  }

  private renderNode(parent: HTMLElement, node: DependencyNode, depth: number, forceOpen: boolean): void {
    const row = parent.createDiv('pm-deps-row')
    row.style.setProperty('--depth', String(depth))
    const container = node.kind !== 'task'
    const isOpen = forceOpen || this.expanded.has(node.key)

    if (container) {
      const twist = row.createSpan({ cls: 'pm-deps-twist' })
      setIcon(twist, isOpen ? 'chevron-down' : 'chevron-right')
      row.addClass('pm-deps-row--group')
      row.addEventListener('click', () => {
        if (isOpen) this.expanded.delete(node.key)
        else this.expanded.add(node.key)
        this.renderTree()
      })
    } else {
      const box = new Checkbox(row.createSpan({ cls: 'pm-deps-check' }))
        .setChecked(this.chosen.has(node.key))
        .setAriaLabel(node.label)
        .onChange((on) => {
          if (on) this.chosen.add(node.key)
          else this.chosen.delete(node.key)
          this.renderChosen()
        })
      box.el.disabled = !!node.blocked
    }

    setIcon(row.createSpan({ cls: 'pm-deps-icon' }), iconFor(node.kind))
    // A ticket's name is regularly longer than the row, so the row carries it whole.
    setTooltip(row.createSpan({ cls: 'pm-deps-label', text: node.label }), node.label)

    if (container) {
      row.createSpan({ cls: 'pm-deps-count', text: String(countPickable(node)) })
    } else if (node.blocked) {
      // Said out loud, because a candidate that is merely absent reads as a lost ticket.
      row.addClass('pm-deps-row--blocked')
      row.createSpan({ cls: 'pm-deps-blocked', text: t('deps.wouldLoop') })
    } else {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.pm-deps-check')) return
        if (this.chosen.has(node.key)) this.chosen.delete(node.key)
        else this.chosen.add(node.key)
        this.renderTree()
        this.renderChosen()
      })
    }

    if (isOpen) {
      for (const child of node.children) this.renderNode(parent, child, depth + 1, forceOpen)
    }
  }

  private renderChosen(): void {
    this.countEl.setText(t('deps.chosenCount', { count: this.chosen.size }))
    this.chosenEl.empty()
    if (this.chosen.size === 0) {
      this.chosenEl.createDiv({ cls: 'pm-deps-empty', text: t('deps.chooseHint') })
      return
    }
    for (const id of this.chosen) {
      const row = this.chosenEl.createDiv('pm-deps-chosen-row')
      const ref = this.opts.plugin.index.task(id)
      const name = ref?.title ?? id
      setTooltip(row.createSpan({ cls: 'pm-deps-label', text: name }), name)
      const project = ref?.projectPath ? this.opts.plugin.index.projectRef(ref.projectPath)?.title : null
      if (project) row.createSpan({ cls: 'pm-deps-chosen-project', text: project })
      new IconButton(row)
        .setIcon('x')
        .setTooltip(t('dependency.remove'))
        .onClick(() => {
          this.chosen.delete(id)
          this.renderTree()
          this.renderChosen()
        })
    }
  }
}

function iconFor(kind: DependencyNode['kind']): string {
  if (kind === 'project') return 'folder'
  if (kind === 'lot') return 'layers'
  return 'circle-dot'
}
