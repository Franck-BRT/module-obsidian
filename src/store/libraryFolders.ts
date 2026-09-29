import { normalizePath, TFile, TFolder, type App, type TAbstractFile } from 'obsidian'
import { safeFolder } from './chat/noteProposal'
import { freePath } from './DocumentStore'
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

/** Files moved: where each one now is, by the path it had. */
export type Moves = Map<string, string>

/** Every file in a folder, however deep. */
function filesUnder(folder: TFolder): TFile[] {
  const found: TFile[] = []
  for (const child of folder.children) {
    if (child instanceof TFile) found.push(child)
    else if (child instanceof TFolder) found.push(...filesUnder(child))
  }
  return found
}

/** The folder a library's folder is in, by its path under the library's: '' for its root. */
export function parentOf(subfolder: string): string {
  return subfolder.slice(0, Math.max(0, subfolder.lastIndexOf('/')))
}

/**
 * Moves a file, or a folder with all it holds, into another folder — never over what is
 * there: a name taken is given a number. Returns every file moved, by the path it had.
 */
export async function moveInto(app: App, item: TAbstractFile, into: string): Promise<Moves> {
  const target = normalizePath(into)
  const moves: Moves = new Map()
  if (item.parent?.path === target) return moves
  await ensureFolder(app, target)
  const from = item.path
  if (item instanceof TFile) {
    const to = await freePath(app, target, item.basename, item.extension)
    await app.fileManager.renameFile(item, to)
    moves.set(from, to)
  } else if (item instanceof TFolder) {
    const to = await freePath(app, target, item.name, '')
    const files = filesUnder(item).map((file) => file.path)
    await app.fileManager.renameFile(item, to)
    for (const path of files) moves.set(path, `${to}${path.slice(from.length)}`)
  }
  return moves
}

/**
 * Renames a library's folder where it is. Returns its new path under the library's and the
 * files moved with it — or null when the name holds nothing, or another folder has it.
 */
export async function renameSubfolder(
  app: App,
  root: string,
  subfolder: string,
  name: string
): Promise<{ folder: string; moves: Moves } | null> {
  const folder = subfolder ? app.vault.getAbstractFileByPath(folderPath(root, subfolder)) : null
  // A name, not a path: the folder stays in the one it is in.
  const clean = safeFolder(name.replace(/[\\/]+/g, ' '))
  if (!(folder instanceof TFolder) || !clean) return null
  const parent = parentOf(subfolder)
  const next = parent ? `${parent}/${clean}` : clean
  if (next === subfolder) return { folder: next, moves: new Map() }
  const to = folderPath(root, next)
  // Another spelling of the same name — a capital — is the same folder on most disks.
  const taken = app.vault.getAbstractFileByPath(to)
  if (taken && taken !== folder) return null
  const from = folder.path
  const files = filesUnder(folder).map((file) => file.path)
  await app.fileManager.renameFile(folder, to)
  return { folder: next, moves: new Map(files.map((path) => [path, `${to}${path.slice(from.length)}`])) }
}

/**
 * Takes a folder out of a library: what it holds goes up into the folder it is in — its
 * files, and its folders whole —, then the folder, left empty, goes to the trash. A folder
 * `merged` names — a files folder — has what it holds put into its parent's own instead.
 * Returns every file moved, by the path it had.
 */
export async function dissolveSubfolder(
  app: App,
  root: string,
  subfolder: string,
  merged: (name: string) => boolean = () => false
): Promise<Moves> {
  const folder = subfolder ? app.vault.getAbstractFileByPath(folderPath(root, subfolder)) : null
  const moves: Moves = new Map()
  if (!(folder instanceof TFolder)) return moves
  const parent = folderPath(root, parentOf(subfolder))
  const add = (more: Moves): void => {
    for (const [from, to] of more) moves.set(from, to)
  }
  for (const child of [...folder.children]) {
    if (child instanceof TFolder && merged(child.name)) {
      for (const inner of [...child.children]) add(await moveInto(app, inner, `${parent}/${child.name}`))
      if (!child.children.length) await app.fileManager.trashFile(child)
    } else add(await moveInto(app, child, parent))
  }
  if (!folder.children.length) await app.fileManager.trashFile(folder)
  return moves
}
