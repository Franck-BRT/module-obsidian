import { Modal, Notice, Setting, TFile, type App } from 'obsidian'
import type PMPlugin from '../../main'
import type { PourItem } from '../../store/library/DocLibrary'
import { registerFilesOutside, type RegisterFile } from '../../store/library/libraryRegister'
import type { Project } from '../../types'
import { today } from '../../dates'
import { t } from '../../i18n'

/**
 * The other way round: documents the projects' registers hold, poured into the library.
 *
 * Each is recorded where it lives — a register finds its files by their path, so none is
 * moved — under the register's title for it, with its project and issuer, its category
 * guessed. Current files by default; their earlier versions when asked.
 */

/** The projects whose registers are looked through: one, or all that keep one. */
async function registerProjects(plugin: PMPlugin, only?: string): Promise<Project[]> {
  const paths = only
    ? [only]
    : plugin.index
        .projectRefs()
        .filter((ref) => !ref.template && !ref.program)
        .map((ref) => ref.path)
  return plugin.store.loadProjects(paths)
}

/** The register files the library lacks that are still in the vault. */
export async function registerFilesToPour(
  plugin: PMPlugin,
  withVersions: boolean,
  only?: string
): Promise<RegisterFile[]> {
  const inLibrary = new Set(plugin.library.docs().map((doc) => doc.file))
  return registerFilesOutside(await registerProjects(plugin, only), inLibrary, withVersions).filter(
    (entry) => plugin.app.vault.getAbstractFileByPath(entry.file) instanceof TFile
  )
}

/** Asks which register files to pour — one project's, or every project's — and pours them. */
export async function pourRegisterFiles(plugin: PMPlugin, only?: string): Promise<void> {
  const current = await registerFilesToPour(plugin, false, only)
  const all = await registerFilesToPour(plugin, true, only)
  if (!all.length) {
    new Notice(t('library.registersAllIn'))
    return
  }
  const chosen = await new Promise<RegisterFile[] | null>((resolve) =>
    new RegisterPourModal(
      plugin.app,
      current,
      all,
      (path) => plugin.index.projectRef(path)?.title ?? path,
      resolve
    ).open()
  )
  if (!chosen?.length) return

  const items: PourItem[] = []
  for (const entry of chosen) {
    const file = plugin.app.vault.getAbstractFileByPath(entry.file)
    if (!(file instanceof TFile)) continue
    items.push({
      kind: 'vault',
      file,
      title: entry.title,
      projects: entry.projects,
      ...(entry.issuer ? { classification: { issuer: entry.issuer } } : {})
    })
  }
  const progress = items.length > 3 ? new Notice(t('library.pouring', { done: 0, total: items.length }), 0) : null
  const report = await plugin.library.pour(
    items,
    // Never moved: a register finds its files by their path.
    { projects: [], move: false, today: today().toString(), categories: plugin.libraryCategories() },
    (done, total) => progress?.setMessage(t('library.pouring', { done, total }))
  )
  progress?.hide()
  const parts = [t('library.poured', { count: report.added.length })]
  if (report.known.length) parts.push(t('library.alreadyThere', { count: report.known.length }))
  if (report.failed.length) {
    parts.push(
      t('library.pourFailed', {
        list: report.failed.map((failure) => `${failure.name} (${failure.reason})`).join(', ')
      })
    )
  }
  new Notice(parts.join('\n'), report.failed.length ? 0 : 6000)
  void plugin.libraryText.refresh(plugin.library.docs())
}

class RegisterPourModal extends Modal {
  private withVersions = false
  private picked = new Set<string>()
  private done = false
  private listEl!: HTMLElement
  private confirmEl: HTMLButtonElement | null = null

  constructor(
    app: App,
    private current: RegisterFile[],
    private all: RegisterFile[],
    private projectTitle: (path: string) => string,
    private resolve: (chosen: RegisterFile[] | null) => void
  ) {
    super(app)
    for (const entry of current) this.picked.add(entry.file)
  }

  private shown(): RegisterFile[] {
    return this.withVersions ? this.all : this.current
  }

  onOpen(): void {
    this.setTitle(t('library.registersTitle'))
    this.modalEl.addClass('pm-docs-chooser', 'pm-docs-registers')
    this.contentEl.createEl('p', { cls: 'pm-docs-classify-note', text: t('library.registersIntro') })
    new Setting(this.contentEl)
      .setName(t('library.registersVersions'))
      .setDesc(t('library.registersVersionsDesc', { count: this.all.length - this.current.length }))
      .addToggle((toggle) =>
        toggle.setValue(this.withVersions).onChange((value) => {
          this.withVersions = value
          // Earlier versions come ticked when shown; hidden, they are not poured.
          for (const entry of this.all) {
            if (entry.current) continue
            if (value) this.picked.add(entry.file)
            else this.picked.delete(entry.file)
          }
          this.renderList()
        })
      )
    this.listEl = this.contentEl.createDiv('pm-docs-chooser-list pm-docs-registers-list')
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
      .addButton((button) => {
        this.confirmEl = button.buttonEl
        button.setCta().onClick(() => {
          this.done = true
          this.resolve(this.shown().filter((entry) => this.picked.has(entry.file)))
          this.close()
        })
      })
    this.renderList()
  }

  /** The files by the first project holding them, each with its box. */
  private renderList(): void {
    this.listEl.empty()
    const groups = new Map<string, RegisterFile[]>()
    for (const entry of this.shown()) {
      const key = entry.projects[0] ?? ''
      groups.set(key, [...(groups.get(key) ?? []), entry])
    }
    for (const [project, entries] of groups) {
      this.listEl.createDiv({ cls: 'pm-docs-registers-project', text: this.projectTitle(project) })
      for (const entry of entries) {
        const row = this.listEl.createEl('label', { cls: 'pm-docs-chooser-row' })
        const box = row.createEl('input', { attr: { type: 'checkbox' } })
        box.checked = this.picked.has(entry.file)
        box.addEventListener('change', () => {
          if (box.checked) this.picked.add(entry.file)
          else this.picked.delete(entry.file)
          this.renderCount()
        })
        row.createSpan({ cls: 'pm-docs-chooser-title', text: entry.title })
        const others = entry.projects.slice(1).map(this.projectTitle)
        row.createSpan({
          cls: 'pm-docs-chooser-detail',
          text: [entry.file.slice(entry.file.lastIndexOf('/') + 1), ...others].join(' · ')
        })
      }
    }
    this.renderCount()
  }

  private renderCount(): void {
    const count = this.shown().filter((entry) => this.picked.has(entry.file)).length
    if (!this.confirmEl) return
    this.confirmEl.setText(t('library.registersPour', { count }))
    this.confirmEl.disabled = count === 0
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.done) this.resolve(null)
  }
}
