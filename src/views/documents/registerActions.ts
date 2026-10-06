import { Notice, SuggestModal, TFile, setIcon, type App } from 'obsidian'
import type PMPlugin from '../../main'
import { documentOf } from '../../store/Document'
import { registerCandidates, registerFieldsOf } from '../../store/library/libraryRegister'
import { fileAsNew, fileAsVersion } from '../../store/library/fileInRegister'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import type { Project, Task } from '../../types'
import { formatDateShort } from '../../dates'
import { openTaskModal } from '../../ui/ModalFactory'
import { t } from '../../i18n'
import { docStateLabel } from '../library/docStateLabel'

/**
 * A document of the library, followed in a project's register.
 *
 * The file stays where the library keeps it: the register's ticket refers to it there,
 * as its next version — the awaited document it answers, an earlier issue it replaces —
 * or as a new document of the register. The register then keeps what a library does
 * not: the reference, the issue, the state and the visas.
 */

type Choice = { kind: 'ticket'; project: Project; task: Task } | { kind: 'new'; project: Project }

/**
 * Asks where the document goes — its own projects' tickets first, the awaited ones and
 * the likeliest at the top — and files it there. `only` narrows it to one project, as from
 * that project's register.
 */
export async function fileInRegister(plugin: PMPlugin, doc: LibraryDoc, only?: string): Promise<void> {
  const file = plugin.app.vault.getAbstractFileByPath(doc.file)
  if (!(file instanceof TFile)) {
    new Notice(t('library.fileMissing'))
    return
  }
  // A programme holds no tickets; a template is not a project anyone works in.
  const refs = plugin.index.projectRefs().filter((ref) => !ref.template && !ref.program)
  const own = only ? [only] : doc.projects.filter((path) => refs.some((ref) => ref.path === path))
  const others = only ? [] : refs.map((ref) => ref.path).filter((path) => !own.includes(path))
  const load = async (paths: string[]): Promise<Project[]> =>
    (await Promise.all(paths.map((path) => plugin.store.loadProjectByPath(path)))).filter(
      (project): project is Project => project !== null
    )
  const choices: Choice[] = []
  for (const project of await load(own)) {
    for (const task of registerCandidates(project, doc.title, doc.file)) choices.push({ kind: 'ticket', project, task })
    choices.push({ kind: 'new', project })
  }
  // Elsewhere, what is awaited — a file can answer a project it was not poured for — then
  // a new document in any project.
  const elsewhere = await load(others)
  for (const project of elsewhere) {
    for (const task of registerCandidates(project, doc.title, doc.file)) {
      if (documentOf(task).state === 'expected') choices.push({ kind: 'ticket', project, task })
    }
  }
  for (const project of elsewhere) choices.push({ kind: 'new', project })
  if (!choices.length) {
    new Notice(t('library.registerNoProject'))
    return
  }
  const chosen = await new Promise<Choice | null>((resolve) =>
    new RegisterPicker(plugin.app, doc.title, choices, resolve).open()
  )
  if (chosen) await fileAs(plugin, doc, file, chosen)
}

async function fileAs(plugin: PMPlugin, doc: LibraryDoc, file: TFile, chosen: Choice): Promise<void> {
  const { project } = chosen
  const deps = { store: plugin.store, documents: plugin.documents }
  const deposit = {
    by: project.teamMembers[0] ?? plugin.settings.globalTeamMembers[0] ?? '',
    note: t('library.registerNote')
  }
  if (chosen.kind === 'ticket') {
    // The ticket told its reference, issue and issuer, where it says none, and its new issue.
    const meta = await fileAsVersion(deps, project, chosen.task, file, deposit, registerFieldsOf(doc))
    new Notice(
      t('library.registerFiled', {
        title: chosen.task.title,
        project: project.title,
        version: meta.versions[meta.versions.length - 1]?.version ?? 1
      })
    )
  } else {
    const task = await fileAsNew(deps, project, doc.title, file, deposit, registerFieldsOf(doc))
    new Notice(t('library.registerCreated', { title: task.title, project: project.title }))
    // Its reference and issue are the register's to say: asked for straight away.
    openTaskModal(plugin, project, { task, onSave: () => Promise.resolve() })
  }
  // Followed in a project's register, it belongs to that project in the library too.
  if (!doc.projects.includes(project.filePath)) await plugin.library.addProjects(doc, [project.filePath])
}

class RegisterPicker extends SuggestModal<Choice> {
  private done = false

  constructor(
    app: App,
    title: string,
    private choices: Choice[],
    private resolve: (choice: Choice | null) => void
  ) {
    super(app)
    this.setPlaceholder(t('library.registerPick', { title }))
    this.limit = 200
  }

  getSuggestions(query: string): Choice[] {
    const q = query.toLowerCase()
    return this.choices.filter((choice) => {
      const text =
        choice.kind === 'ticket'
          ? `${choice.project.title} ${choice.task.title} ${documentOf(choice.task).reference}`
          : `${choice.project.title} ${t('library.registerNew', { project: choice.project.title })}`
      return text.toLowerCase().includes(q)
    })
  }

  renderSuggestion(choice: Choice, el: HTMLElement): void {
    el.addClass('pm-docs-reg-pick')
    const line = el.createDiv('pm-docs-pick-line')
    if (choice.kind === 'new') {
      setIcon(line.createSpan('pm-docs-pick-icon'), 'file-plus')
      line.createSpan({ text: t('library.registerNew', { project: choice.project.title }) })
      return
    }
    const meta = documentOf(choice.task)
    setIcon(line.createSpan('pm-docs-pick-icon'), meta.state === 'expected' ? 'file-clock' : 'file-check')
    line.createSpan({
      cls: 'pm-docs-pick-title',
      text: [meta.reference, choice.task.title].filter(Boolean).join(' · ')
    })
    const last = meta.versions[meta.versions.length - 1]?.version ?? 0
    const detail = [
      choice.project.title,
      docStateLabel(meta.state),
      meta.state === 'expected' && choice.task.due
        ? t('library.registerDue', { date: formatDateShort(choice.task.due) })
        : '',
      meta.issue ? t('library.registerIssue', { issue: meta.issue }) : '',
      last ? t('library.registerNext', { version: last + 1 }) : ''
    ]
    el.createEl('small', { cls: 'pm-docs-pick-detail', text: detail.filter(Boolean).join(' · ') })
  }

  onChooseSuggestion(choice: Choice): void {
    this.done = true
    this.resolve(choice)
  }

  onClose(): void {
    super.onClose()
    // Chosen or not: a suggestion is taken after the window closes, so this waits a turn.
    window.setTimeout(() => {
      if (!this.done) this.resolve(null)
    }, 0)
  }
}
