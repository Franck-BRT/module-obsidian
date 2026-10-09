import { normalizePath, TFile, type App } from 'obsidian'
import {
  isPersonaNote,
  personaFileName,
  personaNoteContent,
  readPersonaNote,
  type PersonaDraft,
  type PersonaNote
} from '../../store/chat/personaLibrary'

/** The personas of the vault, found by their property wherever their notes are. */
export async function allPersonas(app: App): Promise<PersonaNote[]> {
  const out: PersonaNote[] = []
  for (const file of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    if (!isPersonaNote(frontmatter)) continue
    const persona = readPersonaNote(file.path, file.basename, frontmatter, await app.vault.cachedRead(file))
    if (persona) out.push(persona)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** The personas of the vault by path and name, from their properties alone: for a list to choose from. */
export function personaChoices(app: App): { path: string; name: string }[] {
  return app.vault
    .getMarkdownFiles()
    .flatMap((file) => {
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
      if (!isPersonaNote(frontmatter)) return []
      const name: unknown = frontmatter?.name ?? frontmatter?.nom
      return [{ path: file.path, name: typeof name === 'string' && name.trim() ? name.trim() : file.basename }]
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** One persona, read from its note now; null when the note is gone or no longer one. */
export async function personaAt(app: App, path: string): Promise<PersonaNote | null> {
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return null
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
  return readPersonaNote(file.path, file.basename, frontmatter, await app.vault.cachedRead(file))
}

/** A path free in the folder for this name: « Name », then « Name 2 »… */
function freePath(app: App, folder: string, name: string, keep?: string): string {
  const base = personaFileName(name)
  for (let n = 1; ; n++) {
    const path = normalizePath(`${folder ? `${folder}/` : ''}${n === 1 ? base : `${base} ${n}`}.md`)
    if (path === keep || !app.vault.getAbstractFileByPath(path)) return path
  }
}

/** A new persona, its note written in the folder given. */
export async function createPersona(app: App, folder: string, name: string, draft: PersonaDraft): Promise<TFile> {
  const dir = normalizePath(folder || '/')
  if (folder && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)
  return app.vault.create(freePath(app, folder, name), personaNoteContent(draft))
}

/** A persona changed: its note written again, and renamed when its name changed. */
export async function updatePersona(app: App, path: string, name: string, draft: PersonaDraft): Promise<string> {
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return path
  await app.vault.modify(file, personaNoteContent(draft))
  if (personaFileName(name) === file.basename) return path
  const folder = file.parent?.path === '/' ? '' : (file.parent?.path ?? '')
  const to = freePath(app, folder, name, file.path)
  await app.fileManager.renameFile(file, to)
  return to
}
