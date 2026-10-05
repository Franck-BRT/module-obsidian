/**
 * A library's folder filter — the notes library's, the document library's —: every folder,
 * the library's root alone, or one folder — alone, or with the folders it holds.
 */

/** Stands for what is at the library's root — in no folder of its own — in a folder filter. */
export const AT_ROOT = ':root'

/**
 * Whether something in a folder, by its path under the library's, answers a folder filter:
 * in that folder — and, `deep`, in the folders it holds too.
 */
export function inFolder(subfolder: string, wanted: string | undefined, deep = true): boolean {
  if (!wanted) return true
  if (wanted === AT_ROOT) return !subfolder
  return subfolder === wanted || (deep && subfolder.startsWith(`${wanted}/`))
}
