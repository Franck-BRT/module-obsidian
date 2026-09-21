import { App, ButtonComponent, ExtraButtonComponent, Modal, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { ReqLinkKind, Requirement } from '../../store/requirements/Requirement'
import { DERIVE_KINDS } from '../../store/requirements/reqDerive'
import { idCategory, knownCategories } from '../../store/requirements/reqId'
import { schemeOf } from '../../store/requirements/RequirementStore'
import { Chip } from '../../ui/primitives/Chip'
import { renderPropRow } from '../../ui/FormField'
import { renderSelectControl } from '../../ui/composites/properties'
import { t } from '../../i18n'
import { reqLinkKindLabel } from './reqPalette'

export interface DeriveManyChoice {
  /** Empty means each requirement keeps its own, which is what a breakdown usually wants. */
  category: string
  kind: ReqLinkKind
}

/**
 * Deriving a whole selection at once.
 *
 * The everyday case is a project taking the twelve system requirements it is answerable
 * for and starting twelve of its own from them. One at a time, that is twelve trips
 * through a form; the thing being decided is the same twelve times over.
 *
 * What it does not ask for is a title: each new requirement keeps the title of the one it
 * came from, because a form cannot name twelve requirements and a single name for all of
 * them would be worse than the one they already have.
 */
export class DeriveManyModal extends Modal {
  private choice: DeriveManyChoice = { category: '', kind: DERIVE_KINDS[0] }
  private catInput!: HTMLInputElement

  constructor(
    app: App,
    private plugin: PMPlugin,
    private sources: Requirement[],
    private onSubmit: (choice: DeriveManyChoice) => void
  ) {
    super(app)
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('pm-te-modal', 'pm-te-surface')
    this.modalEl.addClass('pm-modal', 'pm-modal--create')

    const header = contentEl.createDiv('pm-te-header')
    const crumb = header.createDiv('pm-te-crumb')
    setIcon(crumb.createSpan({ cls: 'pm-te-crumb-icon' }), 'git-branch-plus')
    crumb.createSpan({ text: t('req.deriveManyTitle', { count: this.sources.length }) })
    header.createDiv('pm-te-header-spacer')
    const close = new ExtraButtonComponent(header).setIcon('x').setTooltip(t('common.close'))
    close.extraSettingsEl.addClass('pm-te-header-btn')
    close.onClick(() => this.close())

    const body = contentEl.createDiv('pm-te-body')
    // Named, not counted: twelve is a number, and a reader about to write twelve notes is
    // entitled to see which twelve.
    body.createDiv('pm-req-derive-sources').setText(this.sources.map((requirement) => requirement.id).join(', '))

    const grid = body.createDiv('pm-te-props').createDiv('pm-prop-grid')
    this.renderCategory(grid)
    this.renderKind(grid)

    const footer = contentEl.createDiv('pm-te-footer')
    footer.createDiv('pm-footer-spacer')
    new ButtonComponent(footer).setButtonText(t('dialog.cancel')).onClick(() => this.close())
    new ButtonComponent(footer)
      .setButtonText(t('req.derive'))
      .setCta()
      .onClick(() => {
        this.close()
        this.onSubmit({ ...this.choice, category: this.choice.category.trim() ? idCategory(this.choice.category) : '' })
      })
  }

  onClose(): void {
    this.contentEl.empty()
  }

  /**
   * One category for all of them, or each keeping its own.
   *
   * Left empty on purpose by default: a breakdown of SYS requirements into SYS ones is
   * the common case, and filing twelve requirements under one category because the form
   * asked for one would be the form deciding something nobody asked it to.
   */
  private renderCategory(parent: HTMLElement): void {
    renderPropRow(
      parent,
      t('req.field.category'),
      () => {
        const host = createDiv('pm-prop-value pm-req-newcat')
        this.catInput = host.createEl('input', { type: 'text', cls: 'pm-prop-input' })
        this.catInput.placeholder = t('req.deriveCategoryKeep')
        this.catInput.addEventListener('input', () => {
          this.choice.category = this.catInput.value
        })
        const known = knownCategories(
          schemeOf(this.plugin.settings.requirements),
          this.plugin.index.requirementIds(),
          this.plugin.settings.requirements.counters
        )
        if (!known.length) return host
        const chips = host.createDiv('pm-req-newcat-chips')
        for (const category of known) {
          new Chip(chips)
            .setLabel(category)
            .setVariant('outline')
            .onClick(() => {
              this.choice.category = category
              this.catInput.value = category
            })
        }
        return host
      },
      'folder-tree'
    )
  }

  private renderKind(parent: HTMLElement): void {
    renderPropRow(
      parent,
      t('req.linkKind'),
      () => {
        const host = createDiv('pm-prop-value')
        renderSelectControl({
          container: host,
          value: this.choice.kind,
          options: DERIVE_KINDS.map((kind) => ({ id: kind, label: reqLinkKindLabel(kind) })),
          onChange: (kind) => {
            this.choice.kind = kind as ReqLinkKind
          }
        })
        return host
      },
      'link'
    )
  }
}
