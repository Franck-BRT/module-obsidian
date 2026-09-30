import { Modal, Setting, setIcon, type App } from 'obsidian'
import { fold } from '../../store/library/libraryDoc'
import { t } from '../../i18n'
import type { Classification } from '../../store/library/libraryClass'
import { renderClassifyFields, type ClassifyChoices, type ClassifyForm } from './classifyFields'

/**
 * Which projects documents belong to: none, one or several, ticked in a list that a few
 * letters narrow down. Asked when documents are poured into the library, and again
 * whenever one of them is said to belong somewhere else.
 */

export interface ProjectOption {
  path: string
  title: string
  /** Where it is, to tell two projects of the same name apart. */
  detail: string
}

export interface ChooserRequest {
  heading: string
  /** The files being poured, named so the reader sees what they are deciding about. */
  names?: string[]
  projects: ProjectOption[]
  chosen: string[]
  /** Offered when some of the files are already in the vault. */
  offerMove?: boolean
  /** Asked too when documents are poured: how they are filed. */
  classify?: ClassifyChoices
  confirm: string
}

export interface ChooserAnswer {
  projects: string[]
  move: boolean
  classification?: Classification
}

export function chooseProjects(app: App, request: ChooserRequest): Promise<ChooserAnswer | null> {
  return new Promise((resolve) => new ProjectChooser(app, request, resolve).open())
}

/** How many of the files are named before the rest are counted. */
const NAMES_SHOWN = 6

class ProjectChooser extends Modal {
  private chosen: Set<string>
  private move = false
  private done = false
  private query = ''
  private listEl!: HTMLElement
  private countEl!: HTMLElement
  /** How the documents are filed, when asked: its lot among the projects ticked. */
  private form: ClassifyForm | null = null

  constructor(
    app: App,
    private request: ChooserRequest,
    private resolve: (answer: ChooserAnswer | null) => void
  ) {
    super(app)
    this.chosen = new Set(request.chosen)
  }

  onOpen(): void {
    const { request } = this
    this.setTitle(request.heading)
    this.modalEl.addClass('pm-docs-chooser')
    const names = request.names ?? []
    if (names.length) {
      const list = this.contentEl.createEl('ul', { cls: 'pm-docs-chooser-files' })
      for (const name of names.slice(0, NAMES_SHOWN)) list.createEl('li', { text: name })
      if (names.length > NAMES_SHOWN) {
        list.createEl('li', {
          cls: 'pm-docs-chooser-more',
          text: t('library.andMore', { count: names.length - NAMES_SHOWN })
        })
      }
    }

    const head = this.contentEl.createDiv('pm-docs-chooser-head')
    head.createSpan({ cls: 'pm-docs-chooser-label', text: t('library.projectsLabel') })
    this.countEl = head.createSpan({ cls: 'pm-docs-chooser-count' })
    const search = this.contentEl.createEl('input', {
      cls: 'pm-docs-chooser-search',
      attr: { type: 'search', placeholder: t('library.projectsFilter') }
    })
    search.addEventListener('input', () => {
      this.query = search.value
      this.renderList()
    })
    this.listEl = this.contentEl.createDiv('pm-docs-chooser-list')
    this.renderList()

    this.form = request.classify
      ? renderClassifyFields(
          this.contentEl.createDiv('pm-docs-chooser-classify'),
          request.classify,
          { category: '', lot: '', issuer: '', tags: [] },
          'guess',
          [...this.chosen]
        )
      : null

    if (request.offerMove) {
      new Setting(this.contentEl)
        .setName(t('library.moveIn'))
        .setDesc(t('library.moveInDesc'))
        .addToggle((toggle) =>
          toggle.setValue(this.move).onChange((value) => {
            this.move = value
          })
        )
    }

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(request.confirm)
          .setCta()
          .onClick(() => {
            this.done = true
            // In the order the list gives them, not the order they were ticked.
            const projects = request.projects.map((project) => project.path).filter((path) => this.chosen.has(path))
            this.resolve({
              projects,
              move: this.move,
              ...(this.form ? { classification: this.form.read() } : {})
            })
            this.close()
          })
      )
    window.setTimeout(() => search.focus(), 0)
  }

  private renderCount(): void {
    this.countEl.setText(
      this.chosen.size ? t('library.projectsChosen', { count: this.chosen.size }) : t('library.projectsNone')
    )
  }

  /** The projects the letters typed match, the ticked ones first. */
  private renderList(): void {
    this.listEl.empty()
    this.renderCount()
    const words = fold(this.query).split(/\s+/).filter(Boolean)
    const shown = this.request.projects
      .filter((project) => {
        const text = fold(`${project.title} ${project.detail}`)
        return words.every((word) => text.includes(word))
      })
      .sort((a, b) => Number(this.chosen.has(b.path)) - Number(this.chosen.has(a.path)))
    if (!shown.length) {
      this.listEl.createDiv({ cls: 'pm-docs-chooser-empty', text: t('library.projectsNoMatch') })
      return
    }
    for (const project of shown) {
      const row = this.listEl.createEl('label', { cls: 'pm-docs-chooser-row' })
      const box = row.createEl('input', { attr: { type: 'checkbox' } })
      box.checked = this.chosen.has(project.path)
      box.addEventListener('change', () => {
        if (box.checked) this.chosen.add(project.path)
        else this.chosen.delete(project.path)
        this.renderCount()
        this.form?.setProjects(this.request.projects.map((one) => one.path).filter((path) => this.chosen.has(path)))
      })
      setIcon(row.createSpan({ cls: 'pm-docs-chooser-icon' }), 'folder-kanban')
      row.createSpan({ cls: 'pm-docs-chooser-title', text: project.title })
      row.createSpan({ cls: 'pm-docs-chooser-detail', text: project.detail })
    }
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.done) this.resolve(null)
  }
}
