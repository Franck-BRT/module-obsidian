import { Menu, TFile } from 'obsidian'
import type PMPlugin from '../../main'
import type { Task } from '../../types'
import { readAffected } from '../../store/decision'
import { refLink, refToPath } from '../../store/refs'
import { typeConfigOf } from '../../store/TicketPalette'
import { isLibraryDoc } from '../../store/library/libraryDoc'
import { openTaskPicker, promptText } from '../../ui/ModalFactory'
import { pickRequirement } from '../requirements/RequirementPicker'
import { openRequirementModal } from '../requirements/RequirementModal'
import { LibraryDocPicker } from '../documents/LibraryDocPicker'
import { t } from '../../i18n'

/** What a decision bears on, found: a ticket, a requirement, a document of the library, a note, or words. */
export interface ResolvedAffected {
  raw: string
  kind: 'ticket' | 'requirement' | 'document' | 'note' | 'text' | 'missing'
  label: string
  icon: string
  path?: string
  task?: Task
}

/** An entry of what a decision bears on, looked up in the vault: what it is, and how to name it. */
export function resolveAffected(plugin: PMPlugin, raw: string, sourcePath: string, tasks: Task[]): ResolvedAffected {
  const read = readAffected(raw)
  if (read.kind === 'text') return { raw, kind: 'text', label: read.text, icon: 'quote' }
  const path = refToPath(plugin.app, raw, sourcePath)
  if (!path) return { raw, kind: 'missing', label: read.label, icon: 'link-2-off' }
  const task = tasks.find((one) => one.filePath === path)
  if (task) return { raw, kind: 'ticket', label: task.title, icon: typeConfigOf(task.type).icon, path, task }
  const requirement = plugin.index.requirementAt(path)
  if (requirement) {
    return {
      raw,
      kind: 'requirement',
      label: [requirement.id, requirement.title].filter(Boolean).join(' — '),
      icon: 'list-checks',
      path
    }
  }
  const file = plugin.app.vault.getAbstractFileByPath(path)
  const frontmatter = file instanceof TFile ? plugin.app.metadataCache.getFileCache(file)?.frontmatter : undefined
  if (isLibraryDoc(frontmatter)) return { raw, kind: 'document', label: read.label, icon: 'file-text', path }
  return { raw, kind: 'note', label: read.label, icon: 'file', path }
}

/** Opens what a decision bears on: a ticket in its editor, a requirement in its own, any other note. */
export async function openAffected(
  plugin: PMPlugin,
  found: ResolvedAffected,
  openTicket: (task: Task) => void
): Promise<void> {
  if (found.kind === 'ticket' && found.task) return openTicket(found.task)
  if (found.kind === 'requirement' && found.path) return openRequirementModal(plugin, found.path)
  if (found.path) await plugin.app.workspace.openLinkText(found.path, '', 'tab')
}

/**
 * The menu that adds to what a decision bears on: a ticket of the project, a requirement,
 * a document of the library, or a few words.
 */
export function showAffectedMenu(
  plugin: PMPlugin,
  event: MouseEvent,
  context: { sourcePath: string; tasks: Task[]; self?: string },
  add: (entry: string) => void
): void {
  const app = plugin.app
  const link = (path: string, title: string): string => refLink(app, path, title, context.sourcePath)
  const menu = new Menu()
  menu.addItem((item) =>
    item
      .setTitle(t('decision.addTicket'))
      .setIcon('square-check-big')
      .onClick(() =>
        openTaskPicker(
          plugin,
          context.tasks.filter((task) => task.id !== context.self && task.filePath),
          (task) => {
            if (task.filePath) add(link(task.filePath, task.title))
          }
        )
      )
  )
  menu.addItem((item) =>
    item
      .setTitle(t('decision.addRequirement'))
      .setIcon('list-checks')
      .onClick(async () => {
        const chosen = await pickRequirement(app, plugin.index.requirementRefs())
        if (chosen?.filePath) add(link(chosen.filePath, chosen.id))
      })
  )
  menu.addItem((item) =>
    item
      .setTitle(t('decision.addDocument'))
      .setIcon('file-text')
      .onClick(() =>
        new LibraryDocPicker(
          app,
          plugin.library.docs(),
          (path) => plugin.index.projectRef(path)?.title ?? path,
          () => '',
          (doc) => add(link(doc.record, doc.title))
        ).open()
      )
  )
  menu.addItem((item) =>
    item
      .setTitle(t('decision.addText'))
      .setIcon('quote')
      .onClick(async () => {
        const text = await promptText(app, t('decision.addTextLabel'), t('decision.addTextPlaceholder'))
        if (text?.trim()) add(text.trim())
      })
  )
  menu.showAtMouseEvent(event)
}
