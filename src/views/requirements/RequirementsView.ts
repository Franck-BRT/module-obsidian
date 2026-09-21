import { ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../../main'
import type { Requirement } from '../../store/requirements/Requirement'
import type { TranslationOutcome } from '../../store/requirements/RequirementTranslator'
import {
  displayText,
  isStale,
  isUnreviewedMachine,
  missingLanguages,
  textOf
} from '../../store/requirements/Requirement'
import { EmptyState } from '../../ui/primitives/EmptyState'
import { ChipButton } from '../../ui/primitives/ChipButton'
import { Chip } from '../../ui/primitives/Chip'
import { renderSelectControl } from '../../ui/composites/properties'
import { confirmDialog } from '../../ui/ModalFactory'
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

const FLAGS: ReqFlag[] = ['stale', 'unreviewed', 'missing', 'suspect']

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

    const shown = sortRequirements(filterRequirements(all, this.filter, langs), this.sortKey, this.sortDir, this.lang)
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

    const right = bar.createDiv('pm-req-toolbar-right')
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
    const all = this.plugin.index.requirementRefs()
    const langs = reqLanguages(this.plugin.settings)
    this.bodyEl.empty()
    const shown = sortRequirements(filterRequirements(all, this.filter, langs), this.sortKey, this.sortDir, this.lang)
    if (!shown.length) {
      new EmptyState(this.bodyEl).setIcon('🔍').setTitle(t('req.noneHere')).setBody(t('req.noneHereHint'))
      return
    }
    this.renderTable(this.bodyEl, shown, langs)
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
    default:
      return t('common.all')
  }
}
