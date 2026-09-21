import { Modal, Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { Requirement, VerificationMethod } from '../../store/requirements/Requirement'
import {
  acceptText,
  isStale,
  isUnreviewedMachine,
  setText,
  textOf,
  VERIFICATION_METHODS
} from '../../store/requirements/Requirement'
import { renderPropRow } from '../../ui/FormField'
import { renderSelectControl } from '../../ui/composites/properties'
import { t } from '../../i18n'
import { reqLanguages, verificationLabel } from './reqPalette'

/**
 * One requirement, open for editing.
 *
 * The fields are the ordinary part. The part worth care is the wordings: several
 * languages of the same statement, one of which governs, and the editor has to say at
 * every moment which one that is and which of the others have fallen behind it — because
 * a translation that silently drifts is worse than a translation that is missing.
 */
class RequirementModal extends Modal {
  private draft: Requirement
  private dirty = false
  private bodyEl!: HTMLElement

  constructor(
    private plugin: PMPlugin,
    private path: string,
    loaded: Requirement
  ) {
    super(plugin.app)
    this.draft = loaded
  }

  onOpen(): void {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('pm-te-modal', 'pm-te-surface')
    this.modalEl.addClass('pm-modal', 'pm-req-modal')
    this.render()
  }

  onClose(): void {
    // Saved on close rather than behind a button, like the task editor: an editor that
    // can lose an edit teaches the reader to distrust it.
    if (this.dirty) void this.save()
    this.contentEl.empty()
  }

  private render(): void {
    const { contentEl } = this
    contentEl.empty()
    const header = contentEl.createDiv('pm-te-header')
    header.createSpan({ cls: 'pm-req-id', text: this.draft.id })
    const copy = header.createEl('button', { cls: 'pm-req-copy', attr: { 'aria-label': t('req.copyId') } })
    setIcon(copy, 'copy')
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.draft.id)
      new Notice(t('req.idCopied', { id: this.draft.id }))
    })

    this.bodyEl = contentEl.createDiv('pm-te-body')
    this.renderTitle(this.bodyEl)
    this.renderFields(this.bodyEl.createDiv('pm-te-props').createDiv('pm-prop-grid'))
    this.renderWordings(this.bodyEl)
  }

  private renderTitle(parent: HTMLElement): void {
    const input = parent.createEl('input', {
      cls: 'pm-te-title',
      type: 'text',
      attr: { placeholder: t('req.titlePlaceholder') }
    })
    input.value = this.draft.title
    input.addEventListener('input', () => {
      this.draft = { ...this.draft, title: input.value }
      this.dirty = true
    })
  }

  private renderFields(grid: HTMLElement): void {
    const settings = this.plugin.settings
    const set = <K extends keyof Requirement>(key: K, value: Requirement[K]): void => {
      this.draft = { ...this.draft, [key]: value }
      this.dirty = true
    }

    renderPropRow(
      grid,
      t('req.field.category'),
      () => {
        const host = createDiv('pm-prop-value')
        const input = host.createEl('input', { type: 'text', cls: 'pm-prop-input' })
        input.value = this.draft.category
        // Changing a category never changes the id: the id was minted once and the
        // documents that cite it do not know the category moved.
        input.addEventListener('input', () => set('category', input.value))
        return host
      },
      'folder-tree'
    )

    this.selectRow(grid, t('req.field.type'), 'shapes', this.draft.type, settings.requirements.types, (id) =>
      set('type', id)
    )
    this.selectRow(
      grid,
      t('req.field.status'),
      'circle-dashed',
      this.draft.status,
      settings.requirements.statuses,
      (id) => set('status', id)
    )
    this.selectRow(
      grid,
      t('req.field.criticality'),
      'flag',
      this.draft.criticality,
      settings.priorities.map((entry) => ({ id: entry.id, label: entry.label, color: entry.color, icon: entry.icon })),
      (id) => set('criticality', id)
    )
    this.selectRow(
      grid,
      t('req.field.verification'),
      'check-check',
      this.draft.verification,
      VERIFICATION_METHODS.map((method) => ({
        id: method,
        label: verificationLabel(method),
        color: '',
        icon: 'check-check'
      })),
      (id) => set('verification', (id || 'none') as VerificationMethod)
    )
    this.textRow(grid, t('req.field.source'), 'book', this.draft.source, (value) => set('source', value))
    this.textRow(grid, t('req.field.owner'), 'user', this.draft.owner, (value) => set('owner', value))
    this.textRow(grid, t('req.field.rationale'), 'message-square', this.draft.rationale, (value) =>
      set('rationale', value)
    )
    this.textRow(grid, t('req.field.tags'), 'tag', this.draft.tags.join(', '), (value) =>
      set(
        'tags',
        value
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== '')
      )
    )
  }

  private selectRow(
    grid: HTMLElement,
    label: string,
    icon: string,
    value: string,
    options: { id: string; label: string; color: string; icon: string }[],
    onChange: (id: string) => void
  ): void {
    renderPropRow(
      grid,
      label,
      () => {
        const host = createDiv('pm-prop-value')
        renderSelectControl({
          container: host,
          value,
          options: [
            { id: '', label: t('common.none'), icon },
            ...options.map((option) => ({
              id: option.id,
              label: option.label,
              color: option.color || undefined,
              icon: option.icon || icon
            }))
          ],
          onChange: (id) => {
            onChange(id)
            this.render()
          }
        })
        return host
      },
      icon
    )
  }

  private textRow(
    grid: HTMLElement,
    label: string,
    icon: string,
    value: string,
    onChange: (value: string) => void
  ): void {
    renderPropRow(
      grid,
      label,
      () => {
        const host = createDiv('pm-prop-value')
        const input = host.createEl('input', { type: 'text', cls: 'pm-prop-input' })
        input.value = value
        input.addEventListener('input', () => onChange(input.value))
        return host
      },
      icon
    )
  }

  /**
   * One box per language, with the source marked as the source.
   *
   * Writing in the source bumps the revision and so marks every translation behind; the
   * editor says so where the words are, not in a dialog afterwards, because that is where
   * the reader is looking when they do it.
   */
  private renderWordings(parent: HTMLElement): void {
    const section = parent.createDiv('pm-req-wordings')
    const head = section.createDiv('pm-req-wordings-head')
    head.createSpan({ cls: 'pm-req-section-title', text: t('req.wordings') })
    head.createSpan({ cls: 'pm-req-rev', text: t('req.revision', { rev: this.draft.rev }) })

    for (const lang of reqLanguages(this.plugin.settings)) {
      const box = section.createDiv('pm-req-wording-box')
      const label = box.createDiv('pm-req-wording-label')
      label.createSpan({ cls: 'pm-req-lang', text: lang.toUpperCase() })
      if (lang === this.draft.sourceLang) {
        const badge = label.createSpan({ cls: 'pm-req-state pm-req-state--source' })
        setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), 'pen-line')
        badge.createSpan({ text: t('req.sourceLang') })
      } else {
        const make = label.createEl('button', { cls: 'pm-req-make-source', text: t('req.makeSource') })
        make.addEventListener('click', () => {
          // The source language is which wording governs, so changing it is a decision
          // about the requirement, not about the view. Nothing is retranslated.
          this.draft = { ...this.draft, sourceLang: lang }
          this.dirty = true
          this.render()
        })
      }
      if (isStale(this.draft, lang)) {
        const badge = label.createSpan({ cls: 'pm-req-state pm-req-state--stale' })
        setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), 'history')
        badge.createSpan({
          text: t('req.staleFrom', { rev: String(textOf(this.draft, lang)?.fromRev ?? this.draft.rev) })
        })
      }
      if (isUnreviewedMachine(this.draft, lang)) {
        const badge = label.createSpan({ cls: 'pm-req-state pm-req-state--machine' })
        setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), 'bot')
        badge.createSpan({ text: t('req.machineWording') })
        const accept = label.createEl('button', { cls: 'pm-req-accept', text: t('req.accept') })
        accept.addEventListener('click', () => {
          this.draft = acceptText(this.draft, lang, this.author())
          this.dirty = true
          this.render()
        })
      }

      const area = box.createEl('textarea', { cls: 'pm-req-wording-input', attr: { rows: '4' } })
      area.value = textOf(this.draft, lang)?.body ?? ''
      area.placeholder = t('req.wordingPlaceholder')
      const commit = (): void => {
        const body = area.value.trim()
        const before = textOf(this.draft, lang)
        if (body === (before?.body ?? '')) return
        if (!body) return
        const next = setText(this.draft, lang, body, this.author())
        const bumped = next.rev !== this.draft.rev
        this.draft = next
        this.dirty = true
        // Redrawn only when the revision moved, so an ordinary edit does not steal focus
        // from the box being typed in.
        if (bumped) this.render()
      }
      // On blur, not on every keystroke: a revision per character would be a history
      // nobody can read.
      area.addEventListener('blur', commit)
    }
  }

  private author(): string {
    return this.plugin.settings.globalTeamMembers[0] ?? ''
  }

  private async save(): Promise<void> {
    this.dirty = false
    const saved = await this.plugin.requirements.update(this.path, () => this.draft)
    if (saved) await this.plugin.requirements.syncFileName({ ...saved, filePath: this.path })
  }
}

/** Opens a requirement for editing, reading it fresh from its note. */
export async function openRequirementModal(plugin: PMPlugin, path: string): Promise<void> {
  if (!path) return
  const loaded = await plugin.requirements.load(path)
  if (!loaded) {
    new Notice(t('req.notFound'))
    return
  }
  new RequirementModal(plugin, path, loaded).open()
}
