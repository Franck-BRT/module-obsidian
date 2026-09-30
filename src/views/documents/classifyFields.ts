import { Modal, Setting, setIcon, type App } from 'obsidian'
import { cleanTags, type Classification } from '../../store/library/libraryClass'
import { fold } from '../../store/library/libraryDoc'
import { renderMultiSelect } from '../../ui/composites/properties/MultiSelectControl'
import { renderOptionRow } from '../../ui/composites/properties/optionList'
import { Popover } from '../../ui/primitives/Popover'
import { t } from '../../i18n'

/**
 * The four fields a document is filed by — category, lot, issuer, tags — each picked in
 * what the library already holds, a new value added on purpose, so « Lot 2 » is not typed
 * « lot2 » the next time.
 */

export interface ClassifyChoices {
  categories: string[]
  lots: string[]
  issuers: string[]
  tags: string[]
  /** The lots of these projects, and those the library files under them. */
  lotsFor?: (projects: string[]) => string[]
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

/** The fields, drawn: what they say, and the projects the lot is picked among. */
export interface ClassifyForm {
  read(): Classification
  /** The projects the documents go to: the lot is asked only when there are some, among theirs. */
  setProjects(projects: string[]): void
}

/** Two spellings of one value: case and accents aside. */
function same(a: string, b: string): boolean {
  return fold(a.trim()) === fold(b.trim())
}

/** A list without the same value twice, whatever its case and accents. */
export function distinct(values: string[]): string[] {
  const out: string[] = []
  for (const value of values.map((one) => one.trim()).filter(Boolean)) {
    if (!out.some((kept) => same(kept, value))) out.push(value)
  }
  return out
}

interface PickOpts {
  container: HTMLElement
  value: () => string
  /** The values to pick among, by label; an empty id for the row that clears it. */
  options: () => { id: string; label: string }[]
  placeholder: string
  search: string
  /** The row that adds what was typed, when it is none of the options. */
  createLabel: (name: string) => string
  onChange: (value: string) => void
}

/**
 * One value picked in a list that a few letters narrow down, with the row that adds what
 * was typed when nothing in it is that — the same word written otherwise is found, not
 * added again. Returns the way to draw it again.
 */
function renderPick(opts: PickOpts): () => void {
  const trigger = opts.container.createEl('button', { cls: 'pm-prop-inline pm-docs-pick' })
  const draw = (): void => {
    trigger.empty()
    const value = opts.value()
    const shown = opts.options().find((option) => option.id === value)?.label ?? value
    trigger.toggleClass('pm-prop-inline--empty', !value)
    trigger.createSpan({ cls: 'pm-prop-inline-label', text: shown || opts.placeholder })
    setIcon(trigger.createSpan({ cls: 'pm-prop-chevron' }), 'chevron-down')
  }
  draw()
  let pop: Popover | null = null
  trigger.addEventListener('click', () => {
    if (pop?.isOpen) {
      pop.close()
      return
    }
    const popover = new Popover({
      anchor: trigger,
      width: Math.max(240, trigger.offsetWidth),
      onClose: () => (pop = null)
    })
    pop = popover
    const input = popover.contentEl.createEl('input', {
      cls: 'pm-pop-field',
      attr: { placeholder: opts.search, spellcheck: 'false' }
    })
    const list = popover.contentEl.createDiv('pm-pop-list')
    const pick = (value: string): void => {
      popover.close()
      opts.onChange(value)
      draw()
    }
    const renderList = (): void => {
      list.empty()
      const typed = input.value.trim()
      const words = fold(typed).split(/\s+/).filter(Boolean)
      const options = opts.options()
      for (const option of options) {
        if (option.id && !words.every((word) => fold(option.label).includes(word))) continue
        renderOptionRow(list, {
          label: option.label,
          selected: option.id === opts.value(),
          onPick: () => pick(option.id)
        })
      }
      if (typed && !options.some((option) => option.id && same(option.label, typed))) {
        renderOptionRow(list, { label: opts.createLabel(typed), icon: 'plus', accent: true, onPick: () => pick(typed) })
      }
    }
    input.addEventListener('input', renderList)
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      const typed = input.value.trim()
      if (!typed) return
      // The one it names already, else a new one.
      const found = opts.options().find((option) => option.id && same(option.label, typed))
      pick(found ? found.id : typed)
    })
    renderList()
    popover.open()
    input.focus()
  })
  return draw
}

/**
 * Draws the fields under `parent`. `projects` are those the documents go to — the lot is
 * then asked only when there are some, and picked among theirs —, null when the lot is
 * always asked, among every lot the library knows.
 */
export function renderClassifyFields(
  parent: HTMLElement,
  choices: ClassifyChoices,
  initial: ClassifyInitial,
  empty: EmptyCategory,
  projects: string[] | null = null
): ClassifyForm {
  const value = { ...initial, tags: [...initial.tags] }
  // What is added here is offered again at once, in this window.
  const categories = distinct([...choices.categories, initial.category])
  const issuers = distinct([...choices.issuers, initial.issuer])
  const tags = distinct([...choices.tags, ...initial.tags])
  let scope = projects
  parent.createDiv({ cls: 'pm-docs-classify-head', text: t('library.classifyLabel') })

  const categoryRow = new Setting(parent).setName(t('library.category'))
  renderPick({
    container: categoryRow.controlEl,
    value: () => value.category,
    options: () => [
      { id: '', label: t(`library.categoryEmpty.${empty}`) },
      ...(empty === 'keep' ? [{ id: GUESS_CATEGORY, label: t('library.categoryGuessMissing') }] : []),
      ...categories.map((name) => ({ id: name, label: name }))
    ],
    placeholder: t(`library.categoryEmpty.${empty}`),
    search: t('library.categorySearch'),
    createLabel: (name) => t('library.addCategory', { name }),
    onChange: (chosen) => {
      if (chosen && chosen !== GUESS_CATEGORY && !categories.some((name) => same(name, chosen))) categories.push(chosen)
      value.category = chosen
    }
  })

  const lotRow = new Setting(parent).setName(t('library.lot'))
  const lots = (): string[] =>
    distinct([...(scope && choices.lotsFor ? choices.lotsFor(scope) : choices.lots), value.lot])
  const drawLot = renderPick({
    container: lotRow.controlEl,
    value: () => value.lot,
    options: () => [{ id: '', label: t('library.noLot') }, ...lots().map((name) => ({ id: name, label: name }))],
    placeholder: t('library.lotPick'),
    search: t('library.lotPlaceholder'),
    createLabel: (name) => t('library.addLot', { name }),
    onChange: (chosen) => {
      value.lot = chosen
    }
  })
  const showLot = (): void => {
    lotRow.settingEl.toggle(scope === null || scope.length > 0)
    drawLot()
  }
  showLot()

  const issuerRow = new Setting(parent).setName(t('library.issuer'))
  renderPick({
    container: issuerRow.controlEl,
    value: () => value.issuer,
    options: () => [{ id: '', label: t('library.noIssuer') }, ...issuers.map((name) => ({ id: name, label: name }))],
    placeholder: t('library.issuerPick'),
    search: t('library.issuerPlaceholder'),
    createLabel: (name) => t('library.addIssuer', { name }),
    onChange: (chosen) => {
      if (chosen && !issuers.some((name) => same(name, chosen))) issuers.push(chosen)
      value.issuer = chosen
    }
  })

  const tagRow = new Setting(parent).setName(t('library.tags')).setDesc(t('library.tagsDesc'))
  tagRow.settingEl.addClass('pm-docs-classify-tags')
  renderMultiSelect({
    container: tagRow.controlEl,
    selected: () => value.tags,
    options: () => tags.map((tag) => ({ id: tag, label: tag })),
    add: (tag) => {
      if (!value.tags.includes(tag)) value.tags.push(tag)
    },
    remove: (tag) => {
      value.tags = value.tags.filter((one) => one !== tag)
    },
    addLabel: t('library.addTag'),
    search: true,
    placeholder: t('library.tagsPlaceholder'),
    create: (typed) => {
      for (const tag of cleanTags(typed)) {
        const known = tags.find((one) => same(one, tag))
        if (!known) tags.push(tag)
        const chosen = known ?? tag
        if (!value.tags.includes(chosen)) value.tags.push(chosen)
      }
    },
    createLabel: (name) => t('library.newTag', { name }),
    tag: true
  })

  return {
    read: () => ({
      category: value.category,
      // Asked only with projects to pick among: none, and there is no lot.
      lot: scope !== null && !scope.length ? '' : value.lot.trim(),
      issuer: value.issuer.trim(),
      tags: cleanTags(value.tags)
    }),
    setProjects: (paths) => {
      scope = paths
      showLot()
    }
  }
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
  many: boolean,
  projects: string[] | null = null
): Promise<Classification | null> {
  return new Promise((resolve) => new ClassifyModal(app, heading, choices, initial, many, projects, resolve).open())
}

class ClassifyModal extends Modal {
  private done = false

  constructor(
    app: App,
    private heading: string,
    private choices: ClassifyChoices,
    private initial: ClassifyInitial,
    private many: boolean,
    private projects: string[] | null,
    private resolve: (value: Classification | null) => void
  ) {
    super(app)
  }

  onOpen(): void {
    this.setTitle(this.heading)
    this.modalEl.addClass('pm-docs-classify')
    if (this.many) this.contentEl.createEl('p', { cls: 'pm-docs-classify-note', text: t('library.classifyMany') })
    const form = renderClassifyFields(
      this.contentEl,
      this.choices,
      this.initial,
      this.many ? 'keep' : 'none',
      this.projects
    )
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(t('library.save'))
          .setCta()
          .onClick(() => {
            this.done = true
            this.resolve(form.read())
            this.close()
          })
      )
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.done) this.resolve(null)
  }
}
