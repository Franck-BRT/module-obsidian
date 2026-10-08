import { ItemView, Menu, Notice, setIcon, TFile, type WorkspaceLeaf } from 'obsidian'
import type PMPlugin from '../../main'
import { groupPersonas, matchesPersona, personaCategories, type PersonaNote } from '../../store/chat/personaLibrary'
import { fold } from '../../store/library/libraryDoc'
import { confirmDialog } from '../../ui/ModalFactory'
import { explain } from '../../ui/explain'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'
import { PersonaModal, type PersonaEdit } from './PersonaModal'
import { allPersonas, createPersona, updatePersona } from './personaVault'
import { starterPersonas } from './starterPersonas'

export const PM_PERSONAS_VIEW_TYPE = 'pm-personas'

/**
 * The persona library: the roles the chat answers in — a site manager, a lawyer, an
 * inspector —, by category, each to take to the chat at once, to change, to mark as a
 * favourite; and, to start from, a few the plugin offers.
 */
export class PersonasView extends ItemView {
  private personas: PersonaNote[] = []
  private search = ''
  private category = ''
  private bodyEl!: HTMLElement
  private categoryEl!: HTMLSelectElement
  private redrawTimer: number | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PMPlugin
  ) {
    super(leaf)
  }

  getViewType(): string {
    return PM_PERSONAS_VIEW_TYPE
  }

  getDisplayText(): string {
    return t('personas.title')
  }

  getIcon(): string {
    return 'drama'
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass('pm-view')
    const root = this.contentEl
    root.empty()
    root.addClass('pm-root', 'pm-prompts', 'pm-personas')
    this.buildHead(root)
    this.bodyEl = root.createDiv('pm-prompts-body')
    // A persona written, changed, moved or thrown away, here or in its note: drawn again.
    const later = (): void => this.reloadSoon()
    this.registerEvent(this.app.metadataCache.on('changed', later))
    this.registerEvent(this.app.vault.on('delete', later))
    this.registerEvent(this.app.vault.on('rename', later))
    await this.reload()
  }

  onClose(): Promise<void> {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    return Promise.resolve()
  }

  private reloadSoon(): void {
    if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer)
    this.redrawTimer = window.setTimeout(
      safeAsync(async () => {
        this.redrawTimer = null
        await this.reload()
      }),
      300
    )
  }

  private async reload(): Promise<void> {
    this.personas = await allPersonas(this.app)
    this.renderCategories()
    this.renderBody()
  }

  private buildHead(root: HTMLElement): void {
    const head = root.createDiv('pm-prompts-head')
    const title = head.createDiv('pm-prompts-title')
    setIcon(title.createSpan('pm-prompts-title-icon'), 'drama')
    title.createEl('h2', { text: t('personas.title') })
    head.createDiv({ cls: 'pm-prompts-intro', text: t('personas.intro') })
    const bar = head.createDiv('pm-prompts-bar')
    const search = bar.createEl('input', {
      cls: 'pm-prompts-search',
      attr: { type: 'search', placeholder: t('personas.search') }
    })
    search.addEventListener('input', () => {
      this.search = search.value
      this.renderBody()
    })
    this.categoryEl = bar.createEl('select', { cls: 'dropdown pm-prompts-category' })
    this.categoryEl.addEventListener('change', () => {
      this.category = this.categoryEl.value
      this.renderBody()
    })
    const add = bar.createEl('button', { cls: 'mod-cta' })
    setIcon(add.createSpan('pm-prompts-button-icon'), 'plus')
    add.createSpan({ text: t('personas.new') })
    add.addEventListener('click', () => this.edit())
  }

  private renderCategories(): void {
    const select = this.categoryEl
    select.empty()
    select.createEl('option', { text: t('personas.allCategories'), attr: { value: '' } })
    const categories = personaCategories(this.personas)
    for (const category of categories) select.createEl('option', { text: category, attr: { value: category } })
    if (this.category && !categories.some((one) => fold(one) === fold(this.category))) this.category = ''
    select.value = this.category
  }

  private renderBody(): void {
    const body = this.bodyEl
    body.empty()
    const shown = this.personas.filter(
      (persona) =>
        matchesPersona(persona, this.search) && (!this.category || fold(persona.category) === fold(this.category))
    )
    if (!this.personas.length) {
      const empty = body.createDiv('pm-prompts-empty')
      setIcon(empty.createDiv('pm-prompts-empty-icon'), 'drama')
      empty.createDiv({ cls: 'pm-prompts-empty-title', text: t('personas.emptyTitle') })
      empty.createDiv({ cls: 'pm-prompts-empty-text', text: t('personas.emptyText') })
      const starters = empty.createEl('button', { cls: 'mod-cta', text: t('personas.addStarters') })
      explain(starters, t('personas.addStarters'), t('personas.addStartersHint'))
      starters.addEventListener(
        'click',
        safeAsync(() => this.addStarters())
      )
      return
    }
    if (!shown.length) body.createDiv({ cls: 'pm-prompts-none', text: t('personas.nothingFound') })
    const active = this.plugin.activePersona()
    for (const group of groupPersonas(shown)) {
      const section = body.createDiv('pm-prompts-section')
      section.createEl('h3', {
        cls: 'pm-prompts-section-title',
        text: group.category || t('personas.noCategory')
      })
      const grid = section.createDiv('pm-prompts-grid')
      for (const persona of group.personas) this.renderCard(grid, persona, persona.path === active)
    }
    // The plugin's own, those not yet in the library, a click away.
    const missing = this.missingStarters()
    if (missing.length && !this.search.trim() && !this.category) {
      const more = body.createEl('a', {
        cls: 'pm-personas-starters',
        href: '#',
        text: t('personas.addMissingStarters', { count: missing.length })
      })
      more.addEventListener(
        'click',
        safeAsync(async (event: MouseEvent) => {
          event.preventDefault()
          await this.addStarters()
        })
      )
    }
  }

  private renderCard(grid: HTMLElement, persona: PersonaNote, active: boolean): void {
    const card = grid.createDiv(`pm-prompt-card${active ? ' is-active' : ''}`)
    const head = card.createDiv('pm-prompt-card-head')
    setIcon(head.createSpan('pm-prompt-card-icon'), 'drama')
    const name = head.createEl('a', { cls: 'pm-prompt-card-name', text: persona.name, href: '#' })
    name.addEventListener('click', (event) => {
      event.preventDefault()
      this.edit(persona)
    })
    const star = head.createEl('button', {
      cls: `clickable-icon pm-prompt-star${persona.favorite ? ' is-on' : ''}`,
      attr: { 'aria-label': persona.favorite ? t('personas.unfavorite') : t('personas.favorite') }
    })
    setIcon(star, 'star')
    explain(star, persona.favorite ? t('personas.unfavorite') : t('personas.favorite'), t('personas.favoriteHint'))
    star.addEventListener(
      'click',
      safeAsync(() => this.save(persona, { name: persona.name, draft: this.draftOf(persona, !persona.favorite) }))
    )
    if (active) {
      const meta = card.createDiv('pm-prompt-card-meta')
      meta.createSpan({ cls: 'pm-prompt-chip is-active', text: t('personas.inUse') })
    }
    card.createDiv({ cls: 'pm-prompt-card-text', text: persona.description || persona.instructions })
    const actions = card.createDiv('pm-prompt-card-actions')
    const use = actions.createEl('button', {
      cls: 'mod-cta',
      text: active ? t('personas.stop') : t('personas.use')
    })
    explain(
      use,
      active ? t('personas.stop') : t('personas.use'),
      active ? t('personas.stopHint') : t('personas.useHint')
    )
    use.addEventListener(
      'click',
      safeAsync(async () => {
        await this.plugin.usePersona(active ? null : persona.path)
        this.renderBody()
      })
    )
    const more = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': t('personas.more') } })
    setIcon(more, 'more-horizontal')
    more.addEventListener('click', (event) => {
      const menu = new Menu()
      menu.addItem((item) =>
        item
          .setTitle(t('personas.edit'))
          .setIcon('pencil')
          .onClick(() => this.edit(persona))
      )
      menu.addItem((item) =>
        item
          .setTitle(t('personas.openNote'))
          .setIcon('file-text')
          .onClick(
            safeAsync(async () => {
              const file = this.app.vault.getAbstractFileByPath(persona.path)
              if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file)
            })
          )
      )
      menu.addItem((item) =>
        item
          .setTitle(t('personas.duplicate'))
          .setIcon('copy')
          .onClick(() => this.duplicate(persona))
      )
      menu.addSeparator()
      menu.addItem((item) =>
        item
          .setTitle(t('personas.delete'))
          .setIcon('trash-2')
          .onClick(safeAsync(() => this.remove(persona)))
      )
      menu.showAtMouseEvent(event)
    })
  }

  private draftOf(persona: PersonaNote, favorite = persona.favorite): PersonaEdit['draft'] {
    return {
      category: persona.category,
      description: persona.description,
      favorite,
      instructions: persona.instructions
    }
  }

  private edit(persona?: PersonaNote): void {
    new PersonaModal(
      this.app,
      personaCategories(this.personas),
      (edit) => this.save(persona, edit),
      persona ??
        (this.category
          ? { name: '', instructions: '', category: this.category, description: '', favorite: false }
          : undefined),
      !!persona
    ).open()
  }

  private duplicate(persona: PersonaNote): void {
    new PersonaModal(this.app, personaCategories(this.personas), (edit) => this.save(undefined, edit), {
      ...persona,
      name: t('personas.copyName', { name: persona.name }),
      favorite: false
    }).open()
  }

  private async save(persona: PersonaNote | undefined, edit: PersonaEdit): Promise<void> {
    if (persona) {
      const path = await updatePersona(this.app, persona.path, edit.name, edit.draft)
      // Renamed while the chat speaks as it: the chat follows.
      const renamed = path !== persona.path && this.plugin.activePersona() === persona.path
      if (renamed) await this.plugin.usePersona(path, false)
    } else {
      await createPersona(this.app, this.folder(), edit.name, edit.draft)
      new Notice(t('personas.created', { name: edit.name }))
    }
    this.reloadSoon()
  }

  private async remove(persona: PersonaNote): Promise<void> {
    if (!(await confirmDialog(this.app, t('personas.deleteConfirm', { name: persona.name })))) return
    const file = this.app.vault.getAbstractFileByPath(persona.path)
    if (file instanceof TFile) await this.app.fileManager.trashFile(file)
    if (this.plugin.activePersona() === persona.path) await this.plugin.usePersona(null, false)
  }

  private folder(): string {
    return this.plugin.settings.chat.personasFolder.trim()
  }

  /** The plugin's personas the library has none of the name of. */
  private missingStarters(): ReturnType<typeof starterPersonas> {
    const known = new Set(this.personas.map((persona) => fold(persona.name)))
    return starterPersonas().filter((starter) => !known.has(fold(starter.name)))
  }

  private async addStarters(): Promise<void> {
    const missing = this.missingStarters()
    for (const starter of missing) await createPersona(this.app, this.folder(), starter.name, starter.draft)
    new Notice(t('personas.startersAdded', { count: missing.length }))
    this.reloadSoon()
  }
}
