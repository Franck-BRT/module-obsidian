import { Modal, Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import {
  collectionNames,
  nextCollections,
  FAMILY_ICONS,
  familyOf,
  fold,
  inCollection,
  matchesDoc,
  type LibraryDoc
} from '../../store/library/libraryDoc'
import { safeAsync } from '../../utils'
import { t } from '../../i18n'

/**
 * Collections of documents: sets of the library's documents gathered under a name — the
 * specifications of a lot, the standards of a trade, the documents of a consultation —
 * that a question to the chat can be held to. Kept in each document's record, as its tags
 * are, so they follow the document wherever it goes.
 */

/**
 * The collections one document or several are in, to change: each collection ticked when
 * all of them are in it, half when some are, and a new one made by its name.
 */
export class CollectionsModal extends Modal {
  private ticked = new Set<string>()
  private unticked = new Set<string>()
  private added: string[] = []

  constructor(
    private plugin: PMPlugin,
    private docs: LibraryDoc[],
    private onDone: () => void
  ) {
    super(plugin.app)
  }

  onOpen(): void {
    this.modalEl.addClass('pm-collections-modal')
    this.setTitle(
      this.docs.length === 1
        ? t('collection.docs.titleOne', { title: this.docs[0].title })
        : t('collection.docs.title', { count: this.docs.length })
    )
    this.render()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    root.createDiv({ cls: 'pm-collections-intro', text: t('collection.docs.intro') })
    const names = [...collectionNames(this.plugin.library.docs()), ...this.added]
    const list = root.createDiv('pm-collections-list')
    if (!names.length) list.createDiv({ cls: 'pm-collections-none', text: t('collection.docs.none') })
    for (const name of names) {
      const holding = this.docs.filter((doc) => inCollection(doc, name)).length
      const row = list.createEl('label', { cls: 'pm-collections-row' })
      const box = row.createEl('input', { attr: { type: 'checkbox' } })
      const on = this.ticked.has(name) || (!this.unticked.has(name) && holding === this.docs.length)
      box.checked = on
      box.indeterminate =
        !this.ticked.has(name) && !this.unticked.has(name) && holding > 0 && holding < this.docs.length
      setIcon(row.createSpan({ cls: 'pm-collections-icon' }), 'library')
      row.createSpan({ text: name })
      box.addEventListener('change', () => {
        if (box.checked) {
          this.ticked.add(name)
          this.unticked.delete(name)
        } else {
          this.unticked.add(name)
          this.ticked.delete(name)
        }
      })
    }
    const make = root.createDiv('pm-collections-new')
    const input = make.createEl('input', { attr: { type: 'text', placeholder: t('collection.docs.newPlaceholder') } })
    const add = make.createEl('button', { text: t('collection.docs.add') })
    const create = (): void => {
      const name = input.value.trim()
      if (!name) return
      if (![...names].some((one) => fold(one) === fold(name))) this.added.push(name)
      this.ticked.add(name)
      this.unticked.delete(name)
      this.render()
    }
    add.addEventListener('click', create)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        create()
      }
    })
    const foot = root.createDiv('pm-collections-foot')
    foot.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close())
    const save = foot.createEl('button', { cls: 'mod-cta', text: t('dialog.save') })
    save.addEventListener(
      'click',
      safeAsync(() => this.save())
    )
  }

  private async save(): Promise<void> {
    let changed = 0
    for (const doc of this.docs) {
      const next = nextCollections(doc, this.ticked, this.unticked)
      const before = doc.collections ?? []
      if (next.length === before.length && next.every((name, at) => name === before[at])) continue
      await this.plugin.library.setCollections(doc, next)
      changed++
    }
    this.close()
    if (changed) new Notice(t('collection.docs.saved', { count: changed }))
    this.onDone()
  }
}

/**
 * Documents of the library chosen by hand — searched by their words, ticked one by one —,
 * for a question to the chat to be held to them; the choice can be kept as a collection.
 */
export class DocPickModal extends Modal {
  private query = ''
  private chosen: Set<string>

  constructor(
    private plugin: PMPlugin,
    chosen: string[],
    private projectTitle: (path: string) => string,
    private onDone: (files: string[]) => void
  ) {
    super(plugin.app)
    this.chosen = new Set(chosen)
  }

  onOpen(): void {
    this.modalEl.addClass('pm-docpick-modal')
    this.setTitle(t('chat.scope.pickTitle'))
    const root = this.contentEl
    const search = root.createEl('input', {
      cls: 'pm-docpick-search',
      attr: { type: 'search', placeholder: t('library.search') }
    })
    const list = root.createDiv('pm-docpick-list')
    const count = root.createDiv('pm-docpick-count')
    const docs = this.plugin.library.docs().filter((doc) => doc.file)
    const draw = (): void => {
      list.empty()
      const shown = docs.filter((doc) =>
        matchesDoc(doc, { text: this.query, project: '', family: '' }, this.projectTitle, (each) =>
          this.plugin.libraryText.folded(each)
        )
      )
      for (const doc of shown.slice(0, 200)) {
        const row = list.createEl('label', { cls: 'pm-docpick-row' })
        const box = row.createEl('input', { attr: { type: 'checkbox' } })
        box.checked = this.chosen.has(doc.file)
        const family = familyOf(doc.file)
        setIcon(row.createSpan({ cls: `pm-docpick-icon pm-docs-icon--${family}` }), FAMILY_ICONS[family])
        row.createSpan({ cls: 'pm-docpick-title', text: doc.title })
        const detail = [...doc.projects.map(this.projectTitle), ...(doc.collections ?? [])].join(' · ')
        if (detail) row.createSpan({ cls: 'pm-docpick-detail', text: detail })
        box.addEventListener('change', () => {
          if (box.checked) this.chosen.add(doc.file)
          else this.chosen.delete(doc.file)
          count.setText(t('chat.scope.pickCount', { count: this.chosen.size }))
        })
      }
      if (shown.length > 200) {
        list.createDiv({ cls: 'pm-docpick-more', text: t('chat.scope.pickMore', { count: shown.length - 200 }) })
      }
      count.setText(t('chat.scope.pickCount', { count: this.chosen.size }))
    }
    search.addEventListener('input', () => {
      this.query = search.value
      draw()
    })
    draw()
    // The choice kept as a collection, to be held to again.
    const keep = root.createDiv('pm-docpick-keep')
    const name = keep.createEl('input', { attr: { type: 'text', placeholder: t('chat.scope.keepAs') } })
    const foot = root.createDiv('pm-collections-foot')
    foot.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close())
    const done = foot.createEl('button', { cls: 'mod-cta', text: t('chat.scope.pickDone') })
    done.addEventListener(
      'click',
      safeAsync(async () => {
        const files = [...this.chosen]
        const collection = name.value.trim()
        if (collection && files.length) {
          for (const doc of docs.filter((one) => this.chosen.has(one.file))) {
            await this.plugin.library.setCollections(doc, nextCollections(doc, new Set([collection]), new Set()))
          }
          new Notice(t('chat.scope.kept', { name: collection, count: files.length }))
        }
        this.close()
        this.onDone(files)
      })
    )
    window.setTimeout(() => search.focus(), 0)
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
