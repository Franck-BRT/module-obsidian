import { normalizePath, TFolder, type App } from 'obsidian'
import { safeFolder } from './chat/noteProposal'
import { ensureFolder } from './vaultFs'

/**
 * The folders a library is arranged in — the notes library's, the document library's —,
 * by their paths under the library's own: '' is its root.
 */

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' })

/** A folder of a library, as a vault path. */
export function folderPath(root: string, subfolder: string): string {
  const safe = safeFolder(subfolder)
  return normalizePath(safe ? `${root}/${safe}` : root)
}

/**
 * A library's folders, however deep, in order — those a name marks as its own workings
 * (`_files`, a dot folder) left out, and all they hold.
 */
export function subfolders(
  app: App,
  root: string,
  own: (name: string) => boolean = (name) => name.startsWith('.')
): string[] {
  const top = app.vault.getAbstractFileByPath(normalizePath(root))
  if (!(top instanceof TFolder)) return []
  const found: string[] = []
  const walk = (folder: TFolder): void => {
    for (const child of folder.children) {
      if (!(child instanceof TFolder) || own(child.name)) continue
      found.push(child.path.slice(normalizePath(root).length + 1))
      walk(child)
    }
  }
  walk(top)
  return found.sort((a, b) => collator.compare(a, b))
}

/**
 * Makes a folder in a library — under another of its folders, or at its root —, each part
 * of the name one a file system takes; « Réunions/2026 » makes both. Returns its path under
 * the library's, or '' when the name holds nothing to make.
 */
export async function makeSubfolder(app: App, root: string, name: string, under = ''): Promise<string> {
  if (!safeFolder(name)) return ''
  const relative = safeFolder([safeFolder(under), safeFolder(name)].filter(Boolean).join('/'))
  await ensureFolder(app, folderPath(root, relative))
  return relative
}
