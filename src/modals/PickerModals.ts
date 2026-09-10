import { SuggestModal, App, TFile } from 'obsidian'
import type { Task } from '../types'
import type { CollectionRef, ProjectRef } from '../store'
import { displayName } from '../utils'
import { renderGlyph } from '../ui/composites/properties'
import { t } from '../i18n'

/** Lists projects from the index, so picking one doesn't load every project in the vault. */
export class ProjectPickerModal extends SuggestModal<ProjectRef> {
  constructor(
    app: App,
    private projects: ProjectRef[],
    private onChoose: (project: ProjectRef) => void
  ) {
    super(app)
    this.setPlaceholder(t('picker.project'))
  }

  getSuggestions(query: string): ProjectRef[] {
    const q = query.toLowerCase()
    return this.projects.filter((p) => p.title.toLowerCase().includes(q))
  }

  renderSuggestion(project: ProjectRef, el: HTMLElement): void {
    const row = el.createSpan({ cls: 'pm-picker-suggestion' })
    renderGlyph(row, { icon: project.icon, color: project.color })
    row.createSpan({ text: project.title })
  }

  onChooseSuggestion(project: ProjectRef): void {
    this.onChoose(project)
  }
}

/** Lists collections from the index, which holds their whole definition. */
export class CollectionPickerModal extends SuggestModal<CollectionRef> {
  constructor(
    app: App,
    private collections: CollectionRef[],
    private onChoose: (collection: CollectionRef) => void
  ) {
    super(app)
    this.setPlaceholder(t('collection.pick'))
  }

  getSuggestions(query: string): CollectionRef[] {
    const q = query.toLowerCase()
    return this.collections.filter((c) => c.title.toLowerCase().includes(q))
  }

  renderSuggestion(collection: CollectionRef, el: HTMLElement): void {
    const row = el.createSpan({ cls: 'pm-picker-suggestion' })
    renderGlyph(row, { icon: collection.icon, color: collection.color })
    row.createSpan({ text: collection.title })
  }

  onChooseSuggestion(collection: CollectionRef): void {
    this.onChoose(collection)
  }
}

export class TaskPickerModal extends SuggestModal<Task> {
  constructor(
    app: App,
    private tasks: Task[],
    private onChoose: (task: Task) => void,
    placeholder = t('picker.parentTask')
  ) {
    super(app)
    this.setPlaceholder(placeholder)
  }

  getSuggestions(query: string): Task[] {
    const q = query.toLowerCase()
    return this.tasks.filter((t) => t.title.toLowerCase().includes(q))
  }

  renderSuggestion(task: Task, el: HTMLElement): void {
    el.createSpan({ text: task.title })
  }

  onChooseSuggestion(task: Task): void {
    this.onChoose(task)
  }
}

/** Lists the people already assigned somewhere, for the command that shows their tasks. */
export class PersonLookupModal extends SuggestModal<string> {
  constructor(
    app: App,
    private people: string[],
    private onChoose: (person: string) => void
  ) {
    super(app)
    this.setPlaceholder(t('picker.person'))
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase()
    return this.people.filter((person) => displayName(person).toLowerCase().includes(q))
  }

  renderSuggestion(person: string, el: HTMLElement): void {
    el.createSpan({ text: displayName(person) })
  }

  onChooseSuggestion(person: string): void {
    this.onChoose(person)
  }
}

/**
 * Every file in the vault that is not a note, newest first: what a document library
 * takes in is a PDF, a drawing, a spreadsheet — the markdown is the plugin's own.
 */
class VaultFilePickerModal extends SuggestModal<TFile> {
  constructor(
    app: App,
    placeholder: string,
    private onChoose: (file: TFile | null) => void
  ) {
    super(app)
    this.setPlaceholder(placeholder)
  }

  private files(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => file.extension !== 'md')
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase()
    return this.files().filter((file) => file.path.toLowerCase().includes(q))
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    const row = el.createDiv({ cls: 'pm-picker-suggestion' })
    row.createSpan({ text: file.name })
    row.createSpan({ cls: 'pm-picker-suggestion-path', text: file.parent?.path ?? '' })
  }

  onChooseSuggestion(file: TFile): void {
    this.onChoose(file)
  }

  onClose(): void {
    // Resolves the promise when the modal is dismissed without a choice.
    window.setTimeout(() => this.onChoose(null), 0)
  }
}

export function pickVaultFile(app: App, placeholder: string): Promise<TFile | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (file: TFile | null): void => {
      if (settled) return
      settled = true
      resolve(file)
    }
    new VaultFilePickerModal(app, placeholder, done).open()
  })
}

export interface PickerOption<T extends string> {
  id: T
  label: string
  icon?: string
}

class OptionPickerModal<T extends string> extends SuggestModal<PickerOption<T>> {
  constructor(
    app: App,
    placeholder: string,
    private options: PickerOption<T>[],
    private onChoose: (option: PickerOption<T> | null) => void
  ) {
    super(app)
    this.setPlaceholder(placeholder)
  }

  getSuggestions(): PickerOption<T>[] {
    return this.options
  }

  renderSuggestion(option: PickerOption<T>, el: HTMLElement): void {
    const row = el.createDiv({ cls: 'pm-picker-suggestion' })
    if (option.icon) renderGlyph(row, { icon: option.icon })
    row.createSpan({ text: option.label })
  }

  onChooseSuggestion(option: PickerOption<T>): void {
    this.onChoose(option)
  }

  onClose(): void {
    window.setTimeout(() => this.onChoose(null), 0)
  }
}

/** A short list of named choices, when a menu would be the wrong shape for it. */
export function pickOption<T extends string>(
  app: App,
  placeholder: string,
  options: PickerOption<T>[]
): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (option: PickerOption<T> | null): void => {
      if (settled) return
      settled = true
      resolve(option?.id ?? null)
    }
    new OptionPickerModal<T>(app, placeholder, options, done).open()
  })
}
