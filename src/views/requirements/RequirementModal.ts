import { Modal, Notice, setIcon } from 'obsidian'
import type PMPlugin from '../../main'
import type { ReqLink, ReqLinkKind, Requirement, VerificationMethod } from '../../store/requirements/Requirement'
import {
  acceptText,
  addLink,
  clearSuspect,
  isStale,
  isUnreviewedMachine,
  removeLink,
  REQ_LINK_KINDS,
  setText,
  textOf,
  VERIFICATION_METHODS
} from '../../store/requirements/Requirement'
import type { TranslationOutcome } from '../../store/requirements/RequirementTranslator'
import { safeAsync } from '../../utils'
import { renderPropRow } from '../../ui/FormField'
import { pickOption } from '../../modals/PickerModals'
import { pickRequirement } from './RequirementPicker'
import { revisionTimeline } from '../../store/requirements/reqHistory'
import { diffCounts, type DiffPart } from '../../store/requirements/reqDiff'
import { formatDateShort } from '../../dates'
import { renderSelectControl } from '../../ui/composites/properties'
import { t } from '../../i18n'
import { reqLanguages, reqLinkKindLabel, verificationLabel } from './reqPalette'

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
  /** What the gateway reported about each language it wrote, for as long as this is open. */
  private reports = new Map<string, TranslationOutcome>()
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
    this.renderLinks(this.bodyEl)
    this.renderCitations(this.bodyEl)
    this.renderHistory(this.bodyEl)
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
      // Offered where the wording is, and only where it is worth offering: on the source
      // there is nothing to translate, and on a translation already level with its source
      // a button would invite the reader to overwrite good work with a draft.
      if (lang !== this.draft.sourceLang && this.plugin.translator.available) {
        const held = textOf(this.draft, lang)
        if (held === null || isStale(this.draft, lang)) {
          const translate = label.createEl('button', {
            cls: 'pm-req-translate',
            text: held === null ? t('req.translate') : t('req.retranslate')
          })
          translate.addEventListener(
            'click',
            safeAsync(() => this.translate(lang, translate))
          )
        }
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

      const report = this.reports.get(lang)
      if (report) this.renderReport(box, report)
    }
  }

  /**
   * What the machine did to the figures, said under the words it wrote.
   *
   * A translation that reads perfectly and has lost a minus sign is the failure this
   * whole feature has to be honest about, so the warning sits with the draft rather than
   * in a notification that has already gone.
   */
  private renderReport(box: HTMLElement, report: TranslationOutcome): void {
    if (report.drift) {
      const warn = box.createDiv('pm-req-drift')
      setIcon(warn.createSpan({ cls: 'pm-glyph-icon' }), 'triangle-alert')
      const parts: string[] = []
      if (report.drift.missing.length) parts.push(t('req.driftMissing', { list: report.drift.missing.join(', ') }))
      if (report.drift.added.length) parts.push(t('req.driftAdded', { list: report.drift.added.join(', ') }))
      warn.createSpan({ text: parts.join(' · ') })
    }
    if (report.notes) {
      const note = box.createDiv('pm-req-note')
      setIcon(note.createSpan({ cls: 'pm-glyph-icon' }), 'message-square')
      note.createSpan({ text: report.notes })
    }
  }

  /**
   * Asks the gateway for this language, and shows what came back.
   *
   * The pending edits are saved first: the translation is made from the note on disk, and
   * asking a gateway to translate a sentence the reader has just replaced on screen would
   * produce a draft of something that no longer exists.
   */
  private async translate(lang: string, button: HTMLButtonElement): Promise<void> {
    if (this.dirty) await this.save()
    button.disabled = true
    button.setText(t('req.translating'))
    const current = await this.plugin.requirements.load(this.path)
    if (!current) {
      new Notice(t('req.notFound'))
      return
    }
    const outcome = await this.plugin.translator.translate(current, lang)
    if (!outcome.ok) {
      new Notice(t('req.translateFailed', { reason: outcome.error ?? '' }))
      button.disabled = false
      button.setText(t('req.translate'))
      return
    }
    this.reports.set(lang, outcome)
    const reloaded = await this.plugin.requirements.load(this.path)
    if (reloaded) this.draft = reloaded
    this.render()
  }

  /* ---- Links -------------------------------------------------------------- */

  /**
   * What this requirement says about the others.
   *
   * A link the far end has moved under is shown as such and can only be cleared by
   * somebody saying they have looked — the tool can tell that a relation may no longer
   * hold, and cannot tell that it still does.
   */
  private renderLinks(parent: HTMLElement): void {
    const section = parent.createDiv('pm-req-section')
    const head = section.createDiv('pm-req-section-head')
    head.createSpan({ cls: 'pm-req-section-title', text: t('req.links') })
    const add = head.createEl('button', { cls: 'pm-req-add-link', text: t('req.addLink') })
    add.addEventListener(
      'click',
      safeAsync(() => this.addLink())
    )

    if (!this.draft.links.length) {
      section.createDiv({ cls: 'pm-req-section-empty', text: t('req.noLinks') })
      return
    }
    for (const link of this.draft.links) this.renderLink(section, link)
  }

  private renderLink(section: HTMLElement, link: ReqLink): void {
    const row = section.createDiv('pm-req-link')
    row.createSpan({ cls: 'pm-req-link-kind', text: reqLinkKindLabel(link.kind) })

    const target = this.plugin.index.requirementById(link.to)
    if (target) {
      const open = row.createEl('a', { cls: 'pm-req-id', text: link.to, href: '#' })
      open.addEventListener(
        'click',
        safeAsync(async (event: MouseEvent) => {
          event.preventDefault()
          await openRequirementModal(this.plugin, target.filePath ?? '')
        })
      )
      if (target.title) row.createSpan({ cls: 'pm-req-link-title', text: target.title })
    } else {
      // Shown as itself rather than dropped: a ticket id, or a requirement that is gone.
      row.createSpan({ cls: 'pm-req-id', text: link.to })
    }

    if (link.suspect) {
      const badge = row.createSpan({ cls: 'pm-req-state pm-req-state--suspect' })
      setIcon(badge.createSpan({ cls: 'pm-glyph-icon' }), 'unlink')
      badge.createSpan({ text: t('req.suspectLink') })
      const revalidate = row.createEl('button', { cls: 'pm-req-accept', text: t('req.revalidate') })
      revalidate.addEventListener('click', () => {
        this.draft = clearSuspect(this.draft, link.kind, link.to)
        this.dirty = true
        this.render()
      })
    }

    const drop = row.createEl('button', { cls: 'pm-req-drop-link', attr: { 'aria-label': t('common.delete') } })
    setIcon(drop, 'x')
    drop.addEventListener('click', () => {
      this.draft = removeLink(this.draft, link.kind, link.to)
      this.dirty = true
      this.render()
    })
  }

  /**
   * Asks what kind of relation, then what it points at.
   *
   * In that order because the kind decides what the target can be: everything but
   * "satisfied by" points at another requirement, and that one points at work.
   */
  private async addLink(): Promise<void> {
    const kind = await pickOption<ReqLinkKind>(
      this.app,
      t('req.linkKind'),
      REQ_LINK_KINDS.map((id) => ({ id, label: reqLinkKindLabel(id), icon: 'link' }))
    )
    if (!kind) return
    const to = kind === 'satisfied-by' ? await this.pickTicket() : await this.pickTarget()
    if (!to) return
    this.draft = addLink(this.draft, kind, to)
    this.dirty = true
    this.render()
  }

  private async pickTarget(): Promise<string | null> {
    const library = this.plugin.index.requirementRefs().filter((one) => one.id !== this.draft.id)
    if (!library.length) {
      new Notice(t('req.noOtherRequirement'))
      return null
    }
    return (await pickRequirement(this.app, library))?.id ?? null
  }

  private async pickTicket(): Promise<string | null> {
    const tickets = this.plugin.index.allTaskRefs().filter((ref) => !ref.archived)
    if (!tickets.length) {
      new Notice(t('req.noTicket'))
      return null
    }
    return await pickOption<string>(
      this.app,
      t('req.pickTicket'),
      tickets.map((ref) => ({ id: ref.id, label: ref.title, icon: 'square-check' }))
    )
  }

  /* ---- Where it is quoted -------------------------------------------------- */

  /**
   * The documents that quote this requirement.
   *
   * Filled in after the fact, because answering it means reading the notes of the vault
   * and the editor must open now. An empty section would read as "quoted nowhere", which
   * is a different statement from "not counted yet", so it says which.
   */
  private renderCitations(parent: HTMLElement): void {
    const section = parent.createDiv('pm-req-section')
    section.createDiv('pm-req-section-head').createSpan({ cls: 'pm-req-section-title', text: t('req.citedIn') })
    const body = section.createDiv({ cls: 'pm-req-section-empty', text: t('req.citedCounting') })

    safeAsync(() => this.fillCitations(body))()
  }

  private async fillCitations(body: HTMLElement): Promise<void> {
    await this.plugin.reqUsage.refresh()
    // The editor may have been closed, or redrawn, under that read.
    if (!body.isConnected) return
    const paths = this.plugin.reqUsage.usage().get(this.draft.id) ?? []
    body.empty()
    if (!paths.length) {
      body.setText(t('req.citedNowhere'))
      return
    }
    body.removeClass('pm-req-section-empty')
    for (const path of paths) {
      const link = body.createDiv('pm-req-citation').createEl('a', { text: noteName(path), href: '#' })
      link.addEventListener(
        'click',
        safeAsync(async (event: MouseEvent) => {
          event.preventDefault()
          await this.app.workspace.openLinkText(path, '', 'tab')
        })
      )
    }
  }

  /* ---- History ------------------------------------------------------------- */

  /**
   * What each revision did to the words.
   *
   * A history that says "changed on 3 March by Franck" is a log. The question anybody
   * asks of a requirement is whether the obligation moved, and only the words answer it.
   */
  private renderHistory(parent: HTMLElement): void {
    const languages = reqLanguages(this.plugin.settings)
    const steps = languages.flatMap((lang) => revisionTimeline(this.draft, lang))
    if (!steps.length) return

    const section = parent.createDiv('pm-req-section')
    section.createDiv('pm-req-section-head').createSpan({ cls: 'pm-req-section-title', text: t('req.history') })
    // Newest first: the change somebody is looking for is nearly always the last one.
    for (const step of [...steps].reverse()) {
      const row = section.createDiv('pm-req-revision')
      const head = row.createDiv('pm-req-revision-head')
      head.createSpan({ cls: 'pm-req-lang', text: step.lang.toUpperCase() })
      head.createSpan({ cls: 'pm-req-rev', text: t('req.revision', { rev: step.rev }) })
      if (step.at) head.createSpan({ cls: 'pm-req-rev', text: formatDateShort(step.at.slice(0, 10)) })
      if (step.by) head.createSpan({ cls: 'pm-req-rev', text: step.by })
      const counts = diffCounts(step.diff)
      head.createSpan({
        cls: 'pm-req-rev',
        text: t('req.diffCounts', { added: counts.added, removed: counts.removed })
      })
      renderDiff(row.createDiv('pm-req-diff'), step.diff)
    }
  }

  private author(): string {
    return this.plugin.settings.globalTeamMembers[0] ?? ''
  }

  private async save(): Promise<void> {
    this.dirty = false
    const saved = await this.plugin.requirements.save(this.path, () => this.draft)
    if (!saved) return
    // Where it went, not where it was: writing a title renames the note under this
    // editor, and the next save has to follow it rather than address a file that is gone.
    this.path = saved.path
    this.draft = saved.requirement
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

/** The words, with what came and went marked in place. */
function renderDiff(host: HTMLElement, parts: DiffPart[]): void {
  for (const part of parts) {
    if (part.kind === 'same') {
      host.createSpan({ text: part.text })
      continue
    }
    // Marked by shape as well as colour — struck through, underlined — so a change is
    // still a change to a reader who cannot tell the two hues apart.
    host.createSpan({ cls: `pm-req-diff-${part.kind}`, text: part.text })
  }
}

/** A note's name, since a full path down the side of an editor is mostly folders. */
function noteName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
}
