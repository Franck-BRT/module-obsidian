import type { App } from 'obsidian'
import { linkTarget, readAgendaNote, type AgendaNote } from '../../store/agenda/agendaList'

/** The agendas of a project, wherever their notes are: those whose `project` links it. */
export function projectAgendas(app: App, projectPath: string): AgendaNote[] {
  const out: AgendaNote[] = []
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter
    const note = readAgendaNote(file.path, file.basename, fm)
    if (!note) continue
    const target = app.metadataCache.getFirstLinkpathDest(linkTarget(note.project), file.path)
    if (target?.path === projectPath) out.push(note)
  }
  return out
}
