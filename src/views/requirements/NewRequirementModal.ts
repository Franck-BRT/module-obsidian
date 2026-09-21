import { App, ButtonComponent, ExtraButtonComponent, Modal, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import { allocateReqId, schemeOf } from '../../store/requirements/RequirementStore'
import { idCategory, knownCategories, reqFileName } from '../../store/requirements/reqId'
import { Chip } from '../../ui/primitives/Chip'
import { renderPropRow } from '../../ui/FormField'
import { t } from '../../i18n'

export interface NewRequirementDraft {
  category: string
  title: string
}

/**
 * What a requirement needs before it exists: its category, and what to call it.
 *
 * Both are asked here rather than filled in afterwards because both end up in the note's
 * name. The category is in the identifier, and an identifier is minted once and never
 * changed — a requirement created without one is REQ-GEN-0001 for the rest of its life,
 * and the only way out is renaming the note by hand, which is exactly the thing this
 * library exists to stop people doing. The title is asked for the smaller reason that
 * typing it later renames the note, and a rename is a path every open document has to be
 * told about.
 *
 * The file that will be written is shown as it will be written. Nothing is created until
 * the button is pressed, so the identifier on screen is a prediction — a true one, since
 * nothing else hands out numbers, but it is worth knowing that it is one.
 */
export class NewRequirementModal extends Modal {
  private draft: NewRequirementDraft
  private catInput!: HTMLInputElement
  private pathHint!: HTMLElement
  private idHint!: HTMLElement

  constructor(
    app: App,
    private plugin: PMPlugin,
    /** Preset from the category the library is filtered on: usually the one being worked in. */
    category: string,
    private onSubmit: (draft: NewRequirementDraft) => void
  ) {
    super(app)
    this.draft = { category: category.trim(), title: '' }
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('pm-te-modal', 'pm-te-surface')
    this.modalEl.addClass('pm-modal', 'pm-modal--create')

    this.renderHeader(contentEl)
    const body = contentEl.createDiv('pm-te-body')
    this.renderTitle(body)
    const grid = body.createDiv('pm-te-props').createDiv('pm-prop-grid')
    this.renderCategory(grid)
    this.renderFooter(contentEl)

    this.scope.register([], 'Enter', () => {
      this.submit()
      return false
    })
    this.refresh()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private renderHeader(parent: HTMLElement): void {
    const header = parent.createDiv('pm-te-header')
    const crumb = header.createDiv('pm-te-crumb')
    setIcon(crumb.createSpan({ cls: 'pm-te-crumb-icon' }), 'folder')
    crumb.createSpan({ cls: 'pm-te-crumb-name', text: this.plugin.settings.requirements.folder })
    setIcon(crumb.createSpan({ cls: 'pm-te-crumb-sep' }), 'chevron-right')
    crumb.createSpan({ text: t('req.new') })

    header.createDiv('pm-te-header-spacer')
    const close = new ExtraButtonComponent(header).setIcon('x').setTooltip(t('common.close'))
    close.extraSettingsEl.addClass('pm-te-header-btn')
    close.onClick(() => this.close())
  }

  private renderTitle(parent: HTMLElement): void {
    const wrap = parent.createDiv('pm-te-title-wrap')
    const input = wrap.createEl('input', { type: 'text', cls: 'pm-te-title' })
    input.placeholder = t('req.titlePlaceholder')
    input.spellcheck = false
    input.addEventListener('input', () => {
      this.draft.title = input.value
      this.refresh()
    })
    window.setTimeout(() => input.focus(), 0)
  }

  /**
   * A field rather than a list, with the list beside it.
   *
   * Every category this library numbers under is one click away, because a category
   * typed a second way is a second family of identifiers. A new one is still typed by
   * hand, though: the first requirement of a category has to come from somewhere.
   */
  private renderCategory(parent: HTMLElement): void {
    renderPropRow(
      parent,
      t('req.field.category'),
      () => {
        const host = createDiv('pm-prop-value pm-req-newcat')
        this.catInput = host.createEl('input', { type: 'text', cls: 'pm-prop-input' })
        this.catInput.value = this.draft.category
        this.catInput.placeholder = t('req.categoryPlaceholder')
        this.catInput.addEventListener('input', () => {
          this.draft.category = this.catInput.value
          this.refresh()
        })
        const known = knownCategories(
          schemeOf(this.plugin.settings.requirements),
          this.plugin.index.requirementIds(),
          this.plugin.settings.requirements.counters
        )
        if (known.length) {
          const chips = host.createDiv('pm-req-newcat-chips')
          for (const category of known) {
            new Chip(chips)
              .setLabel(category)
              .setVariant('outline')
              .onClick(() => {
                this.draft.category = category
                this.catInput.value = category
                this.refresh()
              })
          }
        }
        return host
      },
      'folder-tree'
    )
  }

  private renderFooter(parent: HTMLElement): void {
    const footer = parent.createDiv('pm-te-footer')
    this.idHint = footer.createSpan({ cls: 'pm-req-id' })
    this.pathHint = footer.createSpan({ cls: 'pm-te-footer-path' })
    setIcon(this.pathHint.createSpan({ cls: 'pm-te-footer-icon' }), 'file-text')
    this.pathHint.createSpan()

    footer.createDiv('pm-footer-spacer')
    new ButtonComponent(footer).setButtonText(t('dialog.cancel')).onClick(() => this.close())
    new ButtonComponent(footer)
      .setButtonText(t('req.create'))
      .setCta()
      .onClick(() => this.submit())
  }

  /** The identifier this would mint, and the file it would write, as they would be. */
  private refresh(): void {
    const settings = this.plugin.settings.requirements
    const { id } = allocateReqId(
      schemeOf(settings),
      this.draft.category,
      this.plugin.index.requirementIds(),
      settings.counters
    )
    this.idHint.setText(id)
    const folder = settings.folder.trim().replace(/\/+$/, '')
    this.pathHint.lastElementChild?.setText(`${folder ? folder + '/' : ''}${reqFileName(id, this.draft.title)}.md`)
  }

  private submit(): void {
    this.close()
    this.onSubmit({ ...this.draft, category: idCategory(this.draft.category) })
  }
}
