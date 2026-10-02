import { Modal, Notice, setIcon, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { DocVerdict, Project, Task } from '../../types'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import type { Requirement } from '../../store/requirements/Requirement'
import { documentOf, pendingApprovers } from '../../store/Document'
import { VISA_SEVERITIES, VISA_VERDICTS, verdictFor, type VisaSheet } from '../../store/visa/visaSheet'
import { LibraryDocPicker } from '../documents/LibraryDocPicker'
import { today } from '../../dates'
import { displayName, safeAsync } from '../../utils'
import { explain } from '../../ui/explain'
import { promptText } from '../../ui/ModalFactory'
import { t } from '../../i18n'
import { documentName, severityLabel, verdictLabel, type VisaContext } from './visaDocument'
import { draftVisa, projectRequirements, saveVisa, visaCandidates, VisaNoModel, VisaUnreadable } from './visaRun'

/** Opens the assisted visa sheet of a document ticket, for a reviewer when one is named. */
export function openVisaSheet(
  plugin: PMPlugin,
  project: Project,
  task: Task,
  onRefresh: () => Promise<void>,
  reviewer?: string
): void {
  if (!documentOf(task).file) {
    new Notice(t('visa.noFile'))
    return
  }
  new VisaModal(plugin, project, task, onRefresh, reviewer).open()
}

type Step = 'setup' | 'running' | 'review'

/**
 * The assisted visa: the reviewer picks what the document is read against — the
 * project's specifications from the library, its requirements —, the model drafts the
 * observations and the verdict, the reviewer reads, corrects, adds or strikes them out,
 * then signs: the sheet is kept with the project, sent as Word and PDF, and the verdict
 * enters the document's visa circuit.
 */
class VisaModal extends Modal {
  private step: Step = 'setup'
  private docs: LibraryDoc[]
  private chosen: Set<string>
  private requirements: Requirement[]
  private useRequirements: boolean
  private reviewer: string
  private sheet: VisaSheet = { verdict: 'approved', summary: '', observations: [] }
  private exports = true
  private problem = ''
  private generation = 0

  constructor(
    private plugin: PMPlugin,
    private project: Project,
    private task: Task,
    private onRefresh: () => Promise<void>,
    reviewer?: string
  ) {
    super(plugin.app)
    const candidates = visaCandidates(plugin, project, task)
    this.docs = candidates.docs
    this.chosen = candidates.preselected
    this.requirements = projectRequirements(plugin, project)
    this.useRequirements = this.requirements.length > 0
    const meta = documentOf(task)
    this.reviewer = reviewer ?? pendingApprovers(meta)[0] ?? meta.approvers[0] ?? project.teamMembers[0] ?? ''
  }

  onOpen(): void {
    this.modalEl.addClass('pm-visa-modal')
    this.setTitle(t('visa.title'))
    this.render()
  }

  onClose(): void {
    // A reply arriving after the window closed is dropped.
    this.generation++
    this.contentEl.empty()
  }

  private context(): VisaContext {
    const meta = documentOf(this.task)
    return {
      project: this.project.title,
      document: {
        title: this.task.title,
        reference: meta.reference,
        issue: meta.issue,
        issuer: meta.issuer,
        file: meta.file.slice(meta.file.lastIndexOf('/') + 1)
      },
      reviewer: displayName(this.reviewer),
      date: today().toString(),
      references: this.docs.filter((doc) => this.chosen.has(doc.record)).map((doc) => doc.title),
      requirements: this.useRequirements ? this.requirements.map((one) => one.id) : []
    }
  }

  private render(): void {
    const root = this.contentEl
    root.empty()
    const head = root.createDiv('pm-visa-head')
    setIcon(head.createSpan({ cls: 'pm-visa-icon' }), 'file-check')
    head.createSpan({ cls: 'pm-visa-doc', text: documentName(this.context()) })
    if (this.problem) root.createDiv({ cls: 'pm-visa-problem', text: this.problem })
    if (this.step === 'setup') this.renderSetup(root)
    else if (this.step === 'running') this.renderRunning(root)
    else this.renderReview(root)
  }

  private renderSetup(root: HTMLElement): void {
    root.createDiv({ cls: 'pm-visa-intro', text: t('visa.intro') })
    const refs = root.createDiv('pm-visa-block')
    refs.createDiv({ cls: 'pm-visa-label', text: t('visa.references') })
    if (!this.docs.length) refs.createDiv({ cls: 'pm-visa-hint', text: t('visa.noReferences') })
    for (const doc of this.docs) {
      const line = refs.createEl('label', { cls: 'pm-visa-check' })
      const box = line.createEl('input', { attr: { type: 'checkbox' } })
      box.checked = this.chosen.has(doc.record)
      box.addEventListener('change', () => {
        if (box.checked) this.chosen.add(doc.record)
        else this.chosen.delete(doc.record)
      })
      line.createSpan({ text: doc.title })
      if (doc.category) line.createSpan({ cls: 'pm-visa-hint', text: doc.category })
    }
    const more = refs.createEl('button', { cls: 'pm-visa-more', text: t('visa.addReference') })
    explain(more, t('visa.addReference'), t('tip.visa.addReference'))
    more.addEventListener('click', () => {
      new LibraryDocPicker(
        this.app,
        this.plugin.library.docs().filter((doc) => doc.file && doc.file !== documentOf(this.task).file),
        (path) => this.plugin.index.projectRef(path)?.title ?? path,
        () => '',
        (doc) => {
          if (!this.docs.some((one) => one.record === doc.record)) this.docs.push(doc)
          this.chosen.add(doc.record)
          this.render()
        }
      ).open()
    })

    const reqs = root.createDiv('pm-visa-block')
    const line = reqs.createEl('label', { cls: 'pm-visa-check' })
    const box = line.createEl('input', { attr: { type: 'checkbox' } })
    box.checked = this.useRequirements
    box.disabled = !this.requirements.length
    box.addEventListener('change', () => {
      this.useRequirements = box.checked
    })
    line.createSpan({ text: t('visa.useRequirements', { count: this.requirements.length }) })
    if (!this.requirements.length) reqs.createDiv({ cls: 'pm-visa-hint', text: t('visa.noRequirements') })

    this.renderReviewer(root)

    const foot = root.createDiv('pm-visa-foot')
    foot.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close())
    const go = foot.createEl('button', { cls: 'mod-cta', text: t('visa.analyse') })
    explain(go, t('visa.analyse'), t('tip.visa.analyse'))
    go.addEventListener(
      'click',
      safeAsync(() => this.analyse())
    )
  }

  private renderReviewer(root: HTMLElement): void {
    const meta = documentOf(this.task)
    const people = [...new Set([this.reviewer, ...meta.approvers, ...this.project.teamMembers].filter(Boolean))]
    const line = root.createDiv('pm-visa-block pm-visa-reviewer')
    line.createSpan({ cls: 'pm-visa-label', text: t('visa.reviewedBy') })
    const select = line.createEl('select', { cls: 'dropdown' })
    for (const one of people) select.createEl('option', { value: one, text: displayName(one) })
    select.createEl('option', { value: '', text: t('visa.otherReviewer') })
    select.value = this.reviewer
    select.addEventListener(
      'change',
      safeAsync(async () => {
        if (select.value) {
          this.reviewer = select.value
          return
        }
        const typed = (await promptText(this.app, t('visa.reviewedBy'), t('visa.reviewerPlaceholder')))?.trim()
        if (typed) this.reviewer = typed
        this.render()
      })
    )
  }

  private async analyse(): Promise<void> {
    this.step = 'running'
    this.problem = ''
    this.render()
    const generation = ++this.generation
    try {
      const sheet = await draftVisa(
        this.plugin,
        this.task,
        this.docs.filter((doc) => this.chosen.has(doc.record)),
        this.useRequirements ? this.requirements : []
      )
      if (generation !== this.generation) return
      this.sheet = sheet
      this.step = 'review'
    } catch (error) {
      if (generation !== this.generation) return
      this.problem =
        error instanceof VisaNoModel
          ? t('visa.noModel')
          : error instanceof VisaUnreadable
            ? t('visa.unreadable')
            : t('visa.failed', { reason: error instanceof Error ? error.message : String(error) })
      this.step = 'setup'
    }
    this.render()
  }

  private renderRunning(root: HTMLElement): void {
    const wait = root.createDiv('pm-visa-wait')
    setIcon(wait.createSpan({ cls: 'pm-visa-spinner' }), 'loader')
    wait.createSpan({ text: t('visa.running') })
    const foot = root.createDiv('pm-visa-foot')
    foot.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => {
      this.generation++
      this.step = 'setup'
      this.render()
    })
  }

  private renderReview(root: HTMLElement): void {
    const sheet = this.sheet
    root.createDiv({ cls: 'pm-visa-intro', text: t('visa.reviewIntro') })
    const verdictLine = root.createDiv('pm-visa-block pm-visa-verdict')
    verdictLine.createSpan({ cls: 'pm-visa-label', text: t('visa.verdict') })
    const verdict = verdictLine.createEl('select', { cls: 'dropdown' })
    for (const one of VISA_VERDICTS) verdict.createEl('option', { value: one, text: verdictLabel(one) })
    verdict.value = sheet.verdict
    verdict.addEventListener('change', () => {
      sheet.verdict = verdict.value as DocVerdict
      this.render()
    })
    const owed = verdictFor(sheet.observations)
    if (owed !== sheet.verdict) {
      verdictLine.createSpan({ cls: 'pm-visa-hint', text: t('visa.verdictHint', { verdict: verdictLabel(owed) }) })
    }

    const summary = root.createEl('textarea', {
      cls: 'pm-visa-summary',
      attr: { rows: '3', placeholder: t('visa.summaryPlaceholder') }
    })
    summary.value = sheet.summary
    summary.addEventListener('change', () => {
      sheet.summary = summary.value.trim()
    })

    const table = root.createDiv('pm-visa-rows')
    if (!sheet.observations.length) table.createDiv({ cls: 'pm-visa-hint', text: t('visa.noObservation') })
    sheet.observations.forEach((one, at) => {
      const row = table.createDiv(`pm-visa-row is-${one.severity}`)
      row.createSpan({ cls: 'pm-visa-number', text: String(at + 1) })
      const fields = row.createDiv('pm-visa-fields')
      const top = fields.createDiv('pm-visa-row-top')
      const article = top.createEl('input', {
        cls: 'pm-visa-article',
        attr: { type: 'text', placeholder: t('visa.article') }
      })
      article.value = one.article
      article.addEventListener('change', () => {
        one.article = article.value.trim()
      })
      const severity = top.createEl('select', { cls: 'dropdown pm-visa-severity' })
      for (const level of VISA_SEVERITIES) severity.createEl('option', { value: level, text: severityLabel(level) })
      severity.value = one.severity
      severity.addEventListener('change', () => {
        one.severity = severity.value as (typeof VISA_SEVERITIES)[number]
        this.render()
      })
      const source = top.createEl('input', {
        cls: 'pm-visa-source',
        attr: { type: 'text', placeholder: t('visa.source') }
      })
      source.value = one.source
      source.addEventListener('change', () => {
        one.source = source.value.trim()
      })
      const remove = top.createEl('button', { cls: 'pm-visa-remove', attr: { 'aria-label': t('visa.remove') } })
      setIcon(remove, 'trash-2')
      explain(remove, t('visa.remove'))
      remove.addEventListener('click', () => {
        sheet.observations.splice(at, 1)
        this.render()
      })
      const text = fields.createEl('textarea', { cls: 'pm-visa-text', attr: { rows: '2' } })
      text.value = one.observation
      text.addEventListener('change', () => {
        one.observation = text.value.trim()
      })
    })
    const add = root.createEl('button', { cls: 'pm-visa-more', text: t('visa.addObservation') })
    add.addEventListener('click', () => {
      sheet.observations.push({ article: '', observation: '', severity: 'minor', source: '' })
      this.render()
    })

    this.renderReviewer(root)
    const exports = root.createEl('label', { cls: 'pm-visa-check' })
    const box = exports.createEl('input', { attr: { type: 'checkbox' } })
    box.checked = this.exports
    box.addEventListener('change', () => {
      this.exports = box.checked
    })
    exports.createSpan({ text: t('visa.exports') })

    const foot = root.createDiv('pm-visa-foot')
    foot.createEl('button', { text: t('visa.again') }).addEventListener('click', () => {
      this.step = 'setup'
      this.render()
    })
    const sign = foot.createEl('button', { cls: 'mod-cta', text: t('visa.sign') })
    explain(sign, t('visa.sign'), t('tip.visa.sign'))
    sign.addEventListener(
      'click',
      safeAsync(async () => {
        // An observation emptied is struck out.
        sheet.observations = sheet.observations.filter((one) => one.observation.trim())
        if (!this.reviewer.trim()) {
          new Notice(t('visa.noReviewer'))
          return
        }
        sign.disabled = true
        const path = await saveVisa(
          this.plugin,
          this.project,
          this.task,
          sheet,
          this.context(),
          this.exports,
          this.onRefresh
        )
        new Notice(t('visa.saved', { verdict: verdictLabel(sheet.verdict), path }), 8000)
        this.close()
        const file = this.app.vault.getAbstractFileByPath(path)
        if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file)
      })
    )
  }
}
