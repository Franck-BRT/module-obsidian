import { ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../../main'
import type { Requirement } from '../../store/requirements/Requirement'
import type { TranslationOutcome } from '../../store/requirements/RequirementTranslator'
import { REQ_BLOCK_LANGUAGE } from '../../store/requirements/reqBlock'
import {
  COVERAGE_GAPS,
  coverageOf,
  countGaps,
  hasGap,
  type Coverage,
  type CoverageGap
} from '../../store/requirements/ReqCoverage'
import {
  displayText,
  isStale,
  isUnreviewedMachine,
  missingLanguages,
  textOf
} from '../../store/requirements/Requirement'
import {
  compareToBaseline,
  countChanges,
  type Baseline,
  type BaselineChange,
  type BaselineChangeKind
} from '../../store/requirements/Baseline'
import type { DiffPart } from '../../store/requirements/reqDiff'
import { formatDateShort } from '../../dates'
import {
  buildReqForest,
  flattenForest,
  forestDepth,
  pruneForest,
  type FlatReqRow
} from '../../store/requirements/reqTree'
import { CollapseToggle } from '../../ui/primitives/CollapseToggle'
import { renderTreeGuides } from '../../ui/composites/treeGuides'
import { toCsv } from '../../store/requirements/reqCsv'
import { toReqif } from '../../store/requirements/reqif'
import { toMarkdownDocument } from '../../store/requirements/reqMarkdown'
import { exportFileName } from '../../store/requirements/ReqPorter'
import { pickVaultFile } from '../../modals/PickerModals'
import { openReqImport } from './ReqImportModal'
import { EmptyState } from '../../ui/primitives/EmptyState'
import { ChipButton } from '../../ui/primitives/ChipButton'
import { Chip } from '../../ui/primitives/Chip'
import { renderSelectControl } from '../../ui/composites/properties'
import { confirmDialog, promptText } from '../../ui/ModalFactory'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'
import { openRequirementModal } from './RequirementModal'
import { reqCriticalityGlyph, reqLanguages, reqStatusGlyph, reqTypeGlyph } from './reqPalette'
import {
  EMPTY_REQ_FILTER,
  filterRequirements,
  isReqFilterActive,
  reqCategories,
  sortRequirements,
  type ReqFilterState,
  type ReqFlag,
  type ReqSortKey
} from './reqFilter'

export const PM_REQUIREMENTS_VIEW_TYPE = 'pm-requirements'

const FLAGS: ReqFlag[] = ['stale', 'unreviewed', 'missing', 'suspect', 'quality']

/**
 * The requirements library.
 *
 * Vault-wide, not scoped to a project, because that is what a requirement is: written
 * once and cited by every plan and every document that needs it. The view's job is to
 * make a library of a few thousand statements answerable — find the one about hatch
 * opening times, in whichever language somebody remembers it in, and say at a glance
 * which of them have drifted out of step with the source they were translated from.
 */
export class RequirementsView extends ItemView {
  private filter: ReqFilterState = { ...EMPTY_REQ_FILTER }
  /** Which wording the rows show. Not a setting: it is a way of reading, chosen and changed. */
  private lang: string
  private sortKey: ReqSortKey = 'id'
  private sortDir: 'asc' | 'desc' = 'asc'
  private toolbarEl!: HTMLElement
  private bodyEl!: HTMLElement
  private redrawTimer: number | null = null
  /**
   * Which question the view is answering: what the library says, or what it is tied to.
   *
   * Two views of one list rather than two views, because the filters and the search mean
   * the same thing in both and a reader narrowing to a category should not lose it by
   * asking what covers it.
   */
  private mode: 'library' | 'tree' | 'trace' | 'baseline' = 'library'
  private gapFilter: CoverageGap | null = null
  /** Null until the notes have been read once; an empty map is a real answer, null is not. */
  private usage: Map<string, string[]> | null = null
  /** The baseline being compared against, once one has been chosen and loaded. */
  private baseline: Baseline | null = null
  /** True while a bulk translation is running, which is what the same button then stops. */
  private running = false
  private stopRequested = false

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
    this.navigation = false
    this.lang = reqLanguages(plugin.settings)[0]
  }

  getViewType(): string {
    return PM_REQUIREMENTS_VIEW_TYPE
  }
  getDisplayText(): string {
    return t('req.libraryTitle')
  }
  getIcon(): string {
    return 'list-checks'
  }

  onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root')
    this.toolbarEl = root.createDiv('pm-toolbar')
    this.bodyEl = root.createDiv('pm-content pm-req-content')
    this.render()
    // The library is written to from the editor and from the notes themselves; either way
    // the index is what notices, so one subscription covers both.
    this.register(
      this.plugin.index.onChange(() => {
        if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
        this.redrawTimer = window.setTimeout(() => {
          this.redrawTimer = null
          this.render()
        }, 250)
      })
    )
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    this.redrawTimer = null
    return Promise.resolve()
  }

  render(): void {
    const all = this.plugin.index.requirementRefs()
    const langs = reqLanguages(this.plugin.settings)
    if (!langs.includes(this.lang)) this.lang = langs[0]
    this.renderToolbar(all, langs)
    this.bodyEl.empty()

    if (!all.length) {
      new EmptyState(this.bodyEl)
        .setIcon('📐')
        .setTitle(t('req.empty'))
        .setBody(t('req.emptyHint'))
        .setAction(
          t('req.new'),
          safeAsync(() => this.createRequirement())
        )
      return
    }

    this.renderBody(all, langs)
  }

  private renderBody(all: Requirement[], langs: string[]): void {
    const shown = sortRequirements(filterRequirements(all, this.filter, langs), this.sortKey, this.sortDir, this.lang)
    if (this.mode === 'tree') {
      this.renderTree(this.bodyEl, all, shown)
      return
    }
    if (this.mode === 'trace') {
      this.renderTrace(this.bodyEl, shown, langs)
      return
    }
    if (this.mode === 'baseline') {
      this.renderBaselines(this.bodyEl, shown)
      return
    }
    if (!shown.length) {
      new EmptyState(this.bodyEl).setIcon('🔍').setTitle(t('req.noneHere')).setBody(t('req.noneHereHint'))
      return
    }
    this.renderTable(this.bodyEl, shown, langs)
  }

  private renderToolbar(all: Requirement[], langs: string[]): void {
    const bar = this.toolbarEl
    bar.empty()
    bar.addClass('pm-req-toolbar')

    const search = bar.createEl('input', {
      cls: 'pm-req-search',
      type: 'search',
      attr: { placeholder: t('req.searchPlaceholder'), spellcheck: 'false' }
    })
    search.value = this.filter.search
    search.addEventListener('input', () => {
      this.filter.search = search.value
      this.renderBodyOnly()
    })

    const filters = bar.createDiv('pm-req-filters')
    this.renderSelect(
      filters,
      'category',
      t('req.allCategories'),
      'folder-tree',
      reqCategories(all).map((category) => ({ id: category, label: category, icon: 'folder-tree' }))
    )
    this.renderSelect(
      filters,
      'type',
      t('req.allTypes'),
      'shapes',
      this.plugin.settings.requirements.types.map((entry) => ({
        id: entry.id,
        label: entry.label,
        color: entry.color,
        icon: entry.icon || 'shapes'
      }))
    )
    this.renderSelect(
      filters,
      'status',
      t('req.allStatuses'),
      'circle-dashed',
      this.plugin.settings.requirements.statuses.map((entry) => ({
        id: entry.id,
        label: entry.label,
        color: entry.color,
        icon: entry.icon || 'circle-dashed'
      }))
    )

    // Counted against the whole library rather than against what the other filters leave,
    // so the numbers say what there is instead of rearranging themselves as they are used.
    const flags = bar.createDiv('pm-req-flags')
    if (this.mode === 'trace') this.renderGapBar(flags, all, langs)
    else if (this.mode === 'library') this.renderFlagBar(flags, all, langs)

    const right = bar.createDiv('pm-req-toolbar-right')
    this.renderModeSwitch(right)
    this.renderRightBar(right, all, langs)
  }

  /** The two questions, side by side, because they are asked of the same narrowed list. */
  private renderModeSwitch(parent: HTMLElement): void {
    const group = parent.createDiv('pm-req-modes')
    const mode = (id: typeof this.mode, label: string): void => {
      new ChipButton(group)
        .setLabel(label)
        .setShape('pill')
        .setActive(this.mode === id)
        .onClick(() => {
          this.mode = id
          this.render()
        })
    }
    mode('library', t('req.modeLibrary'))
    mode('tree', t('req.modeTree'))
    mode('trace', t('req.modeTrace'))
    mode('baseline', t('req.modeBaseline'))
  }

  private renderFlagBar(flags: HTMLElement, all: Requirement[], langs: string[]): void {
    new ChipButton(flags)
      .setLabel(`${t('common.all')} · ${all.length}`)
      .setShape('pill')
      .setActive(this.filter.flag === 'all')
      .onClick(() => {
        this.filter.flag = 'all'
        this.renderBodyOnly()
      })
    for (const flag of FLAGS) {
      const count = filterRequirements(all, { ...EMPTY_REQ_FILTER, flag }, langs).length
      // A flag nothing is at gets no pill: an always-present "Obsolètes · 0" is a thing
      // to learn to ignore.
      if (!count) continue
      new ChipButton(flags)
        .setLabel(`${flagLabel(flag)} · ${count}`)
        .setShape('pill')
        .setActive(this.filter.flag === flag)
        .onClick(() => {
          this.filter.flag = this.filter.flag === flag ? 'all' : flag
          this.renderBodyOnly()
        })
    }
  }

  private renderRightBar(right: HTMLElement, all: Requirement[], langs: string[]): void {
    if (langs.length > 1) {
      const picker = right.createDiv('pm-req-langs')
      for (const lang of langs) {
        new ChipButton(picker)
          .setLabel(lang.toUpperCase())
          .setShape('pill')
          .setActive(this.lang === lang)
          .onClick(() => {
            this.lang = lang
            this.render()
          })
      }
    }
    if (isReqFilterActive(this.filter)) {
      new ChipButton(right)
        .setLabel(t('common.clear'))
        .setShape('pill')
        .onClick(() => {
          this.filter = { ...EMPTY_REQ_FILTER }
          this.render()
        })
    }
    // Offered only when there is a gateway to ask and something for it to do: a button
    // that explains on click why it cannot work is a button that should not be drawn.
    if (this.plugin.translator.available) {
      const jobs = this.pendingJobs(all, langs)
      if (jobs.length || this.running) {
        const bulk = right.createEl('button', { cls: 'pm-req-bulk' })
        setIcon(bulk.createSpan({ cls: 'pm-glyph-icon' }), this.running ? 'square' : 'languages')
        bulk.createSpan({
          text: this.running ? t('req.bulkStop') : t('req.bulkTranslate', { count: jobs.length })
        })
        bulk.addEventListener(
          'click',
          this.running
            ? () => {
                this.stopRequested = true
              }
            : safeAsync(() => this.runBulk(jobs))
        )
      }
    }

    const port = right.createEl('button', { cls: 'pm-req-port', attr: { 'aria-label': t('req.exchange') } })
    setIcon(port, 'arrow-down-up')
    port.addEventListener('click', (event) => this.showPortMenu(event, all, langs))

    const add = right.createEl('button', { cls: 'pm-req-new mod-cta' })
    setIcon(add.createSpan({ cls: 'pm-glyph-icon' }), 'plus')
    add.createSpan({ text: t('req.new') })
    add.addEventListener(
      'click',
      safeAsync(() => this.createRequirement())
    )
  }

  private renderSelect(
    parent: HTMLElement,
    key: 'category' | 'type' | 'status',
    allLabel: string,
    allIcon: string,
    options: { id: string; label: string; color?: string; icon: string }[]
  ): void {
    // The chosen value stays on offer even when nothing is at it any more, or there would
    // be no way back to "all" but to guess that the select still opens.
    const known = options.some((option) => option.id === this.filter[key])
    const full =
      known || this.filter[key] === ''
        ? options
        : [...options, { id: this.filter[key], label: this.filter[key], icon: allIcon }]
    renderSelectControl({
      container: parent,
      value: this.filter[key],
      search: full.length > 6,
      options: [{ id: '', label: allLabel, icon: allIcon }, ...full],
      onChange: (id) => {
        this.filter[key] = id
        this.renderBodyOnly()
      }
    })
  }

  /** Redraws the rows without rebuilding the bar, so typing in the search keeps focus. */
  private renderBodyOnly(): void {
    this.bodyEl.empty()
    this.renderBody(this.plugin.index.requirementRefs(), reqLanguages(this.plugin.settings))
  }

  /* ---- The tree of derivations ----------------------------------------------- */

  /**
   * The shape of the library.
   *
   * Built from the whole library rather than from what the filters leave, because a tree
   * of filtered nodes is a list with indentation: the parent of a match is the context
   * that makes the match mean something, and it is usually the thing that did not match.
   * So the filters choose what is *highlighted*, and the branches around it are kept.
   */
  private renderTree(parent: HTMLElement, all: Requirement[], shown: Requirement[]): void {
    const forest = buildReqForest(all)
    const narrowed = isReqFilterActive(this.filter)
    const matched = new Set(shown.map((requirement) => requirement.id))
    const roots = narrowed ? pruneForest(forest.roots, matched) : forest.roots

    const head = parent.createDiv('pm-req-tree-head')
    head.createSpan({
      cls: 'pm-req-rev',
      text: t('req.treeShape', { roots: roots.length, depth: forestDepth(roots) })
    })
    // Said where the tree is, because each is a way the tree is not telling the whole
    // truth and the reader is entitled to know which.
    if (forest.cycles.length) {
      this.treeNotice(head, 'refresh-cw', t('req.treeCycles', { list: forest.cycles.join(', ') }))
    }
    if (forest.dangling.length) {
      this.treeNotice(
        head,
        'unlink',
        t('req.treeDangling', { list: forest.dangling.map((entry) => `${entry.id} → ${entry.parent}`).join(', ') })
      )
    }

    if (!roots.length) {
      new EmptyState(parent)
        .setIcon('🌳')
        .setTitle(narrowed ? t('req.noneHere') : t('req.treeEmpty'))
        .setBody(narrowed ? t('req.noneHereHint') : t('req.treeEmptyHint'))
    } else {
      const table = parent.createDiv('pm-req-tree')
      const collapsed = new Set(this.plugin.settings.collapsedRequirements)
      for (const row of flattenForest(roots, collapsed)) this.renderTreeRow(table, row, matched, narrowed, collapsed)
    }

    // Kept out of the trees and listed after them: a library barely linked would
    // otherwise draw a thousand stumps and hide the three real branches among them.
    const isolated = narrowed ? forest.isolated.filter((requirement) => matched.has(requirement.id)) : forest.isolated
    if (!isolated.length) return
    const section = parent.createDiv('pm-req-section pm-req-tree-isolated')
    section
      .createDiv('pm-req-section-head')
      .createSpan({ cls: 'pm-req-section-title', text: t('req.treeIsolated', { count: isolated.length }) })
    const list = section.createDiv('pm-req-tree')
    for (const requirement of isolated) {
      this.renderTreeRow(
        list,
        {
          node: { requirement, children: [], depth: 0, repeated: false, cyclic: false },
          guides: [],
          lastChild: true,
          hasChildren: false
        },
        matched,
        narrowed,
        new Set()
      )
    }
  }

  private treeNotice(parent: HTMLElement, icon: string, text: string): void {
    const line = parent.createDiv('pm-reqblock-notice pm-reqblock-notice--warn')
    setIcon(line.createSpan({ cls: 'pm-glyph-icon' }), icon)
    line.createSpan({ text })
  }

  private renderTreeRow(
    table: HTMLElement,
    row: FlatReqRow,
    matched: Set<string>,
    narrowed: boolean,
    collapsed: Set<string>
  ): void {
    const requirement = row.node.requirement
    const el = table.createDiv('pm-req-tree-row')
    // Dimmed rather than removed when it is only there to hold a match: the branch is
    // the context, and context that looks like a result is context that misleads.
    if (narrowed && !matched.has(requirement.id)) el.addClass('pm-req-tree-row--context')

    const rail = el.createDiv('pm-req-tree-rail')
    rail.style.setProperty('--pm-tree-depth', String(row.guides.length))
    renderTreeGuides(rail, row.guides.length ? row.guides : null, row.lastChild)
    if (row.hasChildren) {
      new CollapseToggle(rail, {
        collapsed: collapsed.has(requirement.id),
        subject: t('req.derivations'),
        onToggle: (event) => {
          event.stopPropagation()
          void this.toggleBranch(requirement.id)
        }
      }).el.style.setProperty('--level', String(row.guides.length))
    }

    const cell = el.createDiv('pm-req-tree-cell')
    cell.createSpan({ cls: 'pm-req-id', text: requirement.id })
    const held = displayText(requirement, this.lang)
    cell.createSpan({ cls: 'pm-req-wording', text: requirement.title || held?.body || t('req.noWording') })
    const status = reqStatusGlyph(this.plugin.settings, requirement.status)
    if (status.label) {
      new Chip(cell).setLabel(status.label).setColor(status.color).setLeadingIcon(status.icon).setVariant('outline')
    }
    // The same requirement in two places, not two requirements: said, or a reader counts
    // it twice and wonders why the totals do not add up.
    if (row.node.repeated) this.treeMark(cell, 'copy', t('req.treeRepeated'))
    if (row.node.cyclic) this.treeMark(cell, 'refresh-cw', t('req.treeCyclic'))

    el.addEventListener(
      'click',
      safeAsync(() => openRequirementModal(this.plugin, requirement.filePath ?? ''))
    )
  }

  private treeMark(cell: HTMLElement, icon: string, text: string): void {
    const badge = cell.createSpan({ cls: 'pm-req-state pm-req-state--gap' })
    setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), icon)
    badge.createSpan({ text })
  }

  private async toggleBranch(id: string): Promise<void> {
    const folded = this.plugin.settings.collapsedRequirements
    const at = folded.indexOf(id)
    if (at === -1) folded.push(id)
    else folded.splice(at, 1)
    await this.plugin.saveSettings()
    this.render()
  }

  /* ---- In and out ----------------------------------------------------------- */

  /**
   * Handing the library to somebody who does not have this plugin, and taking it back.
   *
   * Three ways out, for three different readers: a table for whoever works in a
   * spreadsheet, ReqIF for whoever has a requirements tool, and a document for whoever
   * just has to read it. One way in, because CSV is the only one of the three this can
   * read back without losing something and saying nothing about it.
   */
  private showPortMenu(event: MouseEvent, all: Requirement[], langs: string[]): void {
    const shown = sortRequirements(filterRequirements(all, this.filter, langs), this.sortKey, this.sortDir, this.lang)
    const menu = new Menu()
    const add = (label: string, icon: string, run: () => void): void => {
      menu.addItem((item) => item.setTitle(label).setIcon(icon).onClick(run))
    }
    add(
      t('req.exportCsv', { count: shown.length }),
      'table',
      safeAsync(() => this.exportAs(shown, 'csv'))
    )
    add(
      t('req.exportReqif', { count: shown.length }),
      'file-code',
      safeAsync(() => this.exportAs(shown, 'reqif'))
    )
    add(
      t('req.exportMarkdown', { count: shown.length }),
      'file-text',
      safeAsync(() => this.exportAs(shown, 'md'))
    )
    menu.addSeparator()
    add(
      t('req.importCsv'),
      'upload',
      safeAsync(() => this.importCsv())
    )
    menu.showAtMouseEvent(event)
  }

  private async exportAs(shown: Requirement[], format: 'csv' | 'reqif' | 'md'): Promise<void> {
    if (!shown.length) {
      new Notice(t('req.noneHere'))
      return
    }
    const title = t('req.libraryTitle')
    const contents =
      format === 'csv'
        ? toCsv(shown)
        : format === 'reqif'
          ? toReqif(shown, { lang: this.lang, title })
          : toMarkdownDocument(shown, { lang: this.lang, title })
    const path = await this.plugin.porter.writeExport(exportFileName(title, format), contents)
    new Notice(t('req.exported', { path }))
    // Opened straight away: an export nobody looks at is an export nobody notices is
    // wrong, and the reader is about to send it to somebody.
    if (format === 'md') await this.app.workspace.openLinkText(path, '', 'tab')
  }

  private async importCsv(): Promise<void> {
    const file = await pickVaultFile(this.app, t('req.importPick'), (candidate) =>
      ['csv', 'txt', 'tsv'].includes(candidate.extension.toLowerCase())
    )
    if (!file) return
    openReqImport(this.plugin, file.name, await this.app.vault.cachedRead(file), () => this.render())
  }

  /* ---- Baselines ------------------------------------------------------------ */

  /**
   * The library as it stood on the days somebody signed for it.
   *
   * Listed rather than opened straight away: the question is usually "which review are we
   * comparing against", and a view that picked the last one for you would answer a
   * different question quietly.
   */
  private renderBaselines(parent: HTMLElement, shown: Requirement[]): void {
    const bar = parent.createDiv('pm-req-baseline-bar')
    const take = bar.createEl('button', { cls: 'pm-req-new mod-cta' })
    setIcon(take.createSpan({ cls: 'pm-glyph-icon' }), 'camera')
    // Says how many it would freeze, because what it freezes is what the filters have
    // left on screen and that is easy to forget having set.
    take.createSpan({ text: t('req.takeBaseline', { count: shown.length }) })
    take.addEventListener(
      'click',
      safeAsync(() => this.takeBaseline(shown))
    )

    if (this.baseline) {
      const back = bar.createEl('button', { text: t('req.allBaselines') })
      back.addEventListener('click', () => {
        this.baseline = null
        this.render()
      })
      this.renderComparison(parent, this.baseline)
      return
    }

    const refs = this.plugin.index.baselineRefs()
    if (!refs.length) {
      new EmptyState(parent).setIcon('📌').setTitle(t('req.noBaseline')).setBody(t('req.noBaselineHint'))
      return
    }
    const table = parent.createDiv('pm-req-table pm-req-baselines')
    for (const ref of refs) {
      const row = table.createDiv('pm-req-row')
      row.createDiv('pm-req-cell').createSpan({ cls: 'pm-req-baseline-name', text: ref.name })
      row.createDiv('pm-req-cell').createSpan({
        cls: 'pm-req-rev',
        text: ref.at ? formatDateShort(ref.at.slice(0, 10)) : ''
      })
      row.createDiv('pm-req-cell').createSpan({ cls: 'pm-req-rev', text: t('req.baselineCount', { count: ref.count }) })
      row.createDiv('pm-req-cell').createSpan({ cls: 'pm-req-rev', text: ref.scope })
      row.addEventListener(
        'click',
        safeAsync(() => this.openBaseline(ref.path))
      )
    }
  }

  private async openBaseline(path: string): Promise<void> {
    const loaded = await this.plugin.baselines.load(path)
    if (!loaded) {
      new Notice(t('req.baselineUnreadable'))
      return
    }
    this.baseline = loaded
    this.render()
  }

  /**
   * Freezes what is on screen.
   *
   * The filters decide the set, and what they were is written into the baseline as words,
   * because in two years the only thing that will say why these four hundred and not
   * those is the sentence somebody left behind.
   */
  private async takeBaseline(shown: Requirement[]): Promise<void> {
    if (!shown.length) {
      new Notice(t('req.noneHere'))
      return
    }
    const name = await promptText(this.app, t('req.takeBaselineTitle'), t('req.baselineName'), '')
    if (!name) return
    const created = await this.plugin.baselines.create(name, shown, {
      by: this.plugin.settings.globalTeamMembers[0] ?? '',
      scope: describeFilter(this.filter)
    })
    if (!created) return
    // The index reads it on the metadata change; listing before that finds nothing.
    this.plugin.index.build()
    this.baseline = created
    this.render()
  }

  /**
   * What the library has done since.
   *
   * Ordered by how much a reader needs to see it: what has gone, what has arrived, what
   * was rewritten, and then — counted rather than listed — everything that stayed put.
   */
  private renderComparison(parent: HTMLElement, baseline: Baseline): void {
    const changes = compareToBaseline(baseline, this.plugin.index.requirementRefs())
    const counts = countChanges(changes)
    const head = parent.createDiv('pm-req-compare-head')
    head.createSpan({ cls: 'pm-req-section-title', text: baseline.name })
    if (baseline.at) head.createSpan({ cls: 'pm-req-rev', text: formatDateShort(baseline.at.slice(0, 10)) })
    head.createSpan({
      cls: 'pm-req-rev',
      text: t('req.changeCounts', {
        added: counts.added,
        removed: counts.removed,
        changed: counts.changed,
        unchanged: counts.unchanged
      })
    })

    const moved = changes.filter((change) => change.kind !== 'unchanged')
    if (!moved.length) {
      new EmptyState(parent).setIcon('📌').setTitle(t('req.baselineSame')).setBody(t('req.baselineSameHint'))
      return
    }
    const order: BaselineChangeKind[] = ['removed', 'added', 'changed']
    const list = parent.createDiv('pm-req-changes')
    for (const kind of order) {
      for (const change of moved.filter((entry) => entry.kind === kind)) this.renderChange(list, change)
    }
  }

  private renderChange(list: HTMLElement, change: BaselineChange): void {
    const row = list.createDiv('pm-req-change')
    const head = row.createDiv('pm-req-change-head')
    const badge = head.createSpan({ cls: `pm-req-state pm-req-state--${change.kind}` })
    setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), changeIcon(change.kind))
    badge.createSpan({ text: changeLabel(change.kind) })
    head.createSpan({ cls: 'pm-req-id', text: change.id })
    const title = change.now?.title ?? change.was?.title ?? ''
    if (title) head.createSpan({ cls: 'pm-reqblock-title', text: title })

    for (const field of change.fields) {
      const line = row.createDiv('pm-req-change-field')
      line.createSpan({ cls: 'pm-req-rev', text: fieldLabel(field.field) })
      line.createSpan({ cls: 'pm-req-diff-removed', text: field.was || '—' })
      line.createSpan({ cls: 'pm-req-diff-added', text: field.now || '—' })
    }
    for (const wording of change.wordings) {
      const block = row.createDiv('pm-req-change-wording')
      block.createSpan({ cls: 'pm-req-lang', text: wording.lang.toUpperCase() })
      renderDiff(block.createDiv('pm-req-diff'), wording.diff)
    }
    // A requirement that has gone is shown as it was, because the note is not there to
    // open and the words are the only thing left of it.
    if (change.kind === 'removed' && change.was) {
      for (const [lang, body] of Object.entries(change.was.text)) {
        const block = row.createDiv('pm-req-change-wording')
        block.createSpan({ cls: 'pm-req-lang', text: lang.toUpperCase() })
        block.createDiv({ cls: 'pm-req-wording', text: body })
      }
    }
    if (change.now) {
      row.addEventListener(
        'click',
        safeAsync(() => openRequirementModal(this.plugin, change.now?.filePath ?? ''))
      )
    }
  }

  /* ---- Traceability --------------------------------------------------------- */

  /**
   * What each requirement is tied to, and where it is tied to nothing.
   *
   * The reason a library is kept apart from the documents that quote it: not to admire
   * the links, but to find the requirement nobody implements, nothing verifies and no
   * document states — which is invisible one requirement at a time and obvious when the
   * library is laid out at once.
   */
  private renderTrace(parent: HTMLElement, list: Requirement[], langs: string[]): void {
    if (this.usage === null) {
      // Said rather than shown empty: "not counted yet" and "quoted nowhere" are
      // different statements, and only one of them is a finding.
      parent.createDiv({ cls: 'pm-req-counting', text: t('req.citedCounting') })
      safeAsync(() => this.countUsage())()
      return
    }
    const rows = coverageOf({ library: list, usage: this.usage, languages: langs })
    const shown = this.gapFilter === null ? rows : rows.filter((row) => hasGap(row, this.gapFilter as CoverageGap))
    if (!shown.length) {
      new EmptyState(parent).setIcon('🔍').setTitle(t('req.noneHere')).setBody(t('req.noneHereHint'))
      return
    }

    const table = parent.createDiv('pm-req-table pm-req-trace')
    const head = table.createDiv('pm-req-row pm-req-row--head')
    for (const label of [
      t('req.field.id'),
      t('req.field.wording'),
      t('req.citedIn'),
      t('req.satisfiedBy'),
      t('req.field.state')
    ]) {
      head.createDiv('pm-req-cell').createSpan({ text: label })
    }
    for (const row of shown) this.renderTraceRow(table, row)
  }

  private renderTraceRow(table: HTMLElement, row: Coverage): void {
    const el = table.createDiv('pm-req-row')
    el.createDiv('pm-req-cell').createSpan({ cls: 'pm-req-id', text: row.requirement.id })

    const text = el.createDiv('pm-req-cell pm-req-cell--text')
    const held = displayText(row.requirement, this.lang)
    text.createDiv({ cls: 'pm-req-wording', text: row.requirement.title || held?.body || t('req.noWording') })

    const cited = el.createDiv('pm-req-cell pm-req-cell--links')
    for (const path of row.citedIn) cited.createSpan({ cls: 'pm-req-trace-item', text: noteName(path) })
    if (!row.citedIn.length) cited.createSpan({ cls: 'pm-req-blank', text: '—' })

    const satisfied = el.createDiv('pm-req-cell pm-req-cell--links')
    for (const id of row.satisfiedBy) satisfied.createSpan({ cls: 'pm-req-trace-item', text: this.ticketName(id) })
    for (const id of row.derivedBy) satisfied.createSpan({ cls: 'pm-req-trace-item', text: id })
    if (!row.satisfiedBy.length && !row.derivedBy.length) satisfied.createSpan({ cls: 'pm-req-blank', text: '—' })

    const state = el.createDiv('pm-req-cell pm-req-cell--state')
    for (const gap of row.gaps) {
      const badge = state.createSpan({ cls: 'pm-req-state pm-req-state--gap' })
      setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), gapIcon(gap))
      badge.createSpan({ text: gapLabel(gap) })
    }
    if (!row.gaps.length) {
      const badge = state.createSpan({ cls: 'pm-req-state pm-req-state--ok' })
      setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), 'check')
      badge.createSpan({ text: t('req.covered') })
    }

    el.addEventListener(
      'click',
      safeAsync(() => openRequirementModal(this.plugin, row.requirement.filePath ?? ''))
    )
  }

  /** A ticket's title where the vault still has it, its bare id where it does not. */
  private ticketName(id: string): string {
    return this.plugin.index.task(id)?.title ?? id
  }

  private async countUsage(): Promise<void> {
    await this.plugin.reqUsage.refresh()
    this.usage = this.plugin.reqUsage.usage()
    this.render()
  }

  private renderGapBar(bar: HTMLElement, all: Requirement[], langs: string[]): void {
    if (this.usage === null) return
    const counts = countGaps(coverageOf({ library: all, usage: this.usage, languages: langs }))
    new ChipButton(bar)
      .setLabel(`${t('common.all')} · ${all.length}`)
      .setShape('pill')
      .setActive(this.gapFilter === null)
      .onClick(() => {
        this.gapFilter = null
        this.render()
      })
    for (const gap of COVERAGE_GAPS) {
      if (!counts[gap]) continue
      new ChipButton(bar)
        .setLabel(`${gapLabel(gap)} · ${counts[gap]}`)
        .setShape('pill')
        .setActive(this.gapFilter === gap)
        .onClick(() => {
          this.gapFilter = this.gapFilter === gap ? null : gap
          this.render()
        })
    }
  }

  private renderTable(parent: HTMLElement, list: Requirement[], langs: string[]): void {
    const table = parent.createDiv('pm-req-table')
    const head = table.createDiv('pm-req-row pm-req-row--head')
    const column = (key: ReqSortKey, label: string, cls: string): void => {
      const cell = head.createDiv(`pm-req-cell ${cls} pm-req-cell--sortable`)
      cell.createSpan({ text: label })
      if (this.sortKey === key) {
        setIcon(cell.createSpan({ cls: 'pm-req-sort' }), this.sortDir === 'asc' ? 'chevron-up' : 'chevron-down')
      }
      cell.addEventListener('click', () => {
        if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'
        else {
          this.sortKey = key
          this.sortDir = 'asc'
        }
        this.render()
      })
    }
    column('id', t('req.field.id'), 'pm-req-cell--id')
    column('title', t('req.field.wording'), 'pm-req-cell--text')
    column('type', t('req.field.type'), 'pm-req-cell--type')
    column('status', t('req.field.status'), 'pm-req-cell--status')
    column('criticality', t('req.field.criticality'), 'pm-req-cell--crit')
    head.createDiv('pm-req-cell pm-req-cell--state').createSpan({ text: t('req.field.state') })

    for (const requirement of list) this.renderRow(table, requirement, langs)
  }

  private renderRow(table: HTMLElement, requirement: Requirement, langs: string[]): void {
    const row = table.createDiv('pm-req-row')
    row.tabIndex = 0
    row.createDiv('pm-req-cell pm-req-cell--id').createSpan({ cls: 'pm-req-id', text: requirement.id })

    const textCell = row.createDiv('pm-req-cell pm-req-cell--text')
    if (requirement.title) textCell.createDiv({ cls: 'pm-req-title', text: requirement.title })
    const held = displayText(requirement, this.lang)
    const wording = textCell.createDiv({ cls: 'pm-req-wording', text: held?.body ?? t('req.noWording') })
    if (!held) wording.addClass('pm-req-wording--absent')
    // Shown as a fallback rather than silently: a French row quietly showing English is a
    // reader thinking the translation exists.
    else if (!requirement.text[this.lang]) {
      const badge = textCell.createSpan({ cls: 'pm-req-fallback' })
      setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), 'languages')
      badge.createSpan({ text: t('req.fallbackFrom', { lang: requirement.sourceLang.toUpperCase() }) })
    }

    const type = reqTypeGlyph(this.plugin.settings, requirement.type)
    this.renderGlyphCell(row, 'pm-req-cell--type', type.label, type.color, type.icon)
    const status = reqStatusGlyph(this.plugin.settings, requirement.status)
    this.renderGlyphCell(row, 'pm-req-cell--status', status.label, status.color, status.icon)
    const crit = reqCriticalityGlyph(this.plugin.settings, requirement.criticality)
    this.renderGlyphCell(row, 'pm-req-cell--crit', crit.label, crit.color, crit.icon)

    const state = row.createDiv('pm-req-cell pm-req-cell--state')
    this.renderState(state, requirement, langs)

    const open = safeAsync(() => openRequirementModal(this.plugin, requirement.filePath ?? ''))
    row.addEventListener('click', open)
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    })
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.rowMenu(event, requirement)
    })
  }

  private renderGlyphCell(row: HTMLElement, cls: string, label: string, color: string, icon: string): void {
    const cell = row.createDiv(`pm-req-cell ${cls}`)
    if (!label) {
      cell.createSpan({ cls: 'pm-req-blank', text: '—' })
      return
    }
    new Chip(cell).setLabel(label).setColor(color).setLeadingIcon(icon).setVariant('outline')
  }

  /**
   * What is wrong with this requirement's wordings, said in words and in shape.
   *
   * Never in colour alone: a translation behind its source and a machine wording nobody
   * has read are two different problems, and telling them apart by hue would leave a
   * colour-blind reader with one undifferentiated warning.
   */
  private renderState(cell: HTMLElement, requirement: Requirement, langs: string[]): void {
    const stale = langs.filter((lang) => isStale(requirement, lang))
    const unreviewed = langs.filter((lang) => isUnreviewedMachine(requirement, lang))
    const missing = missingLanguages(requirement, langs)
    const suspect = requirement.links.filter((link) => link.suspect === true).length

    // The badge is narrow enough to say only which language, so what is wrong with it is
    // on the badge itself for anyone who stops on it.
    const badge = (icon: string, text: string, cls: string, title: string): void => {
      const el = cell.createSpan({ cls: `pm-req-state ${cls}`, attr: { 'aria-label': title, title } })
      setIcon(el.createSpan({ cls: 'pm-glyph-icon' }), icon)
      el.createSpan({ text })
    }
    const codes = (langs_: string[]): string => langs_.map((lang) => lang.toUpperCase()).join(' ')
    if (stale.length) badge('history', codes(stale), 'pm-req-state--stale', t('req.flag.stale'))
    if (unreviewed.length) badge('bot', codes(unreviewed), 'pm-req-state--machine', t('req.flag.unreviewed'))
    if (missing.length) badge('languages', codes(missing), 'pm-req-state--missing', t('req.flag.missing'))
    if (suspect) badge('unlink', String(suspect), 'pm-req-state--suspect', t('req.flag.suspect'))
    if (!stale.length && !unreviewed.length && !missing.length && !suspect) {
      badge('check', t('req.upToDate'), 'pm-req-state--ok', t('req.upToDate'))
    }
  }

  private rowMenu(event: MouseEvent, requirement: Requirement): void {
    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle(t('req.edit'))
        .setIcon('pencil')
        .onClick(safeAsync(() => openRequirementModal(this.plugin, requirement.filePath ?? '')))
    )
    menu.addItem((item) =>
      item
        .setTitle(t('req.openNote'))
        .setIcon('file-text')
        .onClick(
          safeAsync(async () => {
            if (requirement.filePath) await this.app.workspace.openLinkText(requirement.filePath, '', 'tab')
          })
        )
    )
    menu.addItem((item) =>
      item
        .setTitle(t('req.copyId'))
        .setIcon('copy')
        .onClick(safeAsync(() => navigator.clipboard.writeText(requirement.id)))
    )
    // Ready to paste into a specification, because that is what an identifier is copied
    // for nine times out of ten.
    menu.addItem((item) =>
      item
        .setTitle(t('req.copyBlock'))
        .setIcon('clipboard-list')
        .onClick(
          safeAsync(() => navigator.clipboard.writeText(`\`\`\`${REQ_BLOCK_LANGUAGE}\n${requirement.id}\n\`\`\`\n`))
        )
    )
    menu.addSeparator()
    menu.addItem((item) =>
      item
        .setTitle(t('common.delete'))
        .setIcon('trash')
        .onClick(safeAsync(() => this.deleteRequirement(requirement)))
    )
    menu.showAtMouseEvent(event)
  }

  /**
   * Deleting a requirement deletes its note and nothing else.
   *
   * Its id is not freed: the counter that handed it out keeps it for good, because the
   * documents that cited it are out in the world and must never come to mean something
   * else.
   */
  private async deleteRequirement(requirement: Requirement): Promise<void> {
    const ok = await confirmDialog(this.app, t('req.confirmDelete', { id: requirement.id }))
    if (!ok || !requirement.filePath) return
    const file = this.app.vault.getAbstractFileByPath(requirement.filePath)
    if (file) await this.app.fileManager.trashFile(file)
  }

  /**
   * Every wording the gateway could usefully write, for the rows in view.
   *
   * Missing and behind, never level: a translation that already matches its source is
   * somebody's work, and offering to replace it with a machine draft is offering to
   * undo it.
   */
  private pendingJobs(all: Requirement[], langs: string[]): { requirement: Requirement; lang: string }[] {
    const shown = filterRequirements(all, this.filter, langs)
    const jobs: { requirement: Requirement; lang: string }[] = []
    for (const requirement of shown) {
      // Nothing to translate from: a requirement whose source was never written.
      if (!textOf(requirement, requirement.sourceLang)) continue
      for (const lang of langs) {
        if (lang === requirement.sourceLang) continue
        if (textOf(requirement, lang) === null || isStale(requirement, lang)) jobs.push({ requirement, lang })
      }
    }
    return jobs
  }

  /**
   * The whole shelf, with a way out.
   *
   * Asked first, because this is the one action here that leaves the vault: it sends the
   * text of every requirement in view to a service, and the reader has to agree to that
   * knowing how many. It ends on the review filter rather than on a tidy summary, because
   * what a run produces is not translations — it is drafts somebody now has to read.
   */
  private async runBulk(jobs: { requirement: Requirement; lang: string }[]): Promise<void> {
    const ok = await confirmDialog(this.app, t('req.bulkConfirm', { count: jobs.length }), t('common.continue'))
    if (!ok) return

    this.running = true
    this.stopRequested = false
    this.render()
    const notice = new Notice(t('req.bulkProgress', { done: 0, total: jobs.length }), 0)
    let outcomes: TranslationOutcome[] = []
    try {
      outcomes = await this.plugin.translator.translateMany(
        jobs,
        (progress) => notice.setMessage(t('req.bulkProgress', { done: progress.done, total: progress.total })),
        () => this.stopRequested
      )
    } finally {
      notice.hide()
      this.running = false
      this.stopRequested = false
    }

    const done = outcomes.filter((outcome) => outcome.ok).length
    const flagged = outcomes.filter((outcome) => outcome.drift).length
    const failed = outcomes.length - done
    new Notice(t('req.bulkDone', { done, flagged, failed }))
    // Landed on what now needs a person, rather than on the list they started from.
    if (done) this.filter = { ...this.filter, flag: 'unreviewed' }
    this.render()
  }

  private async createRequirement(): Promise<void> {
    const created = await this.plugin.requirements.create({ category: this.filter.category })
    if (created?.filePath) await openRequirementModal(this.plugin, created.filePath)
  }
}

function flagLabel(flag: ReqFlag): string {
  switch (flag) {
    case 'stale':
      return t('req.flag.stale')
    case 'unreviewed':
      return t('req.flag.unreviewed')
    case 'missing':
      return t('req.flag.missing')
    case 'suspect':
      return t('req.flag.suspect')
    case 'quality':
      return t('req.flag.quality')
    default:
      return t('common.all')
  }
}

function gapLabel(gap: CoverageGap): string {
  switch (gap) {
    case 'uncited':
      return t('req.gap.uncited')
    case 'unsatisfied':
      return t('req.gap.unsatisfied')
    case 'unverified':
      return t('req.gap.unverified')
    case 'suspect':
      return t('req.gap.suspect')
    default:
      return t('req.gap.unwritten')
  }
}

function gapIcon(gap: CoverageGap): string {
  switch (gap) {
    case 'uncited':
      return 'file-x'
    case 'unsatisfied':
      return 'unplug'
    case 'unverified':
      return 'check-check'
    case 'suspect':
      return 'unlink'
    default:
      return 'pencil-off'
  }
}

/** A note's name, since a full path in a table cell is mostly folders. */
function noteName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
}

function changeLabel(kind: BaselineChangeKind): string {
  switch (kind) {
    case 'added':
      return t('req.change.added')
    case 'removed':
      return t('req.change.removed')
    case 'changed':
      return t('req.change.changed')
    default:
      return t('req.change.unchanged')
  }
}

function changeIcon(kind: BaselineChangeKind): string {
  switch (kind) {
    case 'added':
      return 'plus'
    case 'removed':
      return 'minus'
    default:
      return 'pencil'
  }
}

function fieldLabel(field: 'status' | 'title'): string {
  return field === 'status' ? t('req.field.status') : t('req.field.wording')
}

/** The words, with what came and went marked in place. */
function renderDiff(host: HTMLElement, parts: DiffPart[]): void {
  for (const part of parts) {
    if (part.kind === 'same') host.createSpan({ text: part.text })
    else host.createSpan({ cls: `pm-req-diff-${part.kind}`, text: part.text })
  }
}

/** What the filters were, in words, for the record a baseline leaves behind. */
function describeFilter(filter: ReqFilterState): string {
  const bits: string[] = []
  if (filter.category) bits.push(`category: ${filter.category}`)
  if (filter.type) bits.push(`type: ${filter.type}`)
  if (filter.status) bits.push(`status: ${filter.status}`)
  if (filter.criticality) bits.push(`criticality: ${filter.criticality}`)
  if (filter.search.trim()) bits.push(`search: ${filter.search.trim()}`)
  if (filter.flag !== 'all') bits.push(`flag: ${filter.flag}`)
  return bits.join(' · ')
}
