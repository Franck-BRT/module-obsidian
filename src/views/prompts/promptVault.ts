import { normalizePath, TFile, type App } from 'obsidian'
import {
  promptFileName,
  promptNoteContent,
  readPromptNote,
  type PromptDraft,
  type PromptNote
} from '../../store/chat/promptLibrary'

/** The prompts of the vault, found by their property wherever their notes are. */
export async function allPrompts(app: App): Promise<PromptNote[]> {
  const out: PromptNote[] = []
  for (const file of app.vault.getMarkdownFiles()) {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
    if (!frontmatter || frontmatter['pm-prompt'] !== true) continue
    const prompt = readPromptNote(file.path, file.basename, frontmatter, await app.vault.cachedRead(file))
    if (prompt) out.push(prompt)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** A path free in the folder for this name: « Name », then « Name 2 »… */
function freePath(app: App, folder: string, name: string, keep?: string): string {
  const base = promptFileName(name)
  for (let n = 1; ; n++) {
    const path = normalizePath(`${folder ? `${folder}/` : ''}${n === 1 ? base : `${base} ${n}`}.md`)
    if (path === keep || !app.vault.getAbstractFileByPath(path)) return path
  }
}

/** A new prompt, its note written in the folder given. */
export async function createPrompt(app: App, folder: string, name: string, draft: PromptDraft): Promise<TFile> {
  const dir = normalizePath(folder || '/')
  if (folder && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)
  return app.vault.create(freePath(app, folder, name, undefined), promptNoteContent(draft))
}

/** A prompt changed: its note written again, and renamed when its name changed. */
export async function updatePrompt(app: App, path: string, name: string, draft: PromptDraft): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return
  await app.vault.modify(file, promptNoteContent(draft))
  if (promptFileName(name) !== file.basename) {
    const folder = file.parent?.path === '/' ? '' : (file.parent?.path ?? '')
    await app.fileManager.renameFile(file, freePath(app, folder, name, file.path))
  }
}
