import { Modal, Notice, Setting, TFile, type App } from 'obsidian'
import type PMPlugin from '../../main'
import { documentOf } from '../../store/Document'
import { fileAsVersion } from '../../store/library/fileInRegister'
import type { LibraryDoc } from '../../store/library/libraryDoc'
import {
  proposeMatches,
  type MatchCandidate,
  type MatchProposal,
  registerFieldsOf
} from '../../store/library/libraryRegister'
import { formatDateShort } from '../../dates'
import { t } from '../../i18n'

/**
 * Documents just poured that look like documents a register is waiting for, offered to be
 * filed as them in one go: each with the awaited document it looks most like chosen, the
 * others it may be one pick away, or none. Nothing is filed unless the reader says so.
 *
 * `asked` is true when the reader asked for it on documents already in the library, and
 * is then told when nothing was found; after a pour, nothing found says nothing.
 */
export async function proposeRegisterMatches(plugin: PMPlugin, docs: LibraryDoc[], asked: boolean): Promise<void> {
  const paths = plugin.index
    .projectRefs()
    .filter((ref) => !ref.template && !ref.program)
    .map((ref) => ref.path)
  const projects = await plugin.store.loadProjects(paths)
  const proposals = proposeMatches(
    docs
      .filter((doc) => doc.file)
      .map((doc) => ({ key: doc.record, title: doc.title, file: doc.file, projects: doc.projects })),
    projects
  )
  if (!proposals.length) {
    if (asked) new Notice(t('library.matchNone'))
    return
  }
  const chosen = await new Promise<Map<string, MatchCandidate> | null>((resolve) =>
    new MatchModal(plugin.app, proposals, resolve).open()
  )
  if (!chosen?.size) return

  const byRecord = new Map(docs.map((doc) => [doc.record, doc]))
  const deps = { store: plugin.store, documents: plugin.documents }
  const used = new Set<string>()
  let filed = 0
  for (const [record, match] of chosen) {
    const doc = byRecord.get(record)
    const file = doc ? plugin.app.vault.getAbstractFileByPath(doc.file) : null
    // A ticket chosen twice is given the first file only: the second would be its version 2.
    if (!doc || !(file instanceof TFile) || used.has(match.task.id)) continue
    used.add(match.task.id)
    await fileAsVersion(
      deps,
      match.project,
      match.task,
      file,
      {
        by: match.project.teamMembers[0] ?? plugin.settings.globalTeamMembers[0] ?? '',
        note: t('library.registerNote')
      },
      registerFieldsOf(doc)
    )
    if (!doc.projects.includes(match.project.filePath)) await plugin.library.addProjects(doc, [match.project.filePath])
    filed++
  }
  new Notice(t('library.matchDone', { count: filed }))
}

/** How a candidate reads in the list: where, which, and when it was awaited. */
function candidateLabel(candidate: MatchCandidate, projects: number): string {
  const meta = documentOf(candidate.task)
  return [
    projects > 1 ? candidate.project.title : '',
    [meta.reference, candidate.task.title].filter(Boolean).join(' · '),
    candidate.task.due ? t('library.registerDue', { date: formatDateShort(candidate.task.due) }) : ''
  ]
    .filter(Boolean)
    .join(' — ')
}

class MatchModal extends Modal {
  private chosen = new Map<string, MatchCandidate>()
  private done = false

  constructor(
    app: App,
    private proposals: MatchProposal[],
    private resolve: (chosen: Map<string, MatchCandidate> | null) => void
  ) {
    super(app)
    for (const proposal of proposals) if (proposal.chosen) this.chosen.set(proposal.subject.key, proposal.chosen)
  }

  onOpen(): void {
    this.setTitle(t('library.matchTitle', { count: this.proposals.length }))
    this.modalEl.addClass('pm-docs-match')
    this.contentEl.createEl('p', { cls: 'pm-docs-classify-note', text: t('library.matchIntro') })
    const projects = new Set(this.proposals.flatMap((proposal) => proposal.candidates.map((c) => c.project.filePath)))
      .size
    for (const proposal of this.proposals) {
      const name = proposal.subject.file.slice(proposal.subject.file.lastIndexOf('/') + 1)
      new Setting(this.contentEl)
        .setName(proposal.subject.title)
        .setDesc(name)
        .addDropdown((dropdown) => {
          dropdown.addOption('', t('library.matchSkip'))
          for (const [at, candidate] of proposal.candidates.entries()) {
            dropdown.addOption(String(at), candidateLabel(candidate, projects))
          }
          const current = proposal.chosen ? proposal.candidates.indexOf(proposal.chosen) : -1
          dropdown.setValue(current >= 0 ? String(current) : '').onChange((value) => {
            const candidate = value === '' ? undefined : proposal.candidates[Number(value)]
            if (candidate) this.chosen.set(proposal.subject.key, candidate)
            else this.chosen.delete(proposal.subject.key)
          })
        })
    }
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t('library.matchLater')).onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText(t('library.matchConfirm'))
          .setCta()
          .onClick(() => {
            this.done = true
            this.resolve(this.chosen)
            this.close()
          })
      )
  }

  onClose(): void {
    this.contentEl.empty()
    if (!this.done) this.resolve(null)
  }
}
