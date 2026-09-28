import { Modal, Setting, type App } from 'obsidian'
import { cleanTags, type Classification } from '../../store/library/libraryClass'
import { t } from '../../i18n'

/**
 * The four fields a document is filed by — category, lot, issuer, tags — each offering
 * what the library already holds, so « Lot 2 » is not typed « lot2 » the next time.
 */

export interface ClassifyChoices {
  categories: string[]
  lots: string[]
  issuers: string[]
  tags: string[]
}

export interface ClassifyInitial {
  category: string
  lot: string
  issuer: string
  tags: string[]
}

/** How an empty category reads: guessed from each name when pouring, left as it is when filing many. */
export type EmptyCategory = 'guess' | 'keep' | 'none'

/** Chosen when filing many: each document without a category gets the one its name suggests. */
export const GUESS_CATEGORY = ':guess'

let lists = 0

/** A text field with the values it can take offered under it. */
function suggested(
  setting: Setting,
  value: string,
  options: string[],
  placeholder: string,
  onChange: (value: string) => void
): void {
  setting.addText((text) => {
    text.setPlaceholder(placeholder).setValue(value).onChange(onChange)
    if (!options.length) return
    const id = `pm-docs-list-${++lists}`
    const list = setting.controlEl.createEl('datalist', { attr: { id } })
    for (const option of options) list.createEl('option', { value: option })
    text.inputEl.setAttr('list', id)
  })
}

/** Draws the fields under `parent`; the function it returns reads them. */
export function renderClassifyFields(
  parent: HTMLElement,
  choices: ClassifyChoices,
  initial: ClassifyInitial,
  empty: EmptyCategory
): () => Classification {
  const value = { ...initial, tags: initial.tags.join(', ') }
  parent.createDiv({ cls: 'pm-docs-classify-head', text: t('library.classifyLabel') })

  new Setting(parent).setName(t('library.category')).addDropdown((dropdown) => {
    dropdown.addOption('', t(`library.categoryEmpty.${empty}`))
    if (empty === 'keep') dropdown.addOption(GUESS_CATEGORY, t('library.categoryGuessMissing'))
    const names = [...choices.categories]
    // A category no longer in the list is still shown, not silently dropped.
    if (initial.category && !names.includes(initial.category)) names.push(initial.category)
    for (const name of names) dropdown.addOption(name, name)
    dropdown.setValue(initial.category).onChange((chosen) => {
      value.category = chosen
    })
  })
  suggested(
    new Setting(parent).setName(t('library.lot')),
    value.lot,
    choices.lots,
    t('library.lotPlaceholder'),
    (text) => {
      value.lot = text
    }
  )
  suggested(
    new Setting(parent).setName(t('library.issuer')),
    value.issuer,
    choices.issuers,
    t('library.issuerPlaceholder'),
    (text) => {
      value.issuer = text
    }
  )
  const tags = new Setting(parent)
    .setName(t('library.tags'))
    .setDesc(
      choices.tags.length
        ? t('library.tagsKnown', { list: choices.tags.slice(0, 12).join(', ') })
        : t('library.tagsDesc')
    )
  tags.addText((text) =>
    text
      .setPlaceholder(t('library.tagsPlaceholder'))
      .setValue(value.tags)
      .onChange((typed) => {
        value.tags = typed
      })
  )
  return () => ({
    category: value.category,
    lot: value.lot.trim(),
    issuer: value.issuer.trim(),
    tags: cleanTags(value.tags)
  })
}

/**
 * Files one document, its fields as they are to be edited, or several at once, where a
 * field left empty leaves each document's own alone and tags are added.
 */
export function askClassification(
  app: App,
  heading: string,
  choices: ClassifyChoices,
  initial: ClassifyInitial,
  many: boolean
): Promise<Classification | null> {
  return new Promise((resolve) => new ClassifyModal(app, heading, choices, initial, many, resolve).open())
}

class ClassifyModal extends Modal {
  private done = false

  constructor(
    app: App,
    private heading: string,
    private choices: ClassifyChoices,
    private initial: ClassifyInitial,
    private many: boolean,
    private resolve: (value: Classification | null) => void
  ) {
    super(app)
  }

  onOpen(): void {
    this.setTitle(this.heading)
    this.modalEl.addClass('pm-docs-classify')
    if (this.many) this.contentEl.createEl('p', { cls: 'pm-docs-classify-note', text: t('library.classifyMany') })
    const read = renderClassifyFields(this.contentEl, this.choices, this.initial, this.many ? 'keep' : 'none')
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(t('library.save'))
          .setCta()
          .onClick(() => {
            this.done = true
            this.resolve(read())
            this.close()
          })
      )
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.done) this.resolve(null)
  }
}
